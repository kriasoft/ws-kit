# ADR-014: RPC Developer Experience and Safety Improvements

**Status:** Implemented
**Date:** 2025-10-30
**References:** ADR-012, ADR-013

## Problem

While core RPC reliability features are production-ready (abort, deadlines, one-shot, backpressure), several developer experience issues remain:

1. **Implicit correlation policy**: Clients must manually generate `correlationId`; missing IDs cause silent match failures
2. **Unclear intent**: No explicit method to signal "send to this client" vs. other send methods
3. **Idempotency key format** left to apps; no helper for consistent canonicalization
4. **Reserved prefix enforcement**: Runtime filtering works, but schema creation doesn't fail fast
5. **Typed error codes**: No client-side type narrowing for error handling
6. **Backpressure tuning**: Configuration hidden; no platform-specific guidance

## Solution

Six surgical DX improvements keeping the API surface minimal:

### 1. Auto-Correlation (Client + Server)

**Problem**: Manual correlation IDs are error-prone.

**Solution**:

- **Client**: Auto-generate `correlationId` using `crypto.randomUUID()` if not provided
- **Server**: Synthesize missing `correlationId` for RPC messages; tag with `meta.syntheticCorrelation = true` for debugging

**Impact**: Zero-cost invariant (every RPC always has a correlationId)

```typescript
// Client side (automatic)
const correlationId = opts?.correlationId ?? crypto.randomUUID();

// Server side (fallback)
if (isRpc && !correlationId) {
  correlationId = crypto.randomUUID();
  meta.syntheticCorrelation = true; // For debugging
}
```

### 2. Primary Method: `ctx.send()` for Semantic Clarity

**Problem**: Single send method doesn't clearly signal intent (unicast to sender vs. broadcast).

**Solution**:

- Introduce `ctx.send()` as the primary method for sending to client (always available)
- Clear semantics: "send to this client only"
- Functionally identical to `ctx.send()`

```typescript
router.on(QueryMessage, (ctx) => {
  const result = await queryDatabase(ctx.payload);
  ctx.send(QueryResponse, result); // Clear: send to this client only
});
```

### 3. Typed RpcErrorCode for Client Error Narrowing

**Problem**: No way to type-narrow error codes in catch blocks.

**Solution**:

- Export `RpcErrorCode` union type from client
- Make `RpcError` generic: `RpcError<TCode extends RpcErrorCode>`

```typescript
export type RpcErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "RESOURCE_EXHAUSTED"
  | "DEADLINE_EXCEEDED"
  | "CANCELLED"
  | "INTERNAL"
  | "ONE_SHOT"
  | string; // Allow custom codes
```

**Usage**:

```typescript
try {
  await client.request(Query, payload);
} catch (e) {
  if (e instanceof RpcError && e.code === "RESOURCE_EXHAUSTED") {
    // Type-narrowed: retryAfterMs guaranteed present
    await sleep(e.retryAfterMs ?? 100);
  }
}
```

### 4. Idempotency Helper: `stableStringify()` + `idempotencyKey()`

**Problem**: Apps roll their own payload hashing; leads to inconsistent formats and DoS risks (expensive hashes).

**Solution**:

- Export `stableStringify(data)` for canonical JSON (sorted keys, consistent output)
- Export `idempotencyKey(opts)` helper for standard key generation

```typescript
import { stableStringify, idempotencyKey } from "@ws-kit/core";
import crypto from "node:crypto";

const payload = { user: "alice", action: "purchase" };
const hash = crypto
  .createHash("sha256")
  .update(stableStringify(payload))
  .digest("hex");

const key = idempotencyKey({
  tenant: ctx.data?.tenantId,
  user: ctx.data?.userId,
  type: ctx.type,
  hash,
});

// Result: "tenant:alice:purchase:abc123def..."
```

**Recommendation** (documented in ADR-013):

- Domain-key first: `tenant:user:type:hash`
- Cap key length: 256 bytes
- Hash payload with SHA256 (fast, secure)

### 5. Reserved Prefix Enforcement at Design-Time

**Problem**: Runtime filtering works, but schema creation doesn't fail fast.

**Solution**:

- Add validation in `rpc()` and `message()` helpers
- Throw immediately if type starts with `$ws:`

```typescript
// In packages/zod/src/schema.ts, packages/valibot/src/schema.ts
const RESERVED_PREFIX = "$ws:";
if (requestType.startsWith(RESERVED_PREFIX)) {
  throw new Error(`Reserved prefix "${RESERVED_PREFIX}" not allowed...`);
}
```

