# ADR-033: Opaque Transport + Canonical ConnectionData

**Status:** Proposed
**Date:** 2025-11-15
**References:** ADR-016 (ConnectionData Naming), ADR-021 (Adapter-First), ADR-031 (Plugin-Adapter Architecture)

---

## Context

The router stores per-connection state in a private `WeakMap<ServerWebSocket, TContext>` and surfaces it to user code via `ctx.data`. This design (introduced in recent refactoring) keeps state **contained, testable, and platform-agnostic**.

However, the codebase still contains numerous references assuming the old "Bun-style" pattern:

- `ServerWebSocket<TData>` as a generic type in some adapters and plugins
- `ws.data` treated as the canonical state bag
- Adapters, plugins, and tests reading/writing `ctx.data` directly

### The Problem

1. **Type safety broken**: Bun's `@types/bun` defines `ServerWebSocket<T>`, but Cloudflare's `WebSocket` is non-generic. Core's own `ServerWebSocket` interface (in `platform-adapter.ts`) is intentionally non-generic to stay platform-agnostic. This creates type conflicts across adapters and plugins.

2. **Design drift**: Router internals never touch `ws.data` anymore; they only use the WeakMap. So code that reads/writes `ctx.data` or `ws.data` is already **unsound at runtime**—it silently reads/writes nothing.

3. **Mental model collision**: Two possible states bags (ctx.data and ws.data) invite bugs, especially across platform boundaries. Users don't know which one is canonical.

### Root Cause

When state moved from `ws.data` to `ctx.data`, the migration was incomplete. Docs, tests, and helper code still assume `ws.data` works.

---

## Decision

**`ServerWebSocket` is opaque transport. `ctx.data` (via `ConnectionData`) is the only canonical source of truth.**

### Core Contract

Two related interfaces enforce the type boundary between public API and adapter internals:

```typescript
// @ws-kit/core/src/ws/platform-adapter.ts

/**
 * PUBLIC: Opaque transport interface exposed to user code on ctx.ws.
 * Only send(), close(), and readyState are available.
 */
export interface ServerWebSocket {
  /**
   * Send raw data (string or binary).
   * Only adapters and routers should call this; user code goes through ctx.send().
   */
  send(data: string | ArrayBuffer): void;

  /**
   * Close connection with optional code + reason.
   * Only adapters and routers should call this; user code goes through ctx.close().
   */
  close(code?: number, reason?: string): void;

  /**
   * Connection state (CONNECTING | OPEN | CLOSING | CLOSED).
   */
  readyState: "CONNECTING" | "OPEN" | "CLOSING" | "CLOSED";
}

/**
 * INTERNAL: Adapter-only interface extending ServerWebSocket with initialData.
 * Only used by adapters and router internals; never exposed to user code.
 */
export interface AdapterWebSocket extends ServerWebSocket {
  /**
   * Optional: Initial connection context data set by adapter at upgrade time.
   * Mutable during the brief window before router.websocket.open(ws).
   * Router reads initialData during handleOpen(), merges it into ctx.data,
   * then no longer references it (adapter-only seed, not persisted).
   */
  initialData?: Record<string, unknown>;
}
```

**Type boundary rationale:**

- `ServerWebSocket` is the public contract → only on `ctx.ws` → only send/close/readyState
- `AdapterWebSocket` is the internal contract → used by adapters and router → has mutable initialData
- Casts from `ServerWebSocket` to `AdapterWebSocket` are only valid in adapter code and router internals
- Platform-specific types (Bun's generic `ServerWebSocket<T>`, Cloudflare's `WebSocket`) are adapted to `AdapterWebSocket` before passing to router

### State API

```typescript
// @ws-kit/core/src/context/base-context.ts
export interface MinimalContext<
  TContext extends ConnectionData = ConnectionData,
> {
  readonly clientId: string;
  readonly ws: ServerWebSocket; // Opaque transport (send, close, readyState only)
  readonly type: string;
  readonly data: TContext; // ✅ Canonical state
  assignData(partial: Partial<TContext>): void;
  readonly extensions: Map<string, unknown>;
}
```

### Adapter Contract

Adapters seed connection state by casting to `AdapterWebSocket` and setting `initialData` before passing to `router.websocket.open(ws)`:

```typescript
// Example: Bun adapter
// 1. Receive Bun's WebSocket with attached .data
const bun_ws: Bun.ServerWebSocket<{ userId: string }> = /* from Bun */;

// 2. Cast to AdapterWebSocket to access initialData (adapter-only)
const ws = bun_ws as AdapterWebSocket;

// 3. Extract platform data and attach as initialData
ws.initialData = {
  userId: bun_ws.data.userId,
  connectedAt: Date.now(),
  // ... other fields from request headers, auth tokens, etc.
};

// 4. Pass to router (now typed as ServerWebSocket for handler)
await router.websocket.open(ws);

// Router merges initialData into ctx.data during handleOpen(),
// then discards it (one-time seed, not persisted on ws)
```

