# ADR-036: Unified Error Handling — `ctx.error()` as Core Primitive

**Status**: Accepted

**Related**: [ADR-015 Unified RPC API Design](./015-unified-rpc-api-design.md), [ADR-009 Error Handling and Lifecycle Hooks](./009-error-handling-and-lifecycle-hooks.md), [ADR-031 Plugin-Adapter Architecture](./031-plugin-adapter-architecture.md), [ADR-030 Context Methods Design](./030-context-methods-design.md)

## Context

Documentation and type definitions promise `ctx.error()` in all handler contexts (events, RPC, middleware), but the runtime implementation is incomplete:

- Only the RPC plugin provides `ctx.error()`, not event contexts.
- The RPC implementation uses a private `"$ws:rpc-error"` wire type instead of the canonical `"RPC_ERROR"`.
- Error metadata (retry semantics, backoff hints) is not surfaced via `ERROR_CODE_META`.
- The `cause` field is missing for error chain preservation.
- No unified lifecycle hook to observe all application errors (thrown + explicit `ctx.error()` calls).

This creates a mismatch between documented and runtime behavior, and developers lack a consistent error-reporting API across different handler types.

## Decision

Establish `ctx.error()` as a **core primitive** on every `MinimalContext`, with a single unified implementation that:

1. **Available everywhere**: Attached to all message contexts (events, RPC, middleware) via an early context enhancer.

2. **Fire-and-forget semantics**: Returns `void` (never `Promise<void>`). Enqueued asynchronously and returns immediately. No backpressure, signal, or drain semantics (those belong to `reply()` and `send()` only).

3. **Unified wire format**: Sends canonical `"ERROR"` for event contexts and `"RPC_ERROR"` for RPC contexts (distinguishing semantic), both using the same `ErrorPayload` structure.

4. **RPC one-shot semantics**: For RPC handlers, `ctx.error()` shares a reply guard with `ctx.reply()` and `ctx.progress()`. Only the first terminal call sends; subsequent calls are no-ops.

5. **Retry inference from metadata**: Uses `ERROR_CODE_META` for standard error codes to automatically infer:
   - `retryable` (boolean | "maybe" for custom errors)
   - `suggestBackoffMs` (recommended client backoff interval)
   - Allow explicit overrides via `ErrorOptions.retryable` and `ErrorOptions.retryAfterMs`

6. **Error chain preservation**: Accepts an optional `cause` parameter (WHATWG standard) for error chain preservation during wrapping/translation.

7. **Lifecycle routing**: All errors created via `ctx.error()` are passed through `router.onError()` handlers (same as thrown handler errors), ensuring unified observability.

## Rationale

- **DX Consistency**: Developers use the same method signature across all handler types; no "different error APIs for different contexts."
- **Type Safety**: Standard error codes are fully typed; custom domain codes preserve literal type.
- **Observability Unity**: All application errors (whether thrown or explicit) flow through `router.onError()`, enabling consistent logging, metrics, and error tracking.
- **Fire-and-Forget Semantics**: `ctx.error()` never blocks on observability handlers. Lifecycle hooks run asynchronously in the background, decoupling error response latency from logging/metrics infrastructure. This ensures that slow observability systems don't slow down client error reporting.
- **Protocol Clarity**: The wire format automatically selects `RPC_ERROR` vs `ERROR` based on context, eliminating manual coordination.
- **Backward Compatibility**: Pre-1.0 clients using `@ws-kit/client` upgrade automatically to recognize the new `"RPC_ERROR"` type.

## Consequences

1. **Wire Format Change**: RPC errors now send `type: "RPC_ERROR"` (instead of `"$ws:rpc-error"`). Clients must upgrade to recognize this type. Since ws-kit is pre-1.0, this is acceptable as a minor breaking change.

2. **Plugin Constraints**: Plugins (validation, pubsub, etc.) MUST NOT redefine or override `ctx.error()`. If a plugin needs domain-specific error handling, it should enhance context with a separate method (e.g., `ctx.validateError()`) rather than shadowing the core primitive.

