# ADR-035: Bun Adapter Refinement

**Status**: Proposed

**Date**: 2025-11-16

**Related**: [ADR-031 Plugin-Adapter Architecture](./031-plugin-adapter-architecture.md), [ADR-033 Opaque Transport & Canonical Connection Data](./033-opaque-transport-canonical-connection-data.md), [ADR-034 Bun Upgrade Return Semantics](./034-bun-upgrade-return-semantics.md)

## Context

The `@ws-kit/bun` adapter has accumulated technical debt and DX issues:

1. **Authentication doesn't actually gate connections** — docs say `authenticate` should reject on `undefined`, but the implementation always upgrades regardless
2. **Dead options expose broken contracts** — `context` and `onBroadcast` are in the public API but unused; `onError` is exposed but never called
3. **Inconsistency with core patterns** — `createBunHandler()` doesn't unwrap typed routers like `serve()` does, creating asymmetric behavior
4. **Dependency bloat** — Uses `uuid` package when Bun's native `crypto.randomUUID()` is available
5. **Stale documentation** — Comments reference non-existent functions and older Pub/Sub initialization patterns
6. **Unclear error handling** — No unified error hook strategy across upgrade, open, message, close phases

These issues erode user trust (docs don't match code) and create DX traps (dead options, broken gatekeeping).

## Decision

Apply four core refinements to align the Bun adapter with WS-Kit's philosophy (adapter-first, plugin-driven, minimal behavior):

### 1. Authentication Gating (Security Critical)

**Move authentication decision to `fetch`**, before `upgradeConnection`:

```typescript
// In BunHandlerOptions
authenticate?: (req: Request) => TContext | undefined | Promise<TContext | undefined>;
authRejection?: { status?: number; message?: string }; // Default: 401 "Unauthorized"
```

- If `authenticate` is **absent** → upgrade with minimal data (clientId, connectedAt)
- If `authenticate` is **present**:
  - Returns `undefined` → reject with configured status (default 401)
  - Returns object → merge into connection data and upgrade
- Call `authenticate` once in `fetch`, pass precomputed data to `upgradeConnection`
- This makes auth a true gatekeeper, matching documented behavior

**Breaking Change**: Apps that relied (incorrectly) on `authenticate` returning `undefined` to accept must now return `{}`.

**Rationale**: Security and trust. Current behavior violates the principle of least surprise. Auth should reject or accept, not always accept. This aligns implementation with docs.

### 2. Error Hook (Sync-Only, Minimal)

**Keep `onError` but make it sync-only with flat context:**

```typescript
interface ErrorContext {
  type: "upgrade" | "open" | "message" | "close";
  clientId?: string;
  req?: Request; // Only for 'upgrade'
  data?: Partial<TContext>;
}

export interface BunHandlerOptions<TContext> {
  onError?: (error: Error, ctx: ErrorContext) => void;
}
```

- Fire in all catch blocks (fetch, open, message, close)
- Sync-only to avoid promise-handling footguns (no unawaited promises, no swallowing errors)
- Flat object (not tagged union) for simplicity; extensible via optional fields
- Use for logging and basic telemetry only
- For async cleanup or recovery, users build plugins (more robust)

**Rationale**: Observability is a common need. Sync hooks are lightweight and predictable. Keeping it separate from router-level error handling avoids dual configuration. Flat context is easy to destructure and extend.

### 3. Remove Dead Options

**Remove from `BunHandlerOptions`:**

- `context` — Global context propagation belongs in plugins (e.g., `withGlobalContext({ db, config })`) or router constructor, not adapters
- `onBroadcast` — Observability hooks belong in telemetry plugins, not adapters; preserves adapter-first separation of concerns

**Keep**:

- `authenticate`, `clientIdHeader` (mechanical, required for upgrade)
- `onError`, `onUpgrade`, `onOpen`, `onClose` (lifecycle hooks that fire)

This shrinks the API surface and eliminates broken contracts.

**Rationale**: Adapters should be mechanical bridges (Bun → router), not behavioral mini-frameworks. Per ADR-031, behavior lives in plugins, not adapters. Dead options confuse users and suggest features that don't work.

### 4. Internal Consistency & Polish

- **Router unwrapping in `createBunHandler`**: Mirror `serve()` logic to unwrap typed routers via `Symbol.for("ws-kit.core")` — ensures low-level and high-level usage are identical
- **Fix JSDoc for `createDefaultBunFetch`**: Correct example to match actual API (no `defaultFetch` property)
- **Update PubSub comments**: Reference current `serve.ts` design, not non-existent `createBunAdapterWithServer()`
- **Replace `uuid` with native `crypto.randomUUID()`**: Drop external dependency, use Bun's built-in crypto

## Rationale

### Adapter-First Philosophy

Per ADR-031, adapters are mechanical bridges (platform-specific protocol ↔ core router). Behavioral concerns (auth decisions, observability, context propagation) belong in plugins or the core router, not adapters. This refinement removes adapter-specific hooks and defers complex concerns to the right layer.

### DX & Trust

Users expect docs and code to match. Current `authenticate` behavior (always upgrade) violates this. Sync-only `onError` prevents subtle promise bugs. Removing dead options simplifies the mental model. These changes reduce surprises and support confident usage.

### Security

Authentication must be a gatekeeper, not a side effect. Current behavior (always upgrade) is a security footgun masked by docs. This fix is non-negotiable.

### Consistency

`serve()` and `createBunHandler()` should behave identically for the same input. Symmetric router unwrapping ensures no hidden breakage with typed routers.

## Consequences

### Positive

- ✅ **Auth works as documented** — `undefined` rejects, object accepts
- ✅ **Leaner API** — No dead options; clearer contract
- ✅ **Safer error handling** — Sync-only `onError` prevents promise footguns
- ✅ **No external dependencies** — Removes `uuid`, uses Bun's native crypto
- ✅ **Consistency** — Low-level and high-level APIs behave identically
- ✅ **Stronger separation of concerns** — Adapters are mechanical; plugins handle behavior

### Trade-offs

- ⚠️ **Breaking Changes** (minor):
  1. `authenticate` now rejects on `undefined` (was always accepting; docs said reject)
     - Impact: Only apps relying on broken behavior are affected
     - Mitigation: Clear CHANGELOG entry; error message on auth rejection
     - Fix: Return `{}` instead of `undefined` to accept

  2. Removed `context` from `BunHandlerOptions`
     - Impact: Apps passing global context via this option must use plugins instead
     - Mitigation: ADR-NNN (future) will define plugin-based context propagation
     - Fix: Use `router.plugin(withGlobalContext({ /* deps */ }))`

  3. Removed `onBroadcast` from `BunHandlerOptions`
     - Impact: Apps tracking broadcasts via this hook must use telemetry plugins
     - Mitigation: Document plugin path in pubsub.md
     - Fix: Use `router.plugin(withTelemetry({ onPublish: ... }))`

- ⚠️ **Minor API Shape Change**:
  - `onError` context is flat, not a tagged union (still extensible, simpler to use)
  - `authRejection` is optional (defaults to 401), new in options
  - Upgrade failures → `400`, not `500` (per ADR-034, correct semantics)

- ⚠️ **Future ADRs Needed**:
  - ADR-036: Global Context Propagation (plugin-based path for `context`)
  - ADR-037: Observability Plugins (how to hook into broadcasts, errors across adapters)

### Not Affected

- `serve()` API remains unchanged (same high-level function)
- Router core behavior unchanged
- Pub/Sub mechanics unchanged
- Message routing, validation, RPC all stable

## Migration Guide

**For apps using `authenticate` returning `undefined`:**

```typescript
// Before (incorrectly relied on broken behavior)
authenticate: async (req) => {
  const token = req.headers.get("authorization");
  return token ? { userId: "user" } : undefined; // Didn't actually reject
}

// After (correct)
authenticate: async (req) => {
  const token = req.headers.get("authorization");
  if (!token) return undefined; // Now properly rejects with 401
  return { userId: "user" };
}

// Or customize rejection:
authenticate: async (req) => { /* ... */ },
authRejection: { status: 403, message: "Forbidden" }
```

**For apps using `context` option:**

```typescript
// Before
serve(router, { context: { db, config } });

// After (with future plugin)
router.plugin(withGlobalContext({ db, config }));
serve(router);
```

**For apps using `onBroadcast`:**

```typescript
// Before
serve(router, { onBroadcast: (msg, topic) => console.log(msg) });

// After (with future plugin)
router.plugin(withTelemetry({ onPublish: (topic) => console.log(topic) }));
serve(router);
```

## Scope

**This ADR applies to the Bun adapter only.** Other adapters (Cloudflare, Node, etc.) may have different auth/error patterns. Each should be evaluated separately.

## Version

This is a **minor breaking change** (semantic: fixes broken behavior, but technically breaks apps relying on that broken behavior). Recommend **v2.1.0 with strong migration note** or **v3.0.0 if doing other major bumps**.

## References

- [ADR-031: Plugin-Adapter Architecture](./031-plugin-adapter-architecture.md)
- [ADR-033: Opaque Transport & Canonical Connection Data](./033-opaque-transport-canonical-connection-data.md)
- [ADR-034: Bun Upgrade Return Semantics](./034-bun-upgrade-return-semantics.md)
- [Bun WebSocket API](https://bun.sh/docs/api/websockets)
