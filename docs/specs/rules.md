# Development Rules

Quick reference index for MUST/NEVER rules. Links to canonical specs for details.

**How to Use:**

1. Scan this file for applicable rules
2. Follow links to canonical sections for implementation details
3. When in doubt, linked sections take precedence over this index

**Note:** This is an INDEX, not a canonical source. Domain specs own their rules.

---

## Critical Rules (NEVER Violate)

### Type Safety

- **NEVER** access `ctx.payload` if schema doesn't define it (TypeScript will error) → ADR-001
- **ALWAYS** rely on TypeScript to enforce `ctx.payload` presence via conditional typing → ADR-001

### Import Patterns (ADR-007: Export-with-Helpers)

- **ALWAYS** use single canonical import source → ADR-007, @schema.md#Canonical-Import-Patterns
  - Server: `import { z, message, createRouter } from "@ws-kit/zod"` or `@ws-kit/valibot`
  - Client (Typed): `import { wsClient } from "@ws-kit/client/zod"` or `@ws-kit/client/valibot`
  - Multi-runtime: `import { serve } from "@ws-kit/serve"` with explicit `runtime`, or `import { serve } from "@ws-kit/serve/bun"` for single-target
- **NEVER** mix imports from different sources (prevents dual package hazard) → ADR-007
- **NEVER** import `z` directly from `zod` or `v` from `valibot`; always import from `@ws-kit/zod` or `@ws-kit/valibot`
  - ❌ `import { z } from "zod"` — Creates dual package hazard; breaks type inference
  - ✅ `import { z } from "@ws-kit/zod"` — Single source; full type safety

**ESLint Enforcement:**

```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "name": "zod",
        "message": "Import from @ws-kit/zod instead to avoid dual package hazard"
      },
      {
        "name": "valibot",
        "message": "Import from @ws-kit/valibot instead to avoid dual package hazard"
      }
    ]
  }
}
```

**Add to ESLint config:**

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["zod"], message: "Use @ws-kit/zod instead" },
          { group: ["valibot"], message: "Use @ws-kit/valibot instead" },
        ],
      },
    ],
  },
};
```

### Runtime Selection (ADR-006)

**Production deployments MUST declare runtime explicitly:**

- **ALWAYS** specify explicit `runtime` or use platform-specific entrypoint → ADR-006
  - Explicit: `serve(router, { runtime: "bun", ... })`
  - Platform-specific: `import { serve } from "@ws-kit/serve/bun"`
  - Environment variable: `serve(router, { runtime: process.env.WSKIT_RUNTIME as any, ... })`
- **NEVER** rely on auto-detection in production → ADR-006
- **ALWAYS** use one of: `"bun"` | `"cloudflare-do"` | `"deno"` → ADR-006

**Examples:**

```typescript
// ✅ Platform-specific (recommended for single-target)
import { serve } from "@ws-kit/serve/bun";
serve(router, { port: 3000 });

// ✅ Explicit runtime (multi-runtime deployments)
serve(router, { runtime: "bun", port: 3000 });