3. **RPC Terminal State**: Calls to `ctx.reply()`, `ctx.progress()`, or `ctx.error()` are now mutually exclusive. Once any terminal response is sent, subsequent calls are no-ops. This is already enforced for `reply()` / `progress()` and is now extended to `error()`.

4. **Lifecycle Observability**: `router.onError()` handlers are triggered asynchronously for all application errors (whether thrown or via `ctx.error()`). The error method does not wait for them; handlers run in the background without blocking the response. If handlers throw, exceptions are logged and swallowed to prevent disrupting the application.

## Implementation

### Core Components

- **`error-handling.ts`**: Exports `createErrorMethod()` and `createCoreErrorEnhancer()`.
  - `createErrorMethod()` builds the context method, takes a `LifecycleManager` for observability.
  - `createCoreErrorEnhancer()` returns an enhancer function; registered early (-1000 priority) in router constructor.

- **`base-context.ts`**: Defines `error()` signature on `MinimalContext`.

- **`rpc-context.ts`**: Does NOT redefine `error()`; inherits from `MinimalContext`.

- **`error.ts`**: Provides `WsKitError`, `ERROR_CODE_META`, `isStandardErrorCode()` for metadata and type guards.

### Wire Format

Non-RPC context:

```json
{
  "type": "ERROR",
  "meta": {
    /* client-provided metadata */
  },
  "payload": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": { "userId": "123" },
    "retryable": false
  }
}
```

RPC context:

```json
{
  "type": "RPC_ERROR",
  "meta": { "correlationId": "req-uuid" /* ... */ },
  "payload": {
    /* same structure as above */
  }
}
```

### Router API

```typescript
// User-facing
router.onError((err, ctx) => {
  // Called for all application errors:
  // - thrown exceptions in handlers/middleware
  // - explicit ctx.error() calls
  console.error(`[${ctx?.clientId}] ${err.code}: ${err.message}`);
});

// Handler usage
router.on(MyMessage, (ctx) => {
  if (!authorized) {
    ctx.error("PERMISSION_DENIED", "Access denied");
  }
  // ...
});

router.rpc(MyRequest, (ctx) => {
  try {
    const result = await performWork(ctx.payload);
    ctx.reply(result);
  } catch (err) {
    // Caught error flows through lifecycle + error send
    throw err;
  }
  // Or explicit: ctx.error("INTERNAL", "Work failed", { cause: err });
});
```

## Scope

**In scope:**

- `ctx.error()` signature and fire-and-forget semantics
- Unified wire format (`ERROR` vs `RPC_ERROR`)
- One-shot semantics for RPC (shares reply guard)
- Retry metadata inference from `ERROR_CODE_META`
- Lifecycle routing via `router.onError()`
- Support for standard and custom error codes
- Type-safe error code literals

**Out of scope:**

- Client-side UI error handling
- Adapter-specific error responses
- Richer observability frameworks (that's a future plugin concern)
- Authorization/authentication logic (delegated to middleware)

## Versioning

- **Pre-1.0 minor breaking change**: Wire format rename + feature parity.
- **Client libraries** (`@ws-kit/client/zod`, `@ws-kit/client/valibot`) should be updated to recognize `"RPC_ERROR"` type in addition to legacy `"$ws:rpc-error"`.
- **Changelog entry**: Note the wire format change and that `ctx.error()` is now a core primitive.

## References

- [ADR-015: Unified RPC API Design](./015-unified-rpc-api-design.md) — Error code taxonomy and gRPC alignment
- [ADR-009: Error Handling and Lifecycle Hooks](./009-error-handling-and-lifecycle-hooks.md) — Lifecycle hook design
- [ADR-030: Context Methods Design](./030-context-methods-design.md) — Unified send/reply/progress API
- [ADR-031: Plugin-Adapter Architecture](./031-plugin-adapter-architecture.md) — Plugin constraints and API boundaries
- [docs/specs/error-handling.md](../specs/error-handling.md) — Error code catalog and wire format
- [docs/specs/router.md](../specs/router.md) — Router lifecycle and handler registration
