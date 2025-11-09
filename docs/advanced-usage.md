# Advanced Usage

Advanced patterns for building sophisticated WebSocket applications with ws-kit.

## Router Composition

Organize your application into modules by composing multiple routers:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { userId?: string };

// Define message schemas
const LoginMessage = message("LOGIN", {
  email: z.string().email(),
  password: z.string(),
});

const SendMessageMessage = message("SEND_MESSAGE", {
  text: z.string(),
});

const BroadcastMessage = message("BROADCAST", {
  message: z.string(),
});

// Authentication router
const authRouter = createRouter<AppData>();
authRouter.on(LoginMessage, (ctx) => {
  // Verify credentials and update connection data
  ctx.assignData({ userId: "user_123" });
});

// Chat router
const chatRouter = createRouter<AppData>();
chatRouter.on(SendMessageMessage, (ctx) => {
  const userId = ctx.ws.data?.userId;
  const roomId = "general"; // or from ctx.ws.data?.roomId
  console.log(`Message from ${userId}: ${ctx.payload.text}`);

  // Broadcast to topic subscribers (use ctx.publish for convenience)
  ctx.publish(`room:${roomId}`, BroadcastMessage, {
    message: ctx.payload.text,
  });
});

// Compose routers together
const router = createRouter<AppData>();
router.merge(authRouter).merge(chatRouter);
```

The `merge()` method combines handlers, lifecycle hooks, and middleware from multiple routers.

## Middleware

Middleware runs before handlers—use it for authorization, validation, logging, and rate limiting:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

// Global middleware: authentication check
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return; // Skip handler
  }
  return next();
});

// Per-message middleware: rate limiting
const rateLimiter = new Map<string, number>();
const RateLimitMessage = message("RATE_LIMIT_MESSAGE", {
  text: z.string(),
});

router.use(RateLimitMessage, (ctx, next) => {
  const userId = ctx.ws.data?.userId || "anon";
  const count = (rateLimiter.get(userId) || 0) + 1;

  if (count > 10) {
    ctx.error("RESOURCE_EXHAUSTED", "Too many messages");
    return;
  }

  rateLimiter.set(userId, count);
  return next();
});

router.on(RateLimitMessage, (ctx) => {
  console.log(`Message from ${ctx.ws.data?.userId}: ${ctx.payload.text}`);
});
```

**Middleware semantics:**

- `router.use(middleware)` — Global middleware (runs for all messages)
- `router.use(schema, middleware)` — Per-message middleware (runs only for that message)
- Middleware can call `ctx.error()` to reject or skip calling `next()` to prevent handler execution
- Middleware can modify connection data via `ctx.assignData()` for handlers to access
- Both sync and async middleware supported
- Execution order: Global middleware → per-route middleware → handler

**Important: Context type in middleware**

Middleware receives `MessageContext<any, TData>` (generic payload type), not the specific message schema type. This is because at middleware execution time, we don't yet know which specific handler will run. Use `ctx.type` to discriminate by message type:

```typescript
router.use((ctx, next) => {
  // ctx.type is available ("LOGIN", "QUERY", etc.)
  if (ctx.type === "SENSITIVE_OP") {
    // Require authentication for sensitive operations
    if (!ctx.ws.data?.userId) {
      ctx.error("UNAUTHENTICATED", "Authentication required");
      return;
    }
  }
  return next();
});
```

Handlers (registered via `router.on()`) receive fully typed context with the specific message schema, so `ctx.payload` is properly typed based on the message schema.

## Error Handling

Send type-safe error responses with predefined error codes:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const router = createRouter();

const LoginMessage = message("LOGIN", {
  email: z.string().email(),
  password: z.string(),
});

const QueryMessage = message("QUERY", {
  id: z.string(),
});

const QueryResponse = message("QUERY_RESPONSE", {
  data: z.any(),
});

const ProcessPaymentMessage = message("PROCESS_PAYMENT", {
  amount: z.number().positive(),
  currency: z.string(),
});

router.on(LoginMessage, (ctx) => {
  try {
    // Domain-specific: implement per your auth system
    const user = await validateCredentials(
      ctx.payload.email,
      ctx.payload.password,
    );
    ctx.assignData({ userId: user.id });
  } catch (err) {
    // Type-safe error code
    ctx.error("UNAUTHENTICATED", "Invalid credentials", {
      hint: "Check your email and password",
    });
  }
});

