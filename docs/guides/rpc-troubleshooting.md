# RPC Troubleshooting Guide

Type-safe request-response patterns with automatic timeout, cancellation, and idempotency support.

## Common Issues and Solutions

### "Request Never Resolves" / "Client Awaiting Forever"

**Symptoms:**

- `await client.request()` never completes or times out
- No error thrown, just hangs

**Checklist:**

1. ✅ **Use `router.rpc()` for request handlers (not `router.on()`)**

   ```typescript
   // ✓ Correct: registers as RPC handler
   router.rpc(Query, (ctx) => {
     ctx.reply(QueryResponse, result);
   });

   // ✗ Wrong: fire-and-forget handler, not RPC
   router.on(Query, (ctx) => {
     ctx.send(QueryResponse, result); // Client will timeout
   });
   ```

2. ✅ **Call `ctx.reply()` exactly once**

   ```typescript
   router.rpc(Query, (ctx) => {
     // ✓ Correct: single terminal response
     ctx.reply(QueryResponse, result);

     // ✗ Wrong: client only sees first reply
     ctx.reply(QueryResponse, result2); // Ignored
   });
   ```

3. ✅ **Response schema must match request binding**

   ```typescript
   const Query = message("QUERY", { id: z.string() });
   const QueryResponse = message("QUERY_RESPONSE", { result: z.any() });

   // ✓ Correct: both parts bound correctly
   router.rpc(Query, (ctx) => {
     ctx.reply(QueryResponse, { result: 42 });
   });

   // ✗ Wrong: sending wrong message type
   router.rpc(Query, (ctx) => {
     ctx.send(SomeOtherMessage, data); // Client still waiting
   });
   ```

4. ✅ **Check for unhandled errors**

   ```typescript
   router.rpc(Query, async (ctx) => {
     try {
       const result = await expensiveQuery();
       ctx.reply(QueryResponse, result);
     } catch (err) {
       // ✓ Correct: send error response
       ctx.error(
         "INTERNAL_ERROR",
         err instanceof Error ? err.message : "Unknown error",
       );
       // If you don't call ctx.error() or ctx.reply(), client hangs
     }
   });
   ```

5. ✅ **Check deadline hasn't expired**

   ```typescript
   router.rpc(Query, async (ctx) => {
     if (ctx.timeRemaining() < 100) {
       ctx.error("DEADLINE_EXCEEDED", "Not enough time to process");
       return;
     }
     // Safe to start async work
     const result = await expensiveQuery();
     ctx.reply(QueryResponse, result);
   });
   ```

6. ✅ **Handle connection loss gracefully**

   ```typescript
   try {
     const reply = await client.request(Query, payload);
     console.log("Got response:", reply);
   } catch (err) {
     if (err instanceof WsDisconnectedError) {
       console.log("Connection closed during RPC. Reconnecting...");
       // Client will auto-reconnect
     }
   }
   ```

---

### "DEADLINE_EXCEEDED" on Client

**Symptoms:**

- `ServerError` with code `"DEADLINE_EXCEEDED"` thrown on client
- Request took longer than `timeoutMs`

**Cause:** Handler exceeded deadline

```typescript
// Default timeout is 30 seconds
const result = await client.request(Query, payload);

// Custom timeout (client-side)
const result = await client.request(Query, payload, {
  timeoutMs: 5000,
});

// Server-side: check remaining time
router.rpc(Query, async (ctx) => {
  const timeRemaining = ctx.timeRemaining();
  if (timeRemaining < 1000) {
    // Less than 1 second left, reject fast
    ctx.error("RESOURCE_EXHAUSTED", "Server overloaded, retry later");
    return;
  }

  // Safe: plenty of time
  const result = await expensiveQuery();
  ctx.reply(QueryResponse, result);
});
```

---

### "Validation Error" on Client

**Symptoms:**

- `ValidationError` thrown when sending request
- Message doesn't match expected schema

**Cause:** Payload doesn't match request schema

```typescript
const Query = message("QUERY", { id: z.string().uuid() });

// ✗ Wrong: id is not a valid UUID
await client.request(Query, { id: "not-a-uuid" }); // ValidationError

// ✓ Correct: valid payload
await client.request(Query, { id: "550e8400-e29b-41d4-a716-446655440000" });
```