**Key points:**

- Adapters cast to `AdapterWebSocket` to access mutable `initialData` field
- Adapters extract platform-specific data and seed it via `initialData`
- Router checks for initialData during `handleOpen()` before firing lifecycle handlers
- Data is merged into the WeakMap-backed `ctx.data` (permanent residence)
- `initialData` is NOT persisted after merge; it's a one-time seed at connection open
- User code sees only `ServerWebSocket` (no `initialData` on `ctx.ws`)

> ⚠️ **Note on types:** `AdapterWebSocket.initialData` remains `Record<string, unknown>`. Core cannot infer the adapter's platform-specific shape. Adapters must keep the runtime fields they seed aligned with their project's `ConnectionData` module augmentation—TypeScript only regains full fidelity once the router merges `initialData` into `ctx.data`.

### Documentation Covenant

User code MUST treat `ServerWebSocket` as opaque transport. Only use `send()`, `close()`, and `readyState`. All per-connection state lives in `ctx.data`:

```typescript
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    roles?: string[];
  }
}

router.on(SomeMessage, (ctx) => {
  // ✅ Correct: read/write from ctx.data
  const userId = ctx.data.userId;
  ctx.assignData({ roles: ["admin"] });

  // ✅ Use socket for transport only
  ctx.ws.send(someBuffer);
  ctx.ws.close(1000);
  const state = ctx.ws.readyState;

  // ❌ Never do this:
  // ctx.data.userId;           // ← ws has no .data field; use ctx.data instead
  // (ctx.ws as any).data.userId;  // ← Bypasses type safety; use ctx.data instead
  // ctx.ws.initialData;           // ← Adapter-only; already merged into ctx.data during open
});
```

---

## Alternatives Considered

### 1. Re-introduce Generic `ServerWebSocket<TData>`

Make core own a generic interface again and sync `ws.data` with the WeakMap.

**Pros:**

- Matches Bun's type signature
- Familiar to Bun users

**Cons:**

- Two mutable sources of truth (WeakMap + ws.data can drift)
- Couples core to platform generics (ADR-021 violation)
- Extra runtime overhead syncing both stores
- Complicates Cloudflare/future platforms that don't have `.data`

### 2. Introduce `PlatformWebSocket<TData>` interface in core

Define a new abstraction in core that all adapters must implement.

**Pros:**

- Future-proof for multi-platform support
- Cleaner abstraction boundary

**Cons:**

- Adds complexity before it's needed (premature abstraction)
- Core already has the right design (WeakMap + opaque ws); adding generics makes it worse
- If we need this later, it's a small, backwards-compatible ADR

### 3. Type assertions (`(ws as ServerWebSocket<TData>).data`)

Quick fix with `// @ts-ignore` or casts.

**Pros:**

- Minimal immediate changes

**Cons:**

- Hides the problem, defers the fix
- Makes code unsound and untestable
- Violates our principle: "safety over micro-optimizations"

---

## Rationale

### 1. Simplicity and Correctness

The router **already** uses `WeakMap<ServerWebSocket, TContext>` + `ctx.data` exclusively. This ADR formalizes that reality and cleans up the code to match the implementation.

- **One source of truth** → no drift bugs (only WeakMap-backed `ctx.data`, never `ws.data`)
- **Platform-agnostic** → core stays lean, adapters own platform translation
- **Testable** → mock `ConnectionData` directly, not platform sockets

### 2. Aligns with Plugin-Adapter Design

ADR-031 established that **adapters own platform quirks**. This decision extends that:

