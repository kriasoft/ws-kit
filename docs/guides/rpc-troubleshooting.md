# RPC Troubleshooting Guide

Type-safe request-response patterns with automatic timeout, cancellation, and idempotency support.

## Common Issues and Solutions

### "Request Never Resolves" / "Client Awaiting Forever"

**Symptoms:**

- `await client.request()` never completes or times out
- No error thrown, just hangs

**Checklist:**

1. ✅ **Handler calls correct response method**

   ```typescript
   router.on(Query, (ctx) => {
     // ✓ Correct: resolves the client request
     ctx.send(QueryResponse, result);

     // ✗ Wrong: this is regular broadcast, doesn't resolve request
     ctx.send(SomeOtherMessage, data);
   });
   ```

2. ✅ **Response schema matches request binding**

   ```typescript
   // Define RPC with matching request/response types
   const Query = rpc("QUERY", {...}, "QUERY_RESPONSE", {...});

   router.on(Query, (ctx) => {
     // Response type must match schema binding
     ctx.send(QueryResponse, result); // ✓
   });
   ```

3. ✅ **No duplicate respond() calls**

   ```typescript
   router.on(Query, (ctx) => {
     // Only first call resolves; others are suppressed
     ctx.send(QueryResponse, result1); // ✓ Resolves
     ctx.send(QueryResponse, result2); // ✗ Suppressed (one-shot guard)
   });
   ```

4. ✅ **Backpressure error not being caught**

   ```typescript
   try {
     await client.request(Query, payload);
   } catch (e) {
     if (e instanceof RpcError && e.code === "RESOURCE_EXHAUSTED") {
       console.log("Buffer full, retry after:", e.retryAfterMs);
     }
   }
   ```

5. ✅ **Deadline not exceeded during handler**

   ```typescript
   router.on(Query, async (ctx) => {
     if (ctx.timeRemaining() < 100) {
       ctx.error("DEADLINE_EXCEEDED", "Not enough time to process");
       return;
     }
     // Safe to start async work
   });
   ```

6. ✅ **Connection closed during request**
   ```typescript
   try {
     await client.request(Query, payload);
   } catch (e) {
     if (e instanceof WsDisconnectedError) {
       console.log("Socket closed. Reconnecting...");
     }
   }
   ```

---

### "Schema Mismatch" Error

**Symptoms:**

- `ValidationError` thrown on client
- Server received message but handler not called

**Cause:** Request/response schema doesn't match binding

```typescript
// ✗ Wrong: response types don't match
const Query = rpc("QUERY", {...}, "QUERY_RESPONSE", {...});
router.on(Query, (ctx) => {
  ctx.send(SomeOtherMessage, result); // ✗ Type mismatch!
});

// ✓ Correct: response type matches
router.on(Query, (ctx) => {
  ctx.send(QueryResponse, result);
});
```

**Solution**: Ensure response message type in `rpc()` binding matches the actual response sent.

---

### "Timeout Exceeded" on Client

**Symptoms:**

- `RpcError` with code `"DEADLINE_EXCEEDED"`
- Request took longer than `timeoutMs`

**Cause:** Handler exceeded deadline

```typescript
// Default timeout is 30 seconds
const result = await client.request(Query, payload);

// Custom timeout
const result = await client.request(Query, payload, { timeoutMs: 5000 });

// Server-side check
router.on(Query, async (ctx) => {
  const timeRemaining = ctx.timeRemaining();
  if (timeRemaining < 1000) {
    // Less than 1 second left
    ctx.error("RESOURCE_EXHAUSTED", "Server overloaded, retry later");
    return;
  }

  // Safe: plenty of time
  const result = await expensiveQuery();
  ctx.send(QueryResponse, result);
});
```

---

### "Correlation ID Mismatch" / Multiple Responses Received

**Symptoms:**

- Client receives response from different request
- Correlation IDs don't match client/server

**Solution:** Ensure unique correlation IDs or let client auto-generate

