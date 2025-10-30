# ADR-015: Unified RPC API Design with Explicit Primitives

**Status:** Implemented
**Date:** 2025-10-30
**References:** ADR-012, ADR-013, ADR-014, docs/feedback/rpc.md (11 comments)

## Problem

While ADR-014 addressed many RPC developer experience issues, further analysis of production usage patterns and expert feedback revealed opportunities for deeper API simplification:

1. **Dual message APIs**: Separate `rpc()` and `message()` functions create mental overhead
2. **Implicit terminal intent**: No way to declare "this is the final response" at definition time
3. **Send method ambiguity**: Both `send()` and `unicast()` work for replies; unclear which is "correct"
4. **Error taxonomy mismatch**: Legacy codes (`VALIDATION_ERROR`, `AUTH_ERROR`, `RATE_LIMIT`) don't align with RPC standards
5. **Client API design**: Promise-based API doesn't clearly separate progress streams from terminal results
6. **Missing ergonomic helpers**: No `ctx.reply()` or `ctx.progress()` for RPC-specific operations

## Solution

Implementing an optimal API designed for clarity, type safety, and minimal cognitive load—taking full advantage of pre-v1 status (no backward compatibility constraints).

## Why Separate `on()` and `rpc()` Entry Points?

This design intentionally provides two distinct entry points for message handlers. While a single unified method with overloads is technically possible, the separation is justified for these reasons:

### 1. Intent Signaling (Primary Reason)

At the callsite, the method name itself communicates the handler's contract:

```typescript
router.on(UserLoggedIn, handler); // → "This is an event listener"
router.rpc(GetUser, handler); // → "This handler produces a reply"
```

For code reviewers, maintainers, and new team members, this clarity is invaluable. No need to inspect the schema or handler implementation to understand what the code does. This directly improves:

- **Code review velocity** — Reviewers spot intent without reading the entire handler
- **Onboarding** — New developers learn patterns faster
- **IDE discoverability** — Autocomplete shows `.rpc()` when you're looking for request/response
- **Grep-ability** — `git grep "router.rpc"` finds all RPC handlers

**Performance Note**: An internal `isRpc = !!schema.response` branch is negligible (O(1)). This design choice is for clarity, not optimization.

### 2. Operational Surface

RPC and event handlers have fundamentally different lifecycle and semantics:

**RPC handlers unlock** (and require):

- Correlation ID tracking (auto-assigned, prevents request/response mismatches)
- Inflight limits and deadlines (request timeout awareness)
- One-shot reply guarantee (multiple `ctx.reply()` calls guarded; only first one sent)
- Progress tracking (`ctx.progress()` for non-terminal updates before reply)
- Cancellation signals (client can abort mid-operation)
- Response schema validation (enforced at compile and runtime)

**Event handlers simplify to**:

- Fire-and-forget (no waiting, no correlation needed)
- Pub/sub (one-to-many, multicast)
- Side effects (notifications, logging, state mutations)
- Optional `ctx.send()` for unicast replies (not terminal, not guaranteed)

Separating the entry points makes this operational boundary explicit. A developer reading `router.rpc()` immediately knows "this has deadlines, correlation, one-shot guarantee." A developer reading `router.on()` knows "this is async and independent."

### 3. Type Safety & Developer Experience

The handler context type differs between the two:

```typescript
// RPC handler: ctx has reply/progress/abortSignal/deadline
router.rpc(GetUser, (ctx) => {
  ctx.reply?.({ user: ... });      // ✅ Available, type-safe
  ctx.progress?.({ stage: "..." }); // ✅ Available
  ctx.abortSignal?.addEventListener(...);  // ✅ Available
});

// Event handler: ctx does NOT have reply/progress
router.on(UserLoggedIn, (ctx) => {
  ctx.reply?.({ ... });      // ❌ Type error (never)
  ctx.progress?.({ ... });   // ❌ Type error (never)
  ctx.send(ResponseMsg, { ... });  // ✅ Use send() instead
  ctx.publish(topic, ...);   // ✅ Or publish to subscribers
});
```