- Core defines `ServerWebSocket` (minimal, non-generic)
- Adapters wrap platform types (e.g., Bun's generic socket) _locally_
- Adapters expose plain `ServerWebSocket` to core
- Core uses `initialData` hook to seed state via adapters

No platform leakage into core.

### 3. Better DX at Scale

When users see `ctx.data` everywhere (docs, examples, handlers), there's no ambiguity:

```typescript
// Clear, teachable pattern:
// 1. Define what lives on ctx.data (module augmentation)
// 2. Read/write it in handlers via ctx.data and ctx.assignData()
// 3. Don't touch ws at all (it's just send/close)
```

This is simpler than:

> "ctx.data is usually where state lives, but ctx.data also works, except it doesn't on Cloudflare, and also check the docs for which one syncs..."

### 4. Backwards-Compatible Migration Path

The migration is safe because:

- Core's WeakMap _already_ doesn't sync with `ws.data`
- Code reading/writing `ctx.data` may already be reading stale or undefined values across platforms
- Fixing it now makes the error explicit (type error) instead of silent (undefined at runtime)

---

## Implementation Status

**Implemented in code:**

- `ServerWebSocket` (public) and `AdapterWebSocket` (internal) interfaces in `platform-adapter.ts`
- `MinimalContext.ws` typed as `ServerWebSocket` so user code cannot reach `initialData`
- Router seeding via `AdapterWebSocket.initialData` during `handleOpen()`
- Test utilities (`TestWebSocket`, `InMemoryPlatformAdapter`, `createTestRouter`, `wrapTestRouter`) implement the adapter contract
- Bun and Cloudflare adapters cast to `AdapterWebSocket` for `initialData` seeding

**Pending / migration work:**

- Update all docs/examples to use `ctx.data` instead of `ctx.data`
- Remove legacy `ServerWebSocket<TData>` usage from helpers/tests
- Document migration notes for plugin authors so lingering patterns are easy to spot
- Clean up any defensive `as any` assertions introduced before the router boundary hardened

---

## Consequences

### Positive

- ✅ **Type safety restored**: Adapters and plugins compile without workarounds
- ✅ **Correctness**: Code matches runtime behavior (WeakMap, not ws.data)
- ✅ **Simplicity**: One mental model ("state lives in ctx.data")
- ✅ **Platform-agnostic**: Core stays independent of Bun/Cloudflare quirks
- ✅ **Testability**: Easier to mock ConnectionData than platform sockets
- ✅ **Extensibility**: Future platforms don't need to match Bun's `.data` pattern

### Negative

- ❌ **Breaking**: Code that reads `ctx.data` will now fail at type-check time
- ❌ **Migration effort**: Documentation and examples need updates to use `ctx.data` instead

### Risks

**Risk**: Users have code that relies on `ctx.data` working

**Mitigation**: Router's WeakMap never wired `ws.data` to connection state, so such code was already reading stale/undefined values. This ADR makes the error visible (type error) instead of silent (undefined at runtime).

### Adapter Guidance

Adapters interact with `AdapterWebSocket` at the boundary, then pass to router:

**DO:**

- Receive platform-specific WebSocket (Bun's `ServerWebSocket<T>`, Cloudflare's `WebSocket`)
- Cast to `AdapterWebSocket` to access mutable `initialData`
- Extract platform data and seed via `initialData` (one-time operation)
- Pass to router as `ServerWebSocket` (no type assertion needed; AdapterWebSocket is a ServerWebSocket)

**DON'T:**

- Export or re-export `AdapterWebSocket` from adapter packages
- Store state on `ws.data` after socket enters router control
- Attempt to mutate `initialData` after `router.websocket.open(ws)` completes
- Access `initialData` in user code (it's not there; use `ctx.data` instead)

### Plugin & Test Access Patterns

Plugins and test harnesses sometimes need access to internal router state (e.g., clientId lookup):

**For production plugins:**

- Always use `ctx.data` and `ctx.clientId` (publicly available)
- Never attempt to infer state from `ctx.ws` (it's opaque transport)
- If you need custom metadata, store it in `ctx.data` during `onOpen` lifecycle hook

**For test fixtures and helpers:**

- Import helpers from `@ws-kit/core/testing`:

  ```ts
  import {
    createTestRouter,
    wrapTestRouter,
    TestWebSocket,
    InMemoryPlatformAdapter,
  } from "@ws-kit/core/testing";
  ```

- Prefer `createTestRouter()` / `wrapTestRouter()` and treat the resulting router/connection helpers as black boxes. The `testing` namespace re-export mirrors this API for ergonomics:

  ```ts
  import { testing } from "@ws-kit/core/testing";

  const tr = testing.createTestRouter({ create: () => createRouter() });
  ```

- For advanced assertions, `TestWebSocket` is still available from `@ws-kit/core/testing`; it implements `AdapterWebSocket` and exposes helpers like `getSentMessages()`. Keep this coupling confined to tests.

**For internal routing** (e.g., pubsub origin tracking):

- Pass `clientId` explicitly through plugin callbacks
- Use `ctx.clientId` (always available) rather than inferring from `ws`
- Avoid creating new fields on `ServerWebSocket`; use `ctx.extensions` for plugin namespacing instead

---

## References

- **ADR-016**: ConnectionData Naming—establishes ConnectionData pattern
- **ADR-021**: Adapter-First Architecture—adapters own platform details
- **ADR-031**: Plugin-Adapter Architecture—codifies plugin/adapter split
- **ServerWebSocket** interface: Core transport contract (platform-agnostic)
- **MinimalContext**: Base context type with `ctx.data` and `ctx.clientId`
- Specs: Router API, context lifecycle, and state management patterns