**Impact**: Developers catch mistakes at definition time, not runtime

### 6. Backpressure Configuration Visibility

**Problem**: `maxQueuedBytesPerSocket` is a router option, but not visible in adapter docs.

**Solution**:

- Surface in adapter `serve()`/`handler()` options with JSDoc guidance
- Document platform-specific recommendations

**Adapter Guidance**:

```typescript
// @ws-kit/bun
serve(router, {
  maxQueuedBytesPerSocket: 1_000_000, // 1MB, advisory per platform
  // Bun: 1-4MB typical, varies by system memory
});

// @ws-kit/cloudflare
handler = createCloudflareHandler(router, {
  maxQueuedBytesPerSocket: 512_000, // 512KB, conservative for DO limits
  // DO: message cap ~125KB, request cap ~30MB
});
```

## Testing

New tests ensure invariants hold:

1. **Property tests**: One-shot, deadline, correlation invariants
2. **Reconnect fuzz**: Disconnect/reconnect with different resend policies
3. **Backpressure**: Buffer exceeded → `RESOURCE_EXHAUSTED` error, never partial replies
4. **Error code coverage**: All `RpcErrorCode` types tested
5. **Reserved prefix**: `rpc("$ws:BAD", ...)` throws at definition time

## Implementation Status

✅ **All changes implemented and tested:**

- Auto-correlation on client + server synthesis
- `ctx.send()` as primary send method
- `RpcError` generic with `RpcErrorCode` union
- `stableStringify()` and `idempotencyKey()` utilities
- Design-time reserved prefix validation
- All 953 tests passing

**Library Status**: This library has not been published yet, so all API decisions are final with no backward compatibility constraints.

## 7. Incomplete RPC Handler Detection

**Problem**: RPC handlers that complete without calling `ctx.reply()` or `ctx.error()` cause clients to hang with timeouts. This is a common developer mistake but only caught at runtime via client timeout, with no server-side warning.

**Solution**:

Add automatic warning in development mode when RPC handlers complete without sending a terminal response:

```typescript
// Enable by default (router option)
const router = createRouter({
  warnIncompleteRpc: true, // Default: enabled
});

// Disable for legitimate async patterns
const router = createRouter({
  warnIncompleteRpc: false, // For spawned async work
});
```

**Behavior**:

- **When enabled** (default): After RPC handler execution completes, check if terminal response was sent
- **If not terminal**: Emit warning with message type, correlation ID, and actionable guidance
- **Dev-mode only**: Warnings only in `NODE_ENV !== "production"`
- **Zero cost in production**: No checks or logging when disabled or in production

**Warning message example**:

```text
[ws] RPC handler for GET_USER (req-abc123) completed without calling ctx.reply() or ctx.error().
Client may timeout. Consider using ctx.reply() to send a response, or disable this warning
with warnIncompleteRpc: false if spawning async work.
```

**Use cases**:

✅ **Caught immediately**:

- Sync handlers that forget reply
- Async handlers that return early without error
- Handlers with conditional returns missing error cases

✅ **Known false positive (legitimate async)**:

- `setTimeout(() => ctx.reply(...), delay)` — warns because reply happens after handler completes
- `setImmediate(() => ctx.reply(...))` — same pattern

**Mitigation for async patterns**:

Either disable the warning or use a pattern that marks async work:

```typescript
// Option 1: Disable warning (for known async patterns)
const router = createRouter({ warnIncompleteRpc: false });

// Option 2: Use explicit deferral (future enhancement)
// ctx.defer(() => reply()): // Explicitly mark async work
```

**Testing**:

Tests verify:

- Warning fires for sync/async handlers without reply
- No warning when reply or error is sent
- No warning for non-RPC messages
- Respects `warnIncompleteRpc: false` config
- Warning only in dev mode
- Warning includes message type and correlation ID

See `packages/core/test/features/rpc-incomplete-warning.test.ts` for full test coverage.

## Future Work

- Streaming RPC with enhanced AsyncIterable client API
- Client-side AbortSignal sending `$ws:abort`
- Reconnect policy options (explicit `resendOnReconnect` knob)

## References

- [ADR-012: Minimal Reliable RPC](./012-rpc-minimal-reliable.md) — Core lifecycle features
- [ADR-013: Reconnect & Idempotency Policy](./013-rpc-reconnect-idempotency.md) — Client resend logic
- [RPC Troubleshooting](../guides/rpc-troubleshooting) — Common issues and solutions
