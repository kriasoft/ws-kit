# ADR-034: WebSocket Upgrade Return Semantics for Bun

**Status**: ✅ Implemented

**Date**: 2025-11-16

**Related**: [ADR-031 Plugin-Adapter Architecture](./031-plugin-adapter-architecture.md), [adapters.md spec](../specs/adapters.md)

## Context

Bun's `fetch` handler implements a **strict runtime contract** for WebSocket upgrades:

- When `server.upgrade(req, ...)` returns `true`, Bun has **internally sent the 101 response** and completed the HTTP exchange
- Bun **does not expect** the fetch handler to return a `Response` on successful upgrade
- Returning a `Response` after successful upgrade violates this contract and may cause runtime errors

The original `@ws-kit/bun` adapter returned `new Response(null, { status: 200 })` on success, contradicting this contract. This is a **platform runtime invariant** that must be satisfied.

## Decision

The `BunHandler.fetch` handler MUST:

1. **Return `void` (nothing) on successful WebSocket upgrade**
   - Signals Bun that the HTTP request is fully handled and the socket is now a WebSocket
   - No HTTP response is sent or expected after a successful upgrade

2. **Return `Response` only on failure**
   - `400` (invalid handshake) when `server.upgrade()` returns `false`
   - `500` (unexpected adapter error) when authentication or processing throws

3. **Widen the type** to `Response | void | Promise<Response | void>`
   - Makes the contract explicit; `void` return is valid and expected
   - Type system enforces correct handling in composition

4. **Extract upgrade logic** into `attemptWebSocketUpgrade()` helper
   - Isolates UUID generation, authentication, data preparation from return-value semantics
   - Enables isolated unit testing
   - Clarifies separation of concerns

**This establishes the Adapter Fetch Contract for Bun platform adapters.**

## Rationale

### Runtime Correctness

Bun terminates the fetch handler immediately after a successful upgrade. Returning `Response` violates this invariant and risks "headers already sent" or undefined behavior in current or future Bun versions. Aligning the adapter with Bun's documented behavior is non-negotiable.

This also aligns with ADR-030: context is created **after** the WebSocket upgrade, not before.

### Fetch Handler Composition

By establishing that successful upgrades return `void`, fetch handler composition becomes safe and predictable:

```typescript
async function fetch(req: Request, server: Server): Promise<Response | void> {
  if (isWebSocketPath(req)) {
    return wsFetch(req, server); // May return void (success) or Response (error)
  }
  return httpFetch(req); // Always returns Response
}
```

Plugin authors and middleware developers can rely on this contract.

### Type Safety

The widened return type makes the contract visible at the type level:

- TypeScript errors if code assumes always-`Response`
- Prevents undefined-passed-to-Response bugs
- Clarifies that both outcomes are valid

### Correct HTTP Semantics

- `400` for invalid WebSocket requests (client's responsibility)
- `500` only for unexpected adapter failures (server's responsibility)
- Clearer signal for monitoring and debugging

## Consequences

### Positive

- ✅ **Correct Runtime Behavior**: No violation of Bun's fetch contract
- ✅ **Type-Safe Composition**: Handler composition is safe and predictable
- ✅ **Isolated Testing**: `attemptWebSocketUpgrade()` is unit-testable in isolation
- ✅ **Better Diagnostics**: HTTP status codes align with actual error cause

### Trade-offs

- ⚠️ **Type Breaking Change**: Code directly typing `BunHandler.fetch` must handle `void` returns
  - Mitigation: Most users call `serve()` or `createDefaultBunFetch`, which work seamlessly
  - Type errors guide developers to the correct pattern

- ⚠️ **HTTP Status Change**: Upgrade failures now return `400` instead of `500`
  - This is correct semantically (client error, not server error)
  - Monitoring rules should be updated

- ⚠️ **Composition Awareness**: Code wrapping or intercepting fetch handlers must account for `void` returns
  - Middleware that logs/inspects responses should check for `undefined` first

## Implementation

All changes are in `packages/bun/src/`:

- **handler.ts**: Extract `attemptWebSocketUpgrade()`, simplify `fetch()` to return `void` on success, `Response` on failure
- **types.ts**: Widen `BunHandler.fetch` return type to `Response | void | Promise<Response | void>`
- **Tests**: Assert `undefined` on success, `400` on failure (not `500`)

## Scope

**This ADR applies to the Bun platform adapter only.** Other runtimes (Node, Cloudflare, Deno) have different upgrade semantics. Each adapter MUST define its own fetch contract consistent with its platform's upgrade model.

For routing non-WebSocket requests in multiplexed scenarios, see [adapters.md: routing patterns](../specs/adapters.md).

## References

- [Bun `server.upgrade()` documentation](https://bun.sh/docs/api/websockets#upgrade)
- [ADR-031: Plugin-Adapter Architecture](./031-plugin-adapter-architecture.md)