This type narrowing happens **before runtime**, preventing entire classes of mistakes:

- Developers can't accidentally call `ctx.reply()` in an event handler
- IntelliSense guides developers to the right method
- Compile-time checks catch intent mismatches

### 4. Misuse Prevention & Guardrails

Dev-mode can enforce stricter contracts:

```typescript
// Dev warning: RPC schema registered with .on()?
if (schemaHasResponse && method === "on") {
  console.warn(
    `Message "${type}" has a response field but is registered with router.on(). ` +
      `Use router.rpc() for request/response patterns.`,
  );
}

// Dev error: Multiple replies in RPC handler?
if (this.replySent && process.env.NODE_ENV !== "production") {
  console.warn(
    `Handler for RPC "${correlationId}" already replied; ignoring duplicate.`,
  );
}
```

### 5. Future Extensibility

The separation leaves room to grow without API churn:

```typescript
// Today: streaming via progress + reply pattern
router.rpc(LongRunningQuery, (ctx) => {
  for await (const result of queryStream()) {
    ctx.progress?.(result); // Non-terminal, ordered updates
  }
  ctx.reply?.({ final: true }); // Terminal reply
});

// Semantics are already clear:
// - on() → fire-and-forget events
// - rpc() → request-response RPC with optional progress
// Future: client-side AsyncIterable convenience API
```

The current `ctx.progress()` and `ctx.reply()` methods provide the foundation for future streaming conveniences without API churn.

### 6. What NOT to Do

Common mistakes that the separation prevents:

```typescript
// ❌ WRONG: Event handler replying via send() as if it's RPC
router.on(GetUser, (ctx) => {
  ctx.send(GetUserResponse, { user: ... });  // Looks like reply, but not guaranteed
  // Client might not get response if backpressured or disconnected
});

// ✅ RIGHT: RPC handler with guaranteed reply
router.rpc(GetUser, (ctx) => {
  ctx.reply?.(GetUserResponse, { user: ... });  // One-shot, guarded, guaranteed
});

// ❌ WRONG: Mixing semantics blurs the contract
router.on(RequestResponse, (ctx) => {
  ctx.send(...);  // Is this fire-and-forget or a reply?
  // Reviewer has to read implementation to know
});

// ✅ RIGHT: Clear semantics
router.on(Notify, (ctx) => {
  ctx.publish(topic, Message, { ... });  // Pub/sub, clear intent
});
router.rpc(Query, (ctx) => {
  ctx.reply?.(Response, { ... });  // One-shot reply, clear intent
});
```

---

### 1. Unified Schema: Message Definition with Optional Response (Implementation Details)

**Problem**: Separate `rpc()` and `message()` functions create dual mental models.

**Solution**: Single `message()` function with optional `response` field marking RPC:

```typescript
// Pub/Sub message (no response)
const PriceTick = message("PRICE_TICK", {
  payload: { symbol: z.string(), px: z.number() },
});

// RPC message (has response)
const GetUser = message("GET_USER", {
  payload: { id: z.string() },
  response: { user: UserSchema },
});
```

**Benefits**:

- One import, one concept ("message")
- Presence of `response` automatically enables RPC invariants
- Backward compatible via config object vs. positional args
- Type inference flows seamlessly from schema to handler

**Implementation**:

- Updated `messageSchema()` to accept config object: `{ payload?, response?, meta? }`
- Both Zod and Valibot adapters support unified API
- `rpc()` alias still available for code migration

### 2. Explicit RPC Primitives: `ctx.reply()` and `ctx.progress()` (Implementation Details)

**Problem**: Generic `send()` and `unicast()` don't signal intent; developers must know RPC semantics.

**Solution**: RPC-specific handler methods:

