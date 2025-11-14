# ADR-012: Minimal Reliable RPC for WebSocket Routing

## Metadata

- **Date**: 2025-10-30
- **Status**: Accepted
- **Tags**: RPC, reliability, request-response, type-safety

## Context

WebSocket-based request-response patterns (RPC) are common in real-time applications. WS-Kit already provides basic RPC via schema-bound pairs (`rpc()` helper), but lacked production-hardening features critical for reliability:

- **No cancellation**: Long-running queries couldn't be aborted, wasting server resources.
- **No reconnection policy**: In-flight RPCs orphaned on disconnect, with no safe resend mechanism.
- **No backpressure**: Unbounded buffering could exhaust memory under high throughput.
- **Weak error contract**: Clients couldn't distinguish between retryable and fatal errors.
- **No deadline propagation**: Server couldn't short-circuit work past timeout.

These gaps made RPC feel "toy-grade" for production, despite strong type inference.

## Decision

Implement minimal, composable RPC features focused on reliability without bloating the core:

### 1. **Internal Abort Protocol** (`$ws:abort`)

- Client sends internal `$ws:abort` control frame when `AbortSignal` fires or socket closes.
- Server triggers `ctx.onCancel()` callbacks for cleanup (cancel queries, release locks, etc.).
- No new public API; handled internally by router.

### 2. **Server-Derived Deadlines**

- Client sends `meta.timeoutMs` (optional); server computes `ctx.deadline = receivedAt + timeoutMs`.
- Prevent clock-skew exploits; handlers check `ctx.timeRemaining()` for short-circuit logic.
- No automatic termination; advisory only.

### 3. **One-Shot Reply Guard**

- After `ctx.reply()` or `ctx.error()`, further sends are no-ops with debug log.
- Prevents accidental double-sends or mixed terminals (reply→error).
- Simplifies handler logic; no explicit "replied" flags needed.

### 4. **Structured RPC Error Contract**

- RPC errors sent as `RPC_ERROR` wire format with `code`, `message`, `details`, `retryable`, `retryAfterMs`.
- Client maps to `RpcError` exception with typed `code` field.
- Validation failures send `RPC_ERROR{VALIDATION}`, socket stays open (not closed).

### 5. **Backpressure: Fail-Fast Policy**

- Configurable `maxQueuedBytesPerSocket` (default 1MB).
- If buffered exceeds threshold during RPC reply, send `RPC_ERROR{RESOURCE_EXHAUSTED,retryable:true, retryAfterMs:100}` and abort RPC.
- No unbounded queuing; predictable behavior under load.

### 6. **Progress Messages (Streaming Foundation)**

- `ctx.send()` for progress auto-copies `correlationId` from request.
- Allows multi-message RPC responses without new primitive.
- Foundation for future streaming enhancements.

### 7. **RPC Detection & Context Flags**

- Router auto-detects RPC (schema has `.response` property).
- `ctx.isRpc` flag for middleware to apply RPC-specific logic (auth, rate-limit, idempotency).
- `ctx.onCancel()` only available for RPC messages.

### 8. **Reserved Control Prefix** (`$ws:`)

- User message types cannot start with `$ws:` (enforced at schema registration).
- Internal control frames (`$ws:abort`, `$ws:ping`, etc.) filtered before validation.
- Prevents user-defined message type from colliding with protocol frames.

## Alternatives Considered

1. **Expose `ctx.progress()` primitive**: Adds API surface; reusing `ctx.send()` + auto-correlation is simpler.
2. **RPC-specific hooks** (`onAuth`, `onBefore`, `onAfter`): Reuse existing middleware pattern with `ctx.isRpc` flag—less API growth.
3. **Automatic RPC error retry**: Moves policy to core; better as pattern/middleware with per-app retry logic.
4. **Soft deadline enforcement**: Server auto-closes RPCs past deadline; may interrupt cleanup; timeouts are client-enforced instead.
5. **Public abort control messages**: Expose `$ws:abort` to applications; simpler to keep internal—don't expose protocol internals.

## Consequences

### Benefits

- **Reliability**: Abort, backpressure, and deadlines prevent resource leaks and cascading failures.
- **Type Safety**: Structured errors + typed `code` field integrate with client exception handling.
- **Composability**: One-shot guard and isRpc flag enable middleware (auth, idempotency, rate-limit) without core bloat.
- **Non-breaking**: Existing non-RPC routing unaffected; RPC is opt-in via `rpc()` schema.
- **Performance**: Minimal overhead; RPC state tracked per-correlation (O(1) lookups).

### Risks / Trade-offs

- **Complexity**: One-shot tracking adds modest code (offset by fewer handler bugs).
- **Control Protocol**: `$ws:` prefix reserved; users cannot define messages starting with it (documented, runtime-enforced).
- **Deadline Semantics**: Client-supplied `timeoutMs` used as hint; server derives deadline. Clock skew could cause mis-calculation (mitigated by server-side derivation; documented).

### Maintenance

- RPC state map must be cleaned up on disconnect (done via `handleClose()`).
- New test suite covers abort, one-shot, deadline, backpressure, validation (conformance tests prevent regressions).

## Implementation: ctx.error() One-Shot Guard

`ctx.error(code, message, details, opts)` is a terminal method (like `ctx.reply()`) enforced by the same RPC state tracking: the first call to either `.reply()` or `.error()` marks the RPC as responded; further calls become no-ops (logged in dev mode). This prevents accidental double-responses and unifies error/success paths under one reliability model.

**Wire Format**: Errors are sent as `RPC_ERROR` frames with structured `{code, message, details, retryable, retryAfterMs}` to allow clients to distinguish retryable failures (e.g., "RESOURCE_EXHAUSTED", backoff advised) from fatal ones (e.g., "NOT_FOUND", don't retry).

**Example**:

```typescript
router.rpc(GetUserMsg, (ctx) => {
  const user = db.get(ctx.payload.id);
  if (!user) {
    // Terminal: RPC ends here; any further .reply() or .error() ignored
    return ctx.error("NOT_FOUND", "User not found", { id: ctx.payload.id });
  }
  // Success path: symmetric to error path
  ctx.reply({ id: user.id, name: user.name });
});
```

---

## References

- **RPC Helper**: `packages/zod/src/schema.ts:rpc()`
- **Router RPC Impl**: `packages/core/src/router.ts` — `rpcStates` map, `getRpcState()`, `cancelRpc()`, etc.
- **Types**: `packages/core/src/types.ts` — `RpcAbortWire`, `RpcErrorWire`, `ctx.isRpc`, `ctx.onCancel()`
- **Constants**: `packages/core/src/constants.ts` — `RESERVED_CONTROL_PREFIX`, backpressure/timeout defaults
- **Specs**:
  - `docs/specs/router.md#RPC-Invariants` (unicast, one-shot, validation→RPC_ERROR)
  - `docs/specs/schema.md#Meta-Fields` (timeoutMs, idempotencyKey, control prefix rule)
- **Future work**: Client abort signal support, reconnect policy, idempotency middleware pattern.
