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

router.on(LoginMessage, (ctx) => {
  try {
    const user = authenticateUser(ctx.payload);
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
    const result = queryDatabase(ctx.payload.id);
    ctx.send(QueryResponse, { data: result });
  } catch (err) {
    ctx.error("INTERNAL", "Database query failed");
  }
});

// Transient errors with retry hints
router.on(ProcessPaymentMessage, (ctx) => {
  try {
    processPayment(ctx.payload);
  } catch (err) {
    if (isRateLimited(err)) {
      // Transient error: send backoff hint for client retry
      ctx.error("RESOURCE_EXHAUSTED", "Rate limit exceeded", undefined, {
        retryable: true,
        retryAfterMs: 5000, // Client waits 5s before retry
      });
    } else if (isTemporarilyUnavailable(err)) {
      // Infrastructure error: automatic client backoff
      ctx.error("UNAVAILABLE", "Service temporarily unavailable");
    } else {
      // Unexpected error: don't retry
      ctx.error("INTERNAL", "Payment processing failed");
    }
  }
});
```

**Standard error codes** (gRPC-aligned, see ADR-015):

Clients automatically infer retry behavior from error codes. Use `retryAfterMs` option to provide backoff hints for transient errors.

**Terminal errors** (don't retry):

- `INVALID_ARGUMENT` — Invalid payload or schema mismatch
- `UNAUTHENTICATED` — Authentication failed (missing or invalid token)
- `PERMISSION_DENIED` — Authenticated but lacks rights
- `NOT_FOUND` — Resource not found
- `FAILED_PRECONDITION` — State requirement not met
- `ALREADY_EXISTS` — Uniqueness or idempotency violation
- `UNIMPLEMENTED` — Feature not supported or deployed
- `CANCELLED` — Request cancelled by client or peer

**Transient errors** (automatically retryable):

- `DEADLINE_EXCEEDED` — RPC request timed out
- `RESOURCE_EXHAUSTED` — Rate limit, quota, or backpressure exceeded (use `retryAfterMs` for backoff)
- `UNAVAILABLE` — Transient infrastructure error
- `ABORTED` — Concurrency conflict (race condition), automatically retried

**Mixed (app-specific)**:

- `INTERNAL` — Unexpected server error (server decides if retryable)

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

router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data?.userId;

  // Store room ID and subscribe to topic
  ctx.assignData({ roomId });
  ctx.subscribe(`room:${roomId}`);

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

## Custom Validators

While ws-kit provides official adapters for Zod and Valibot, you can integrate any validation library by implementing the `ValidatorAdapter` interface:

```typescript
import { WebSocketRouter, type ValidatorAdapter } from "@ws-kit/core";

// Example: Custom validator adapter
class CustomValidatorAdapter implements ValidatorAdapter {
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
      const result = myValidator.parse(schema, data);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: { message: String(err), path: [] },
      };
    }
  }
}

// Use custom validator with router
const router = new WebSocketRouter({
  validator: new CustomValidatorAdapter(),
});
```

**Validator requirements:**

- **Strict mode**: Reject unknown keys at all levels (root, meta, payload)
- **Payload enforcement**: Reject messages with `payload` key when schema defines none
- **Type safety**: Preserve TypeScript types through validation
- **Error reporting**: Provide clear error messages with paths

See `docs/specs/validation.md` for complete requirements and validation flow.

## See Also

- [Core Concepts](./core-concepts) — Message routing, lifecycle hooks
- [Middleware](./adr/008-middleware-support) — Detailed middleware design
- [Error Handling](./specs/error-handling.md) — Complete error code taxonomy
- [Broadcasting](./specs/broadcasting.md) — Pub/sub patterns and throttling