```typescript
router.on(GetUser, (ctx) => {
  // Progress updates (optional, before terminal reply)
  ctx.progress?.({ stage: "loading" });

  const user = await db.findById(ctx.payload.id);

  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }

  // Terminal reply (type-safe, one-shot guarded)
  ctx.reply?.({ user });
});
```

**Semantics**:

- `ctx.progress(data?)` → Non-terminal unicast with correlation; safe no-op if backpressured
- `ctx.reply(data)` → Terminal reply, schema-enforced to response type, one-shot guarded
- Both optional properties (only defined for RPC messages)

**Benefits**:

- Intent-revealing: readers know `reply` is terminal
- Type safety: `reply()` enforces response schema
- Backpressure-aware: progress silently drops; replies are prioritized
- Aligns with async iterator pattern (`progress()` → `AsyncIterable`, `reply()` → terminal result)

### 3. Expanded Error Taxonomy (RPC-Standard Codes) (Implementation Details)

**Problem**: Legacy error codes don't cover RPC-specific failures (timeout, cancellation, conflict).

**Solution**: Unified taxonomy aligned with gRPC conventions plus backwards-compatible legacy codes:

```typescript
export enum ErrorCode {
  // RPC-standard codes
  INVALID_ARGUMENT = "INVALID_ARGUMENT", // Schema/semantic validation
  DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED", // Timeout
  CANCELLED = "CANCELLED", // Client/peer abort
  PERMISSION_DENIED = "PERMISSION_DENIED", // Authz (post-auth)
  NOT_FOUND = "NOT_FOUND", // Resource not found
  CONFLICT = "CONFLICT", // Correlation collision, uniqueness
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED", // Backpressure, rate limit
  UNAVAILABLE = "UNAVAILABLE", // Transient infra (retriable)
  INTERNAL_ERROR = "INTERNAL_ERROR", // Unhandled exception

  // Legacy (deprecated)
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTH_ERROR = "AUTH_ERROR",
  RATE_LIMIT = "RATE_LIMIT",
}
```

**Mapping Guidance**:

- Transport hiccup → `UNAVAILABLE` (retryable)
- Buffer overflow → `RESOURCE_EXHAUSTED` (maybe retryable)
- Duplicate correlation → `CONFLICT`
- Timeout → `DEADLINE_EXCEEDED`

**Client Support**:

- Export `RpcErrorCode` union type for type narrowing
- Make `RpcError<TCode extends RpcErrorCode>` generic for catch-block clarity

```typescript
try {
  await client.request(PaymentOrder, payload);
} catch (e) {
  if (e instanceof RpcError && e.code === "RESOURCE_EXHAUSTED") {
    console.log("Retryable:", e.retryable);
  }
}
```

### 4. Optional: `ctx.abortSignal` for Ecosystem Integration (Implementation Details)

**Problem**: `onCancel(cb)` is callback-heavy; doesn't integrate with fetch/ORM libraries that expect `AbortSignal`.

**Solution**: Provide read-only `abortSignal` property (fires on `$ws:abort`, disconnect, server cancel):

```typescript
router.on(LongQuery, async (ctx) => {
  // Works seamlessly with fetch, DB drivers, etc.
  const result = await fetch(url, {
    signal: ctx.abortSignal,
  });
  ctx.reply?.(QueryResponse, result);
});
```

**Benefits**:

- Zero new semantics (wraps existing `onCancel` mechanism)
- Lazy initialization: only allocated when accessed
- Enables cleanup in ecosystem libraries

### 5. Configuration Renames for Clarity (Implementation Details)

Proposed renames (breaking, but pre-v1):

| Old Name                                | New Name                            | Rationale                                   |
| --------------------------------------- | ----------------------------------- | ------------------------------------------- |
| `maxQueuedBytesPerSocket`               | `socketBufferLimitBytes`            | "Buffer limit" is the concept               |
| `defaultRpcTimeoutMs`                   | `rpcTimeoutMs`                      | Defaults belong in config; name is implicit |
| `heartbeat: {}` → `heartbeatIntervalMs` | Clearer semantics for configuration |