router.on(QueryMessage, (ctx) => {
  try {
    // Domain-specific: implement per your database
    const result = await db.query(ctx.payload.id);
    ctx.send(QueryResponse, { data: result });
  } catch (err) {
    ctx.error("INTERNAL", "Database query failed");
  }
});

// Transient errors with retry hints
router.on(ProcessPaymentMessage, (ctx) => {
  try {
    // Domain-specific: implement per your payment provider
    await paymentProvider.charge(ctx.payload);
  } catch (err) {
    // Check error type and respond with appropriate code and retry hint
    if (err instanceof RateLimitError) {
      // Transient error: send backoff hint for client retry
      ctx.error("RESOURCE_EXHAUSTED", "Rate limit exceeded", undefined, {
        retryable: true,
        retryAfterMs: 5000, // Client waits 5s before retry
      });
    } else if (err instanceof TemporarilyUnavailableError) {
      // Infrastructure error: automatic client backoff
      ctx.error("UNAVAILABLE", "Service temporarily unavailable");
    } else {
      // Unexpected error: don't retry
      ctx.error("INTERNAL", "Payment processing failed");
    }
  }
});
```

**Standard error codes** (gRPC-aligned, see ADR-015)

For the complete error code taxonomy and how clients infer retry behavior, see [Client Error Handling - Standard Error Codes](./client-errors.md#standard-error-codes-per-adr-015-grc-aligned).

**Retry inference rules**

Clients automatically infer whether an error is retryable based on its error code. You can also explicitly control retry behavior:

| Scenario                                                             | How to Handle                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Terminal error** (e.g., `UNAUTHENTICATED`)                         | Don't set `retryable`; client infers `false` from error code      |
| **Transient error with default backoff** (e.g., `UNAVAILABLE`)       | Don't set `retryable`; client infers `true` from error code       |
| **Transient error with custom backoff** (e.g., `RESOURCE_EXHAUSTED`) | Set `retryAfterMs` to tell client when to retry; omit `retryable` |
| **Impossible operation** (e.g., quota exceeded, not retryable)       | Use `FAILED_PRECONDITION` with no retry options                   |

Example: Rate-limited endpoint that won't recover for 30 seconds:

```typescript
ctx.error(
  "RESOURCE_EXHAUSTED",
  "Rate limit exceeded",
  { retryAfterMs: 30000 }, // Client waits 30s before retry
);
```

Example: Resource not found (never retryable):

```typescript
ctx.error("NOT_FOUND", "User does not exist");
// Client infers retryable=false from error code, never retries
```

## Discriminated Unions

Use Zod discriminated unions for type-safe message handlers:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

// Define individual message schemas
const TextMessage = message("TEXT", {
  content: z.string(),
  channelId: z.string(),
});

const ImageMessage = message("IMAGE", {
  url: z.url(),
  channelId: z.string(),
  width: z.number(),
  height: z.number(),
});

const VideoMessage = message("VIDEO", {
  url: z.url(),
  channelId: z.string(),
  duration: z.number(),
});

// Register handlers for each type
const router = createRouter();

router.on(TextMessage, (ctx) => {
  console.log("Text:", ctx.payload.content);
  ctx.publish(ctx.payload.channelId, TextMessage, ctx.payload);
});

router.on(ImageMessage, (ctx) => {
  console.log(
    "Image:",
    ctx.payload.url,
    ctx.payload.width,
    "x",
    ctx.payload.height,
  );
  ctx.publish(ctx.payload.channelId, ImageMessage, ctx.payload);
});

router.on(VideoMessage, (ctx) => {
  console.log("Video:", ctx.payload.url, ctx.payload.duration, "s");
  ctx.publish(ctx.payload.channelId, VideoMessage, ctx.payload);
});
```

This pattern is useful for protocol versioning, command/query separation, event sourcing, and complex state machines.

## Connection Data Type Safety

For large applications, declare your default connection data type once using TypeScript declaration merging:

```typescript
// types/app-data.d.ts
declare module "@ws-kit/core" {
  interface AppDataDefault {
    userId?: string;
    email?: string;
    roles?: string[];
    tenant?: string;
  }
}
```