```typescript
// ✓ Let client generate (recommended)
const result = await client.request(Query, payload);

// ✓ Provide custom ID if needed
const result = await client.request(Query, payload, {
  correlationId: "custom-req-123",
});

// ✗ Don't reuse correlation IDs
const id = "my-correlation-id";
await client.request(Query, { id }); // Don't use same ID again
```

Server automatically synthesizes missing IDs (transparent, tagged for debugging):

```typescript
// Server-side (for debugging)
if (ctx.meta?.syntheticCorrelation) {
  console.log(
    "Client didn't provide correlationId, synthesized:",
    ctx.meta.correlationId,
  );
}
```

---

### "Idempotency Key Issues"

**Symptoms:**

- Duplicate requests create duplicate side effects
- Inconsistent key format across app

**Solution:** Use helper for standardized keys

```typescript
import { stableStringify, idempotencyKey } from "@ws-kit/core";
import crypto from "node:crypto";

// Generate consistent key for any RPC
const hash = crypto
  .createHash("sha256")
  .update(stableStringify(ctx.payload))
  .digest("hex");

const key = idempotencyKey({
  tenant: ctx.ws.data?.tenantId,
  user: ctx.ws.data?.userId,
  type: ctx.type,
  hash,
});

// Result: "tenant:alice:PURCHASE_ORDER:abc123..."
```

Middleware pattern for idempotency:

```typescript
router.use((ctx, next) => {
  if (!ctx.isRpc) return next(); // Skip non-RPC

  // Check if we've seen this request before
  const idempotencyKey = ctx.meta?.idempotencyKey;
  if (idempotencyKey) {
    const cached = await dedupeStore.get(idempotencyKey);
    if (cached) {
      ctx.send(/* cached response */);
      return;
    }
  }

  // Process normally, cache result
  await next();
});
```

---

## RPC Lifecycle Diagram

```
Client                          Server
  |                               |
  +------- request() ------------->
  |                            |
  |                            v
  |                    validate message
  |                       (if fails → RPC_ERROR)
  |                            |
  |                            v
  |                    run middleware
  |                       (if fails → error())
  |                            |
  |                            v
  |                    call handler
  |  <------ unicast() ------+
  |                    (one-shot guard)
  |                            |
  |  <------ RPC_ERROR ------+  (if error())
  |  (or $ws:abort on cancel)
  |                            |
  v                            v
Promise resolves        cleanup RPC state
```

---

## Debugging Checklist

- [ ] `ctx.isRpc === true` in handler?
- [ ] Response type matches `rpc()` binding?
- [ ] Only one `ctx.send()` or `ctx.error()` call?
- [ ] `ctx.timeRemaining() > 0` (not expired)?
- [ ] WebSocket still connected (`client.state === "open"`)?
- [ ] Backpressure not rejecting message (check `e.code === "RESOURCE_EXHAUSTED"`)?
- [ ] Custom `correlationId` unique and stable?
- [ ] Idempotency key format consistent across app?

---

## Platform-Specific Limits

### Bun

```typescript
const router = createRouter({ maxQueuedBytesPerSocket: 1_000_000 }); // 1MB
```

- Per-socket buffer: 1-4 MB (varies by system memory)
- Typical: Start at 1MB, increase if backpressure errors
- Use `bufferedAmount` for fine-tuning

### Cloudflare Durable Objects

```typescript
const handler = createCloudflareHandler(router, {
  maxQueuedBytesPerSocket: 512_000, // 512 KB (conservative)
});
```

- Per-message cap: ~125 KB (JSON serialized)
- Request cap: ~30 MB (hard limit)
- Recommendations: Keep per-message under 50 KB

---

## Performance Tips

1. **Check deadline early in handler**

   ```typescript
   if (ctx.timeRemaining() < 100) {
     ctx.error("DEADLINE_EXCEEDED", "...");
     return;
   }
   ```

2. **Stream long results**
   - Use progress messages for streaming
   - Copy correlationId automatically

3. **Batch idempotency checks**
   - Use Redis/cache instead of database
   - TTL: max resend window (5 seconds default)

4. **Monitor backpressure**
   - Track `RESOURCE_EXHAUSTED` errors
   - Increase `maxQueuedBytesPerSocket` if frequent
   - Consider request shaping on client