### 6. Future Extensibility Points (Implementation Details)

Planned (not implemented yet, but API designed to support):

**Progress Policy Enum**:

```typescript
type ProgressPolicy = "drop-progress-first" | "drop-all" | "queue";
// drop-progress-first: skip progress frames on backpressure; preserve terminal
// drop-all: skip all messages when backpressured
// queue: queue all messages (risky under sustained backpressure)
```

**Observability Hooks**:

```typescript
router.onMetric?.((event: MetricEvent, value: number, ctx?: Ctx) => {
  // "send.drop.progress", "send.fail.terminal", "rpc.timeout", etc.
});
```

**Middleware Helpers**:

```typescript
// Gate middleware to RPC-only handlers
router.use(
  onlyRpc((ctx, next) => {
    // Only runs for RPC messages
    return next();
  }),
);
```

**Idempotency Helpers**:

```typescript
const key = client.keys.idempotency({
  tenant: "acme",
  user: "alice",
  type: GetUser,
  payload: { id: "123" }, // Hashed for stability
});
```

## Impact on APIs

### Server

**Before**:

```typescript
const ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });

router.on(ping, (ctx) => {
  ctx.send(ping.response, { reply: `Got: ${ctx.payload.text}` });
});
```

**After**:

```typescript
const Ping = message("PING", {
  payload: { text: z.string() },
  response: { reply: z.string() },
});

router.on(Ping, (ctx) => {
  ctx.reply?.({ reply: `Got: ${ctx.payload.text}` });
});
```

### Client

**Before**:

```typescript
const result = await client.request(ping, { text: "hello" });
```

**After** (unchanged syntax, clearer intent):

```typescript
const call = client.request(Ping, { text: "hello" });
for await (const p of call.progress()) {
  console.log("progress:", p);
}
const result = await call.result();
```

## Implementation

✅ **Completed**:

- Unified schema API with optional `response` field (Zod + Valibot)
- `ctx.reply()` and `ctx.progress()` method stubs in core types
- `ctx.abortSignal` property definition
- Expanded `ErrorCode` enum with RPC-standard codes
- `RpcErrorCode` union type exported from validator packages
- Error message schema updated to include `retryable` field

⏳ **In Progress**:

- Router implementation: `router.rpc()` and `router.topic()` explicit handlers
- Client API: Dual-surface `call.result()` and `call.progress()`
- Configuration option renames
- Progress policy and observability hooks

📚 **Documentation**:

- RPC quickstart guide
- Backpressure per-adapter guidance
- Error taxonomy decision table
- Idempotency recipes

## Testing

New test coverage ensures:

1. Terminal reply is one-shot (multiple `reply()` calls are no-op)
2. Progress updates preserve order and don't shift terminal earlier
3. Progress is safely dropped under backpressure (retried by client if needed)
4. Error taxonomy codes are exhaustive and correct
5. Reserved `$ws:` prefix fails at schema creation time

## Future Phases

**Phase B**: Client-side AsyncIterable convenience facade for progress streaming
**Phase C**: Client-initiated `AbortSignal.abort()` sends `$ws:abort` automatically
**Phase D**: Router middleware filtering helpers (`onlyRpc`, `onlyNonRpc`)

## References

- [ADR-012: Minimal Reliable RPC](./012-rpc-minimal-reliable.md) — Core RPC lifecycle
- [ADR-013: Reconnect & Idempotency](./013-rpc-reconnect-idempotency.md) — Safe retries
- [ADR-014: RPC DX Improvements](./014-rpc-dx-safety-improvements.md) — Phase A improvements
- [docs/feedback/rpc.md](../feedback/rpc.md) — Community feedback (11 comments, synthesized here)
- [docs/guides/rpc-troubleshooting.md](../guides/rpc-troubleshooting.md) — Troubleshooting guide