Now throughout your app, omit the generic type:

```typescript
// ✅ No generic needed—automatically uses AppDataDefault
const router = createRouter();

router.on(SecureMessage, (ctx) => {
  // ✅ ctx.ws.data is properly typed
  const userId = ctx.ws.data?.userId; // string | undefined
  const email = ctx.ws.data?.email; // string | undefined
  const roles = ctx.ws.data?.roles; // string[] | undefined
});
```

Alternatively, specify the type explicitly for custom routers:

```typescript
// ✅ Custom data for specific routers
type FeatureData = { feature: string; version: number };
const featureRouter = createRouter<FeatureData>();
```

## Heartbeat Configuration

Heartbeat is opt-in and only enabled when explicitly configured:

```typescript
import { createRouter } from "@ws-kit/zod";

const router = createRouter({
  heartbeat: {
    intervalMs: 30_000, // Optional: defaults to 30s
    timeoutMs: 5_000, // Optional: defaults to 5s
    onStaleConnection: (clientId, ws) => {
      console.log(`Connection ${clientId} is stale`);
      ws.close(1011, "Connection timeout");
    },
  },
});
```

**When to use heartbeat:**

- Long-lived connections that need liveness checks
- Detecting network partitions or idle connections
- Cleaning up zombie connections

**When not to use:**

- Short-lived request/response patterns
- Applications where reconnect is acceptable
- High-throughput scenarios (adds overhead)

## Lifecycle Hooks & Observability

Register hooks to observe and react to connection lifecycle events and system conditions:

```typescript
import { createRouter } from "@ws-kit/zod";

const router = createRouter({
  onUpgrade(req, extra) {
    // Called before handshake (before authentication)
    // Use for logging, analytics, or early request inspection
    console.log("New connection attempt from", req.headers.get("origin"));
  },

  onConnect(clientId, ws) {
    // Called after successful connection and authentication
    console.log("Client connected:", clientId);
    // Track client in metrics, update status, etc.
  },

  onDisconnect(clientId, ws) {
    // Called when client disconnects (any reason)
    console.log("Client disconnected:", clientId);
    // Clean up client state, cancel pending operations, etc.
  },

  onError(error, ctx) {
    // Called when a message handler throws an error
    // ctx includes clientId, messageType, meta, and the error
    console.error(`Error in ${ctx.messageType}:`, error.message);
    // Log to observability system, send alerting, etc.
  },

  onBroadcast(topic, schema, payload, result) {
    // Called after each broadcast (publish) operation
    console.log(`Broadcast to ${topic}:`, result.capability);
    // Track broadcast metrics, detect failures
  },

  onLimitExceeded(info) {
    // Called when a connection exceeds configured limits
    // info.type: "payload_bytes", "message_rate", "inflight_rpcs"
    // info.clientId, info.limit, info.current
    console.warn(`Limit exceeded: ${info.type}`, info);
    // Alert on excessive connections or suspicious traffic
  },
});
```

**Hook execution:**

- `onUpgrade` — Before handshake (unauthenticated request context)
- `onConnect` — After successful connection and auth (connection data available)
- `onDisconnect` — When socket closes (cleanup handlers)
- `onError` — Inside message handler try-catch (context available)
- `onBroadcast` — After each publish() call (async-safe)
- `onLimitExceeded` — When limits enforced (connection-level or message-level)

**Error handling in hooks:**

- Exceptions in hooks are logged and suppressed (never rethrown)
- Use try-catch inside hooks for defensive logic
- Hooks should not block message processing (keep them fast)

## Publishing and Broadcasting

Type-safe publish/subscribe with schema validation:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roomId?: string };

const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const RoomUpdate = message("ROOM_UPDATE", {
  roomId: z.string(),
  users: z.number(),
  message: z.string(),
});

const router = createRouter<AppData>();