// ✅ Environment-driven (CI/CD deployments)
serve(router, { runtime: process.env.WSKIT_RUNTIME as any, port: 3000 });
```

### Security & Validation

- **NEVER** re-validate in handlers (trust schema) → @validation.md#Flow
- **ALWAYS** use strict schemas (reject unknown keys) → @schema.md#Strict-Schemas

### Identity & Reserved Keys (Critical for Security)

- **NEVER** access `clientId` via `ctx.meta.clientId` — server generates it; use `ctx.ws.data.clientId` instead → @validation.md#normalization-rules
- **NEVER** allow clients to set reserved keys (`clientId`, `receivedAt`) — routers strip them during normalization → @validation.md#normalization-rules
- **NEVER** trust client-provided `receivedAt` timestamps — use `ctx.receivedAt` for authoritative server time → @schema.md#Which-timestamp-to-use
- **ALWAYS** access identity via `ctx.ws.data.clientId` in handlers and middleware → @router.md#Type-Safe-Sending

---

## Required Patterns (ALWAYS Use)

### Schema & Validation {#validation-flow}

- **ALWAYS** follow validation flow (Parse → Type Check → Lookup → Normalize → Validate → Middleware → Handler) → @validation.md#Flow
- **ALWAYS** normalize before validate (strip reserved keys BEFORE schema) → @validation.md#normalization-rules

### Middleware

- **ALWAYS** use `router.use(middleware)` for global middleware → @router.md#Middleware
- **ALWAYS** use `router.use(schema, middleware)` for per-route middleware → @router.md#Middleware
- **ALWAYS** call `next()` to continue to next middleware or handler → @router.md#Middleware
- **ALWAYS** skip calling `next()` to prevent handler execution → @router.md#Middleware
- **ALWAYS** register global middleware before per-route middleware → @router.md#Middleware

### Connection & Context

- **ALWAYS** access identity via `ctx.ws.data.clientId` → @validation.md#Reserved-Meta-Keys
- **ALWAYS** use `ctx.receivedAt` for server logic → @schema.md#Which-timestamp-to-use
- **ALWAYS** use `ctx.assignData(partial)` to merge connection data updates (write-partial pattern) → @router.md#Modifying-Connection-Data
- **NEVER** mutate `ctx.ws.data` directly; use `assignData()` → @router.md#Modifying-Connection-Data

### Type System

- **ALWAYS** use intersection types for conditional `payload` → ADR-001

### Error Handling {#error-handling}

- **ALWAYS** use `ctx.error(code, message, details)` for type-safe error responses → ADR-009, @error-handling.md
- **ALWAYS** wrap async ops in try/catch → @error-handling.md
- **ALWAYS** keep connections open (handler must close explicitly) → @error-handling.md
- **ALWAYS** log errors with `clientId` for traceability → @error-handling.md
- **ALWAYS** implement `onError` hook in `serve()` for centralized error handling → ADR-009

### Messaging

- **ALWAYS** use `ctx.send()` for unicast → @router.md#Type-Safe-Sending
- **ALWAYS** use `ctx.reply()` as alias for `ctx.send()` when responding to requests → @router.md#Type-Safe-Sending
- **ALWAYS** use `router.publish()` for multicast (validates before broadcast) → @broadcasting.md
- **ALWAYS** use `ctx.error()` for sending error messages to clients → @error-handling.md
- **NEVER** inject `clientId` into meta (use `origin` option for sender tracking) → @broadcasting.md#Origin-Option
- **ALWAYS** auto-inject `timestamp` in outbound messages → @router.md#Type-Safe-Sending
- **NEVER** send `ERROR` from clients unless implementing custom protocol (server-to-client by default) → @error-handling.md#Error-Message-Direction

### Lifecycle Hooks (ADR-009)

- **ALWAYS** implement lifecycle hooks in `serve()` options for observability → ADR-009, @router.md#Lifecycle-Hooks
  - `onUpgrade(req)` — Before authentication (connection setup)
  - `onOpen(ctx)` — After authentication (safe to send messages)
  - `onClose(ctx)` — After disconnect (cleanup)
  - `onError(error, ctx)` — Centralized error handling
  - `onBroadcast(message, scope)` — Track broadcast events
- **ALWAYS** unsubscribe in `onClose()` → @broadcasting.md
- **ALWAYS** store topic IDs in `ctx.ws.data` → @broadcasting.md
- **NEVER** throw in lifecycle hooks; errors are caught and logged → ADR-009

---

## Type System Trade-offs

Accept these TypeScript violations for better DX:

- **LSP variance in `merge()`** → ADR-001
- **`| any` in `merge()`** (allows derived router instances) → ADR-001
- **`@ts-expect-error` in type overrides** (enables IDE inference) → ADR-001

---

## Performance Requirements {#performance}

- **UUID v7 for `clientId`** (time-ordered, better DB indexing)
- **Map-based handler lookup** (O(1) by message type)
- **Last-write-wins registration** (log warnings on overwrite)
- **Single handler per type** (server only; client supports multi-handler)
- **Normalization in hot path** (strip reserved keys inline; O(k) where k≤3)

---

## State Layering {#state-layering}

### Connection State (`ctx.ws.data`)

- `clientId`: Generated during upgrade (UUID v7), NOT in message `meta`
- Custom session data (userId, roles, etc.)

### Message State (`ctx.meta`)

- `correlationId`: Client-controlled request/response correlation
- `timestamp`: Producer time (client's clock, optional)
- Extended meta fields from schema

### Server Context (`ctx`)

- `receivedAt`: Server receive timestamp (authoritative, separate from `meta.timestamp`)

---

## Reserved Server-Only Keys {#reserved-keys}

**CANONICAL LIST** (see @validation.md#normalization-rules for implementation):

- `clientId`: Connection identity (access via `ctx.ws.data.clientId`)
- `receivedAt`: Server receive timestamp (access via `ctx.receivedAt`)

**Enforcement:**

- Routers MUST strip reserved keys during normalization (security boundary) → @validation.md#normalization-rules
- Schema creation MUST reject extended meta defining reserved keys (fails fast at design time) → @schema.md#Reserved-Server-Only-Meta-Keys

---

## Client-Side Constraints

> Applies to browser/Node client (`@ws-kit/client`)

### Message Normalization (Outbound)

- **ALWAYS** strip reserved/managed keys (`clientId`, `receivedAt`, `correlationId`) from `opts.meta` → @client.md#client-normalization
- **ALWAYS** merge meta in order: `{ timestamp: Date.now(), ...sanitizedUserMeta, correlationId }` → @client.md#client-normalization
- **ALWAYS** provide `correlationId` via `opts.correlationId` (NOT `opts.meta.correlationId`) → @client.md#client-normalization
- **ALWAYS** auto-generate `correlationId` for `request()` if absent → @client.md#client-normalization

### Connection Behavior

- **ALWAYS** reject pending `request()` on close (`ConnectionClosedError`) → @client.md#Error-Contract
- **ALWAYS** reject `request()` with `StateError` when `state !== "open"` and `queue: "off"` → @client.md#Error-Contract
- **NEVER** auto-retry `send()` or `request()` after close (at-most-once delivery) → @client.md
- **ALWAYS** start timeout AFTER message flush on OPEN socket (not when queued) → @client.md#request-timeout
- **ALWAYS** make `close()` fully idempotent (never throw/reject due to state) → @client.md#Error-Contract

### Request/Response Correlation

- **ALWAYS** reject `request()` with `ValidationError` when reply has wrong type (matching `correlationId`) → @client.md#Correlation
- **ALWAYS** reject `request()` with `ServerError` when reply type is `ERROR` (matching `correlationId`) → @client.md#Correlation
- **ALWAYS** drop duplicate replies silently (only first settles promise) → @client.md#Correlation
- **ALWAYS** reject `request()` with `StateError` when `opts.signal.aborted === true` before dispatch → @client.md#request-timeout
- **ALWAYS** clean up AbortSignal listeners automatically → @client.md#request-timeout

### Client Error Contract

- **Synchronous throws (`TypeError`)**: Only during setup/preflight validation → @client.md#Error-Contract
- **Fire-and-forget (`send()`)**: NEVER throws; returns `boolean` → @client.md#fire-and-forget-return
- **Promise-based methods**: NEVER throw synchronously; return `Promise` that may reject → @client.md#Error-Contract
- **StateError**: ALWAYS a Promise rejection, NEVER a synchronous throw → @client.md#Error-Contract

### Inbound Message Routing

- **ALWAYS** route schema handlers BEFORE `onUnhandled()` hook → @client.md#message-processing-order
- **NEVER** pass invalid messages to `onUnhandled()` (drop at validation) → @client.md#message-processing-order
- **ALWAYS** treat messages in `onUnhandled()` as readonly → @client.md#message-processing-order

---

## Server vs Client Patterns {#server-client-asymmetry}

### Handler Registration

| Context | Behavior                             | Rationale                                                         |
| ------- | ------------------------------------ | ----------------------------------------------------------------- |
| Server  | Last-write-wins (warns on overwrite) | Single authoritative handler per message type; simplified routing |
| Client  | Multi-handler (registration order)   | Fan-out pattern common in UI; composability across modules        |

See @client.md#Multiple-Handlers for client multi-handler semantics.

---

## Route Composition Patterns

- **Use `merge()`** for feature module composition
- **Pass auth/session data during `upgrade()`**
- **Store connection metadata in `ctx.ws.data`** for lifecycle cleanup

---

## Server-Side Development Patterns

- **Use `message()` helper** (export-with-helpers pattern) for type-safe schema creation → ADR-007
- **Use `createRouter()`** to create a new router instance → ADR-007
- **Use `ctx.assignData()`** for incremental connection data updates (write-partial pattern) → @router.md#Modifying-Connection-Data
- **Use `ctx.error()`** for type-safe error responses with discriminated union codes → ADR-009
- **Use `ctx.reply()`** as semantic alias to `ctx.send()` for request/response patterns → ADR-009
- **Use lifecycle hooks** (`onOpen`, `onClose`, `onError`, etc.) for observability → ADR-009

## Client-Side Development Patterns

- **Use `message()` helper** (export-with-helpers pattern) for schema creation → ADR-007
- **Use typed clients** (`@ws-kit/client/zod` or `@ws-kit/client/valibot`) for full type inference → ADR-002
- **Share schemas** between client and server (single source of truth) → @client.md#Sharing-Schemas-Between-Client-and-Server
- **Validate before sending** with strict mode (schemas work client-side) → @validation.md
- **Use `request()`** for RPC-style request/response with automatic correlationId and timeout → @client.md#Public-API
- **Use `send()`** for fire-and-forget (returns boolean, never throws) → @client.md#fire-and-forget-return
- **Track broadcasts** via `publish(..., { origin?: string; key?: string })` → @broadcasting.md#Origin-Option