---

### "Correlation ID Mismatch" / Wrong Response Received

**Symptoms:**

- Client receives response from a different request
- Response data doesn't match what was expected

**Solution:** Ensure unique correlation IDs

```typescript
// ✓ Let client generate (recommended)
const reply = await client.request(Query, payload);

// ✓ Provide custom ID if needed
const reply = await client.request(Query, payload, {
  correlationId: "custom-req-123",
});

// ✗ Don't reuse correlation IDs
const id = "my-id";
await client.request(Query, { id }); // ✓ First request
await client.request(Query, { id }); // ✗ Second request reuses same ID
```

---

### "Idempotency Key Issues"

**Symptoms:**

- Duplicate requests create duplicate side effects
- Need reliable deduplication across network retries

**Solution:** Implement idempotency in the handler or via a dedicated middleware

```typescript
import crypto from "node:crypto";

// Generate consistent key for deduplication
function generateIdempotencyKey(
  userId: string,
  type: string,
  payload: unknown,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return `${userId}:${type}:${hash}`;
}

// Handler-level idempotency
router.rpc(CreateOrder, async (ctx) => {
  const idempotencyKey = generateIdempotencyKey(
    ctx.data.userId,
    ctx.type,
    ctx.payload,
  );

  const cached = await dedupeStore.get(idempotencyKey);
  if (cached) {
    ctx.reply(cached);
    return;
  }

  const result = await createOrder(ctx.payload);

  // Cache for deduplication
  await dedupeStore.set(idempotencyKey, result);
  ctx.reply(result);
});
```

---

### "Streaming Progress Updates"

If you need to send multiple updates before the final response, use `ctx.progress()`:

```typescript
router.rpc(LongOperation, async (ctx) => {
  // Send non-terminal progress updates
  ctx.progress(ProgressUpdate, { percent: 25, status: "Parsing..." });
  await delay(100);

  ctx.progress(ProgressUpdate, { percent: 50, status: "Processing..." });
  await delay(100);

  ctx.progress(ProgressUpdate, { percent: 75, status: "Finalizing..." });

  // Final terminal response
  ctx.reply(OperationResult, { result: "done", percent: 100 });
});

// Client receives all updates
client.request(
  LongOperation,
  {},
  {
    onProgress: (update) => {
      console.log(`${update.percent}% - ${update.status}`);
    },
  },
);
```

---

## RPC Lifecycle Diagram

```
Client                        Server
  |                             |
  +--- client.request() ------->|
  |                          |
  |                          v
  |                  validate message
  |                  (if fails → ValidationError)
  |                          |
  |                          v
  |                  run middleware
  |                  (if fails → error())
  |                          |
  |                          v
  |                  run handler (rpc)
  |                          |
  |        +-----------+-----+
  |        |           |
  |        v           v
  |     reply()    progress()  (zero or more)
  |        |           |
  |        +-----------+
  |              |
  |<----- OperationResult (terminal)
  |
  resolve(reply)
  |
```

---

## Debugging Tips

### Enable Connection Logging

```typescript
const client = createClient(wsUrl, {
  onOpen: () => console.log("✓ Connected"),
  onClose: () => console.log("✗ Disconnected"),
  onError: (err) => console.error("! Error:", err),
});
```

### Log Request/Response

```typescript
router.use((ctx, next) => {
  console.log(`Message ${ctx.type} from ${ctx.data?.userId}`);
  return next();
});
```

### Monitor Timeouts

```typescript
router.rpc(Query, async (ctx) => {
  const start = performance.now();
  const result = await expensiveQuery();
  const elapsed = performance.now() - start;

  if (elapsed > ctx.timeRemaining()) {
    console.warn(
      `Warning: operation took ${elapsed}ms, only ${ctx.timeRemaining()}ms left`,
    );
  }

  ctx.reply(QueryResponse, result);
});
```

---

## Related

- [RPC vs Fire-and-Forget](./on-vs-rpc.md) — When to use RPC vs `router.on()`
- [docs/specs/router.md](../specs/router.md) — Full RPC specification
- [ADR-015](../adr/015-unified-rpc-api-design.md) — RPC design rationale