router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data?.userId;

  // Store room ID and subscribe to topic
  ctx.assignData({ roomId });
  await ctx.topics.subscribe(`room:${roomId}`);

  // Broadcast to room (type-safe!)
  ctx.publish(`room:${roomId}`, RoomUpdate, {
    roomId,
    users: 5,
    message: `User ${userId} joined`,
  });
});
```

All broadcast messages are validated against their schemas before being sent, providing the same type safety for broadcasts as for direct messaging.

**Key points:**

- Use `ctx.publish()` in handlers for ergonomic broadcasting (most common)
- Use `router.publish()` outside handlers (cron jobs, system events)
- Both enforce schema validation before transmission
- Topic naming conventions help organize broadcasts (e.g., `room:${roomId}`)

**Handling publish results**

The `publish()` and `router.publish()` methods return a `PublishResult` that indicates delivery status and capability level:

```typescript
const result = await ctx.publish(`room:${roomId}`, RoomUpdate, {
  roomId,
  users: 5,
  message: `User ${userId} joined`,
});

if (result.ok) {
  // Broadcast succeeded
  console.log(`Delivered to ${result.matched} subscribers`, result.capability);
} else {
  // Broadcast failed (platform error, ACL rejection, etc.)
  console.error(`Broadcast failed: ${result.error}`);
  // Log to observability, potentially retry
}
```

**PublishResult structure:**

| Field        | Type                                     | Description                                                             |
| ------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| `ok`         | `boolean`                                | Whether broadcast succeeded or failed                                   |
| `matched`    | `number`                                 | Estimated number of subscribers that will receive message (if ok)       |
| `capability` | `"exact"` \| `"estimate"` \| `"unknown"` | Confidence in `matched` count                                           |
| `error`      | `string`                                 | Error reason if `ok=false` (e.g., "validation", "adapter_error", "acl") |

Capability levels:

- `"exact"` — Precise subscriber count (adapter provides exact match, e.g., Bun)
- `"estimate"` — Approximate count (adapter estimates, some subscribers unknown)
- `"unknown"` — No delivery information available (adapter doesn't track or doesn't support it)

Always check `ok` before assuming successful delivery; some failures are transient and may be retried.

## RPC Pattern (Request-Response)

For guaranteed request-response patterns with correlation tracking and timeouts, use the `rpc()` helper to bind request and response schemas:

```typescript
import { z, rpc, createRouter } from "@ws-kit/zod";

// Define RPC schema - binds request to response type
const GetUser = rpc("GET_USER", { id: z.string() }, "USER_RESPONSE", {
  user: z.object({ id: z.string(), name: z.string() }),
});

const router = createRouter();

// Use router.rpc() for type-safe RPC handlers
router.rpc(GetUser, async (ctx) => {
  // Optional progress updates before terminal reply
  ctx.progress({ stage: "loading" });

  const user = await db.users.findById(ctx.payload.id);

  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }

  // Terminal reply with response schema (type-safe, one-shot guaranteed)
  ctx.reply(GetUser.response, { user });
});
```

**RPC-specific context methods:**

- `ctx.reply(schema, data)` — Terminal response (one-shot, schema-enforced)
- `ctx.progress(data?)` — Non-terminal progress updates
- `ctx.abortSignal` — Fires on client cancel/disconnect
- `ctx.onCancel(callback)` — Register cancellation callback
- `ctx.deadline` — Server-derived deadline (epoch ms)
- `ctx.timeRemaining()` — Milliseconds until deadline

**When to use RPC:**

- Client needs guaranteed response
- Correlation tracking required
- Progress updates needed
- Timeout handling important

See ADR-015 for complete RPC design and error taxonomy.

**Client-side:** See [Client API - Streaming Responses with Progress Updates](./client-api.md#streaming-responses-with-progress-updates) to understand how clients receive progress updates via the `onProgress` callback.

## Custom Validators

While ws-kit provides official adapters for Zod and Valibot, you can integrate any validation library by implementing the `ValidatorAdapter` interface:

```typescript
import { WebSocketRouter, type ValidatorAdapter } from "@ws-kit/core";

// Example: Custom validator adapter for your validation library
class CustomValidatorAdapter implements ValidatorAdapter {
  /**
   * Get the message type from a schema object.
   * This is called to extract the type field for routing.
   */
  getMessageType(schema: unknown): string | undefined {
    // Return the type identifier from your schema
    if (typeof schema === "object" && schema !== null && "type" in schema) {
      return (schema as any).type;
    }
    return undefined;
  }

