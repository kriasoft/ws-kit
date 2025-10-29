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
  console.log(`Message from ${userId}: ${ctx.payload.text}`);

  // Broadcast to all connected clients
  router.publish("chat", BroadcastMessage, {
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
    ctx.error("AUTH_ERROR", "Not authenticated");
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
    ctx.error("RATE_LIMIT", "Too many messages");
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
- Middleware can modify `ctx.ws.data` for handlers to access
- Both sync and async middleware supported

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
    ctx.error("AUTH_ERROR", "Invalid credentials", {
      hint: "Check your email and password",
    });
  }
});

router.on(QueryMessage, (ctx) => {
  try {
    const result = queryDatabase(ctx.payload.id);
    ctx.reply(QueryResponse, { data: result });
  } catch (err) {
    ctx.error("INTERNAL_ERROR", "Database query failed");
  }
});
```

**Standard error codes:**

- `VALIDATION_ERROR` — Invalid payload or schema mismatch
- `AUTH_ERROR` — Authentication failed
- `INTERNAL_ERROR` — Server error
- `NOT_FOUND` — Resource not found
- `RATE_LIMIT` — Rate limit exceeded

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
  router.publish(ctx.payload.channelId, TextMessage, ctx.payload);
});

router.on(ImageMessage, (ctx) => {
  console.log(
    "Image:",
    ctx.payload.url,
    ctx.payload.width,
    "x",
    ctx.payload.height,
  );
  router.publish(ctx.payload.channelId, ImageMessage, ctx.payload);
});

router.on(VideoMessage, (ctx) => {
  console.log("Video:", ctx.payload.url, ctx.payload.duration, "s");
  router.publish(ctx.payload.channelId, VideoMessage, ctx.payload);
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

## Testing Multiple Runtimes

For monorepos or comprehensive testing, test the same router under multiple runtimes (Bun, Cloudflare DO, etc.). See [Advanced: Multi-Runtime Harness](../guides/advanced-multi-runtime.md) for complete integration test patterns.

Quick example:

```typescript
import { describe, it } from "bun:test";
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";

const router = createRouter();
router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: "pong" });
});

// Test the same router under multiple runtimes
for (const runtime of ["bun", "cloudflare-do"] as const) {
  describe(`Router under ${runtime}`, () => {
    it("handles messages", async () => {
      const port = 3000 + (runtime === "bun" ? 0 : 1);

      // Start server with explicit runtime
      await serve(router, { port, runtime });

      const client = wsClient(`ws://localhost:${port}`);
      await client.connect();

      const reply = await client.request(PingMessage, {}, PongMessage);

      console.assert(reply.payload.reply === "pong");
      await client.disconnect();
    });
  });
}
```

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
  ctx.subscribe(roomId);

  // Broadcast to room (type-safe!)
  router.publish(roomId, RoomUpdate, {
    roomId,
    users: 5,
    message: `User ${userId} joined`,
  });
});
```

All broadcast messages are validated against their schemas before being sent, providing the same type safety for broadcasts as for direct messaging.

## See Also

- [Core Concepts](./core-concepts) — Message routing, lifecycle hooks
- [Middleware](../adr/008-middleware-support.md) — Detailed middleware design
- [Advanced: Multi-Runtime Harness](../guides/advanced-multi-runtime.md) — Integration testing, monorepo patterns