  /**
   * Validate a message payload against a schema.
   * Must enforce strict mode (reject unknown keys at all levels).
   */
  validate(
    schema: unknown,
    data: unknown,
  ): {
    success: boolean;
    data?: unknown;
    error?: { message: string; path?: string[] };
  } {
    // Your validation logic here
    try {
      // CRITICAL: Must reject unknown keys at root, meta, and payload levels
      const result = myValidator.parseStrict(schema, data);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: { message: String(err), path: (err as any).path || [] },
      };
    }
  }
}

// Use custom validator with router
const router = new WebSocketRouter({
  validator: new CustomValidatorAdapter(),
});
```

**Validator interface requirements:**

| Requirement                  | Details                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **`getMessageType(schema)`** | Extract message type identifier from schema. Return `undefined` if schema doesn't have a type. |
| **`validate(schema, data)`** | Validate `data` against `schema`. Return `{ success, data?, error? }`                          |
| **Strict mode (required)**   | Reject unknown keys at root level, in `meta` object, and in `payload` object                   |
| **Payload enforcement**      | If schema defines `payload: undefined`, reject messages with a `payload` key present           |
| **Error reporting**          | Include `message` and optional `path` array (field path to error location)                     |
| **Type safety**              | Preserve and transform types through validation (validated data must match schema type)        |

See `docs/specs/validation.md` for complete validation flow and security boundary details.

## Security Best Practices

**Message type namespace**

Control message types (prefixed with `$ws:`) are reserved for protocol use. Always use application-specific prefixes to avoid collisions:

```typescript
// ✗ Avoid: Collides with reserved namespace
const PrivateMessage = message("$ws:private", { text: z.string() });

// ✓ Good: Application namespace
const PrivateMessage = message("PRIVATE_MESSAGE", { text: z.string() });
const ChatMessage = message("CHAT_MESSAGE", { text: z.string() });
```

**Error detail sanitization**

Never leak sensitive information in error details sent to clients. Always sanitize error details before sending:

```typescript
try {
  const user = await db.query(ctx.payload.id);
} catch (err) {
  // ✗ Never send full error details to client
  // ctx.error("INTERNAL", "Database error", { details: err.message });

  // ✓ Send safe, generic error message
  ctx.error("INTERNAL", "Query failed", {
    code: (err as any)?.code || "UNKNOWN",
  });
}
```

**Authentication in middleware**

Always verify authentication early in middleware before processing untrusted data:

```typescript
router.use((ctx, next) => {
  // Reject unauthenticated requests for sensitive message types
  const isSensitive = ["DELETE_ACCOUNT", "TRANSFER_FUNDS"].includes(ctx.type);
  if (isSensitive && !ctx.ws.data?.userId) {
    ctx.error("UNAUTHENTICATED", "Authentication required");
    return;
  }
  return next();
});
```

## Error Recovery & Idempotency

**Idempotent operations with idempotency keys**

For operations that modify state (payments, deletions), support idempotency by using a key:

```typescript
const TransferMessage = message("TRANSFER", {
  amount: z.number().positive(),
  to: z.string(),
  idempotencyKey: z.string(), // UUID preferred
});

const idempotencyCache = new Map<string, { success: boolean; result: any }>();

router.on(TransferMessage, async (ctx) => {
  const cached = idempotencyCache.get(ctx.payload.idempotencyKey);
  if (cached) {
    // Replay cached response without re-executing
    if (cached.success) {
      ctx.send(TransferResponse, cached.result);
    } else {
      ctx.error("INTERNAL", "Previous attempt failed");
    }
    return;
  }

  try {
    const result = await processTransfer(ctx.payload);
    idempotencyCache.set(ctx.payload.idempotencyKey, { success: true, result });
    ctx.send(TransferResponse, result);
  } catch (err) {
    idempotencyCache.set(ctx.payload.idempotencyKey, { success: false });
    ctx.error("INTERNAL", "Transfer failed");
  }
});
```

**Retry-safe error handling**

Mark errors as retryable or non-retryable to guide client behavior:

```typescript
// Transient error with backoff hint (retryable)
if (err instanceof TemporaryOutage) {
  ctx.error("UNAVAILABLE", "Service temporarily unavailable");
  // Client automatically retries with backoff
}

// Terminal error (non-retryable)
if (err instanceof ValidationError) {
  ctx.error("INVALID_ARGUMENT", "Invalid input", { field: err.field });
  // Client does not retry
}
```

**Client-side:** See [Client API - Request Delivery Guarantees](./client-api.md#request-delivery-guarantees) to understand how clients provide idempotency keys in requests and handle delivery reliability.

## RPC Progress & Streaming

**Define progress message schemas**

For long-running RPC operations, define and send progress updates:

```typescript
import { z, rpc, message, createRouter } from "@ws-kit/zod";

// RPC schema with response
const ExportData = rpc(
  "EXPORT_DATA",
  { format: z.enum(["csv", "json"]) },
  "EXPORT_RESULT",
  { url: z.string().url() },
);

// Progress message (sent before terminal reply)
const ExportProgress = message("EXPORT_PROGRESS", {
  percent: z.number().min(0).max(100),
  status: z.string(),
});

const router = createRouter();

router.rpc(ExportData, async (ctx) => {
  const items = await db.fetchLargeDataset(ctx.payload.format);

  for (let i = 0; i < items.length; i += 100) {
    // Send progress update (non-terminal, client doesn't wait for reply)
    ctx.progress({
      percent: Math.round((i / items.length) * 100),
      status: `Processing batch ${i / 100 + 1}...`,
    });
    // Do work...
    await processBatch(items.slice(i, i + 100));
  }

  // Terminal reply (one-shot, correlates with original request)
  ctx.reply(ExportData.response, {
    url: "https://cdn.example.com/export-12345.csv",
  });
});
```

**Detect client cancellation**

Use `abortSignal` to detect and respond to client cancellations:

```typescript
router.rpc(ExportData, async (ctx) => {
  const items = await db.fetchLargeDataset(ctx.payload.format);

  for (let i = 0; i < items.length; i += 100) {
    // Check if client cancelled request
    if (ctx.abortSignal.aborted) {
      console.log("Client cancelled export, stopping...");
      // Clean up partial results, don't send reply
      return;
    }

    ctx.progress({ percent: Math.round((i / items.length) * 100) });
    await processBatch(items.slice(i, i + 100));
  }

  ctx.reply(ExportData.response, { url: "..." });
});
```

## Performance & Scalability

**Understanding limits and backpressure**

Configure reasonable limits to prevent resource exhaustion:

```typescript
const router = createRouter({
  // Maximum message payload size (default: 16 MB)
  maxPayloadBytes: 1024 * 1024 * 16,

  // Maximum WebSocket write buffer before backpressuring (default: 16 MB)
  socketBufferLimitBytes: 1024 * 1024 * 16,

  // RPC timeout in milliseconds (default: 30s)
  rpcTimeoutMs: 30_000,

  // Drop progress updates if client is slow to receive (prevent memory growth)
  dropProgressOnBackpressure: true,
});
```

**Monitoring limits**

Use the `onLimitExceeded` hook to track when clients hit limits:

```typescript
const router = createRouter({
  onLimitExceeded(info) {
    console.warn(`Limit exceeded: ${info.type}`, {
      clientId: info.clientId,
      limit: info.limit,
      current: info.current,
    });
    // Alert if a client repeatedly hits limits (possible DoS or client bug)
    metrics.increment(`ws.limit_exceeded.${info.type}`);
  },
});
```

**Rate limiting strategies**

Implement per-client or per-user rate limits using middleware:

```typescript
const rateLimits = new Map<string, { count: number; resetAt: number }>();

router.use((ctx, next) => {
  const key = ctx.ws.data?.userId || ctx.ws.clientId;
  const now = Date.now();
  const limit = rateLimits.get(key);

  if (limit && now < limit.resetAt) {
    if (limit.count >= 100) {
      // 100 messages per second per user
      ctx.error("RESOURCE_EXHAUSTED", "Rate limit exceeded", undefined, {
        retryAfterMs: limit.resetAt - now,
      });
      return;
    }
    limit.count++;
  } else {
    // Reset window
    rateLimits.set(key, { count: 1, resetAt: now + 1000 });
  }

  return next();
});
```

## See Also

- [Core Concepts](./core-concepts) — Message routing, lifecycle hooks
- [Middleware](./adr/008-middleware-support) — Detailed middleware design
- [Error Handling](./specs/error-handling.md) — Complete error code taxonomy
- [Pub/Sub](./specs/pubsub.md) — Publishing, subscriptions, and patterns (see [Patterns](./specs/patterns.md) for throttling)
