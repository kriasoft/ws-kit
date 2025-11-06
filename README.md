# WS-Kit — Type-Safe WebSocket Router

[![npm version](https://img.shields.io/npm/v/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![npm downloads](https://img.shields.io/npm/dm/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![GitHub Actions](https://github.com/kriasoft/ws-kit/actions/workflows/main.yml/badge.svg)](https://github.com/kriasoft/ws-kit/actions)
[![Chat on Discord](https://img.shields.io/discord/643523529131950086?label=Discord)](https://discord.gg/aW29wXyb7w)

WebSocket server for Bun and Cloudflare. WS-Kit combines type-safe message routing, schema-validated broadcasting, and request-response patterns with full TypeScript inference on both server and client. Choose your validator (Zod or Valibot) and platform (Bun, Cloudflare Workers, or Node.js). Perfect for real-time apps: chat, multiplayer games, collaborative editing, live dashboards.

## Requirements

WS-Kit is **ESM-only** and optimized for modern runtimes:

- **Bun 1.0+** (recommended) — native ESM and WebSocket support
- **Cloudflare Workers/Durable Objects** — native ESM environment
- **Node.js 18+** (with bundler) — requires Vite, esbuild, or Rollup
- **Browser** — standard ESM bundler (Webpack, Vite, esbuild)

Not compatible with CommonJS-only projects or legacy Node versions.

## Features

What you get out of the box (things you'd otherwise build manually):

- **Type-safe routing** — Message handlers with full TypeScript inference from schema to handler
- **Schema validation** — Automatic request validation with Zod or Valibot; invalid messages rejected before handlers
- **Request-response** — RPC-style patterns with `ctx.reply()`, `ctx.progress()` (streaming), auto-correlation on client
- **Broadcasting** — Schema-validated `router.publish()` to topics; subscribers get typed messages
- **Lifecycle hooks** — `onOpen()`, `onClose()`, `onError()` with full context access
- **Middleware** — Global or per-handler middleware for auth, rate limiting, logging
- **Auto-reconnection** — Client-side exponential backoff with configurable timeouts
- **Offline queueing** — Client queues messages while disconnected; sends on reconnect
- **Connection data** — Type-safe per-connection state (user ID, session, room, etc.)
- **Error handling** — Standardized error codes (13 gRPC-aligned codes) with automatic retry inference
- **Single schema source** — Shared validator packages eliminate dual-package hazards

## Architecture

WS-Kit is a modular monorepo. Mix any validator with any platform:

- **`@ws-kit/core`** — Platform-agnostic router and type system
- **`@ws-kit/zod`** / **`@ws-kit/valibot`** — Validator adapters with `createRouter()`
- **`@ws-kit/bun`** — Bun platform adapter with `serve()` and `createBunHandler()`
- **`@ws-kit/cloudflare-do`** — Cloudflare Durable Objects adapter
- **`@ws-kit/client`** — Universal WebSocket client
- **`@ws-kit/redis-pubsub`** — Optional Redis for multi-server deployments

## Patterns & Advanced Use Cases

WS-Kit's core APIs support sophisticated real-time patterns without external libraries. See [`examples/`](./examples) for reference implementations:

- **State Channels** — Efficient state synchronization with minimal bandwidth (subscribe to changes, get deltas)
- **Delta Sync** — Incremental updates: server publishes only what changed, clients rebuild state
- **Flow Control** — Backpressure handling: queue management, rate limiting, throttling
- **Throttling** — Aggregate rapid client messages; batch updates for efficiency
- **Exponential Backoff** — Built-in client reconnection with configurable backoff strategy
- **Rate Limiting** — Per-user, per-message-type buckets with distributed (Redis) or in-memory adapters
- **Error Recovery** — Automatic retry inference from standardized error codes; custom retry logic via `retryable` and `retryAfterMs` hints
- **Multiplayer Sync** — Concurrent editing with per-connection data, subscription management, and conflict resolution patterns

Each pattern is production-tested and fully typed. Mix and match with your application's needs.

## Installation

Choose your validation library and platform:

```bash
# With Zod on Bun (recommended for most projects)
bun add @ws-kit/zod @ws-kit/bun
bun add zod bun @types/bun -D

# With Valibot on Bun (lighter bundles)
bun add @ws-kit/valibot @ws-kit/bun
bun add valibot bun @types/bun -D
```

## Quick Start

The **export-with-helpers pattern** is the first-class way to use WS-Kit —no factories, no dual imports:

```ts
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define message schemas with full type inference
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

// Create type-safe router with optional connection data
type AppData = { userId?: string };
const router = createRouter<AppData>();

// Register handlers — fully typed!
router.on(PingMessage, (ctx) => {
  console.log(`Received: ${ctx.payload.text}`); // ✅ Fully typed
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

// Serve with type-safe handlers
serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "u_123" } : undefined;
  },
});
```

**That's it!** Validator, router, messages, and platform adapter all come from focused packages. Type-safe from server to client.

### Eliminating Verbose Generics with Declaration Merging

For applications with multiple routers, reduce repetition by declaring your connection data type once using TypeScript **declaration merging**. Then omit the generic everywhere — it's automatic:

```ts
// types/app-data.d.ts
declare module "@ws-kit/core" {
  interface AppDataDefault {
    userId?: string;
    email?: string;
    roles?: string[];
  }
}
```

Now all routers automatically use this type — no repetition:

```ts
// ✅ No generic needed — automatically uses AppDataDefault
const router = createRouter();

router.on(SecureMessage, (ctx) => {
  // ✅ ctx.ws.data is properly typed with all default fields
  const userId = ctx.ws.data?.userId; // string | undefined
  const roles = ctx.ws.data?.roles; // string[] | undefined
});
```

If you need custom data for a specific router, use an explicit generic:

```ts
type CustomData = { feature: string; version: number };
const featureRouter = createRouter<CustomData>();
```

### Do and Don't

```
✅ DO:  import { z, message, createRouter } from "@ws-kit/zod"
❌ DON'T: import { z } from "zod"  (direct imports cause dual-package hazards)
```

## Validation Libraries

Choose between Zod and Valibot — same API, different trade-offs:

```ts
// Zod - mature ecosystem, familiar method chaining API
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Valibot - 60-80% smaller bundles, functional composition
import { v, message, createRouter } from "@ws-kit/valibot";
import { serve } from "@ws-kit/bun";
```

### Quick Comparison

| Feature     | Zod                      | Valibot                  |
| ----------- | ------------------------ | ------------------------ |
| Bundle Size | ~5-6 kB (Zod v4)         | ~1-2 kB                  |
| Performance | Baseline                 | ~2x faster               |
| API Style   | Method chaining          | Functional               |
| Best for    | Server-side, familiarity | Client-side, performance |

## Serving Your Router

Each platform adapter exports both high-level convenience and low-level APIs. All approaches support authentication, lifecycle hooks, and error handling.

### Platform-Specific Adapters (Recommended)

Use platform-specific imports for production deployments — they provide correct options, type safety, and clear errors:

**High-level (recommended):**

```ts
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();
serve(router, { port: 3000 });
```

**Low-level (advanced control):**

```ts
import { createBunHandler } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();
const { fetch, websocket } = createBunHandler(router);

Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      return fetch(req, server);
    }
    return new Response("Not Found", { status: 404 });
  },
  websocket,
});
```

Benefits:

- **Zero runtime detection** — No overhead, optimal tree-shaking
- **Type-safe options** — Platform-specific settings built-in (e.g., port for Bun)
- **Clear error messages** — Misconfigurations fail fast with helpful guidance
- **Deterministic behavior** — Same behavior across all environments

**For Cloudflare Durable Objects:**

```ts
import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();
const handler = createDurableObjectHandler(router, {
  authenticate(req) {
    /* ... */
  },
});

export default {
  fetch(req: Request) {
    return handler.fetch(req);
  },
};
```

### Authentication

Secure your router by validating clients during the WebSocket upgrade. Pass authenticated user data via the `authenticate` hook — all handlers then have type-safe access to this data:

```ts
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { verifyIdToken } from "./auth"; // Your authentication logic

// Define secured message
const SendMessage = message("SEND_MESSAGE", {
  text: z.string(),
});

// Define router with user data type
type AppData = {
  userId?: string;
  email?: string;
  roles?: string[];
};

const router = createRouter<AppData>();

// Global middleware for auth checks
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return; // Skip handler
  }
  return next();
});

// Handlers have full type safety
router.on(SendMessage, (ctx) => {
  const userId = ctx.ws.data?.userId; // ✅ Type narrowed
  const email = ctx.ws.data?.email; // ✅ Type narrowed
  console.log(`${email} sent: ${ctx.payload.text}`);
});

// Authenticate and serve
serve(router, {
  port: 3000,
  authenticate(req) {
    // Verify JWT or session token
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (token) {
      const decoded = verifyIdToken(token);
      return {
        userId: decoded.uid,
        email: decoded.email,
        roles: decoded.roles || [],
      };
    }
  },
  onError(error, ctx) {
    console.error(`WS-Kit error in ${ctx?.type}:`, error);
  },
  onOpen(ctx) {
    console.log(`User ${ctx.ws.data?.email} connected`);
  },
  onClose(ctx) {
    console.log(`User ${ctx.ws.data?.email} disconnected`);
  },
});
```

The `authenticate` function receives the HTTP upgrade request and returns user data that becomes `ctx.ws.data` in all handlers. If it returns `null` or `undefined`, the connection is rejected.

## Message Schemas

Use the `message()` helper directly — no factory pattern needed:

```ts
import { z, message } from "@ws-kit/zod";

// Define your message types
export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
});

export const UserJoined = message("USER_JOINED", {
  roomId: z.string(),
  userId: z.string(),
});

export const UserLeft = message("USER_LEFT", {
  userId: z.string(),
});

export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string(),
});

// With Valibot
import { v, message } from "@ws-kit/valibot";

export const JoinRoom = message("JOIN_ROOM", {
  roomId: v.string(),
});
```

Simple, no factories, one canonical import source.

### Validation: Strict Mode & Reserved Keys

All schemas are validated in **strict mode** by default — unknown keys at the root and payload levels are rejected. This protects against typos and ensures type safety:

```ts
// ✅ Valid
client.send(JoinRoom, { roomId: "room-1" });

// ❌ Rejected (unknown key `userId` not in schema)
client.send(JoinRoom, { roomId: "room-1", userId: "u123" });
```

Reserved keys (`clientId`, `receivedAt`, `meta`) are automatically stripped from client messages before validation, preventing clients from spoofing server-assigned metadata.

### Request-Response Pairs with `rpc()`

For request-response patterns, use `rpc()` to bind request and response schemas together — no schema repetition at call sites:

```ts
import { z, rpc, createRouter } from "@ws-kit/zod";

// Define RPC schema - binds request to response type
const Ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });
const Query = rpc("QUERY", { id: z.string() }, "RESULT", { data: z.string() });

// With Valibot
import { v, rpc } from "@ws-kit/valibot";
const Ping = rpc("PING", { text: v.string() }, "PONG", { reply: v.string() });
```

The client auto-detects the response type from the RPC schema, eliminating the need to specify it separately on every request.

### RPC Handlers

Register RPC handlers with `router.rpc()` to use request/response pattern with `ctx.reply()` and `ctx.progress()`:

```ts
import { z, rpc, createRouter } from "@ws-kit/zod";

const GetUser = rpc("GET_USER", { userId: z.string() }, "USER_DATA", {
  name: z.string(),
  email: z.string(),
});

const router = createRouter();

router.rpc(GetUser, (ctx) => {
  const { userId } = ctx.payload;

  // Send terminal response (one-shot)
  ctx.reply({ name: "Alice", email: "alice@example.com" });
});
```

For streaming responses, use `ctx.progress()` for non-terminal updates before the final `ctx.reply()`:

```ts
const DownloadFile = rpc(
  "DOWNLOAD_FILE",
  { fileId: z.string() },
  "FILE_CHUNK",
  { chunk: z.string(), finished: z.boolean() },
);

router.rpc(DownloadFile, (ctx) => {
  const { fileId } = ctx.payload;

  // Send progress updates (non-terminal)
  ctx.progress({ chunk: "data...", finished: false });
  ctx.progress({ chunk: "more...", finished: false });

  // Send terminal response (final)
  ctx.reply({ chunk: "end", finished: true });
});
```

**Fire-and-forget vs RPC:**

- `router.on(Message, handler)` — Use `ctx.send()` for fire-and-forget messages
- `router.rpc(RpcSchema, handler)` — Use `ctx.reply()` (terminal) and `ctx.progress()` (streaming) for request/response

## Handlers and Routing

Register handlers with full type safety. The context includes schema-typed payloads, connection data, and lifecycle hooks:

```ts
import { z, message, createRouter } from "@ws-kit/zod";
import { JoinRoom, UserJoined, SendMessage, UserLeft } from "./schema";

type ConnectionData = {
  userId?: string;
  roomId?: string;
};

const router = createRouter<ConnectionData>();

// Handle new connections
router.onOpen((ctx) => {
  console.log(`Client connected: ${ctx.ws.data.userId}`);
});

// Handle specific message types (fully typed!)
router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload; // ✅ Fully typed from schema
  const userId = ctx.ws.data?.userId;

  // Update connection data
  ctx.assignData({ roomId });

  // Subscribe to room broadcasts
  ctx.subscribe(roomId);

  console.log(`User ${userId} joined room: ${roomId}`);
  console.log(`Message received at: ${ctx.receivedAt}`);

  // Send confirmation (type-safe!)
  ctx.send(UserJoined, { roomId, userId: userId || "anonymous" });
});

router.on(SendMessage, async (ctx) => {
  const { text } = ctx.payload;
  const userId = ctx.ws.data?.userId;
  const roomId = ctx.ws.data?.roomId;

  console.log(`[${roomId}] ${userId}: ${text}`);

  // Broadcast to room subscribers (type-safe!)
  await router.publish(roomId, SendMessage, {
    text,
    userId: userId || "anonymous",
  });
});

// Handle disconnections
router.onClose(async (ctx) => {
  const userId = ctx.ws.data?.userId;
  const roomId = ctx.ws.data?.roomId;

  if (roomId) {
    ctx.unsubscribe(roomId);
    // Notify others
    await router.publish(roomId, UserLeft, { userId: userId || "anonymous" });
  }
  console.log(`Disconnected: ${userId}`);
});
```

**Context Fields:**

- `ctx.payload` — Typed payload from schema (✅ fully typed!)
- `ctx.ws.data` — Connection data (type-narrowed from `<TData>`)
- `ctx.type` — Message type literal (e.g., `"JOIN_ROOM"`)
- `ctx.meta` — Client metadata (correlationId, timestamp)
- `ctx.receivedAt` — Server receive timestamp
- `ctx.send()` — Type-safe send to this client only
- `ctx.getData()` — Type-safe single field access from connection data
- `ctx.assignData()` — Type-safe partial data updates
- `ctx.subscribe()` / `ctx.unsubscribe()` — Topic management
- `ctx.error(code, message?, details?, options?)` — Send type-safe error with optional retry hints

## Broadcasting and Subscriptions

Broadcasting messages to multiple clients is type-safe with schema validation:

```ts
import { z, message, createRouter } from "@ws-kit/zod";

const RoomUpdate = message("ROOM_UPDATE", {
  roomId: z.string(),
  users: z.number(),
  message: z.string(),
});

const router = createRouter<{ roomId?: string }>();

router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;

  // Subscribe to room updates
  ctx.subscribe(roomId);
  ctx.assignData({ roomId });

  console.log(`User joined: ${roomId}`);

  // Broadcast to all room subscribers (type-safe!)
  await router.publish(roomId, RoomUpdate, {
    roomId,
    users: 5,
    message: "A user has joined",
  });
});

router.on(SendMessage, async (ctx) => {
  const roomId = ctx.ws.data?.roomId;

  // Broadcast message to room (fully typed, no JSON.stringify needed!)
  await router.publish(roomId, RoomUpdate, {
    roomId,
    users: 5,
    message: ctx.payload.text,
  });
});

router.onClose(async (ctx) => {
  const roomId = ctx.ws.data?.roomId;
  if (roomId) {
    ctx.unsubscribe(roomId);
    await router.publish(roomId, RoomUpdate, {
      roomId,
      users: 4,
      message: "A user has left",
    });
  }
});
```

**Broadcasting API:**

- `router.publish(scope, schema, payload, options?)` — Type-safe broadcast to all subscribers on a scope, returns `Promise<PublishResult>` with delivery info
- `ctx.publish(scope, schema, payload, options?)` — Same as `router.publish()` but available within a handler context
- `ctx.subscribe(topic)` — Subscribe connection to a topic (adapter-dependent)
- `ctx.unsubscribe(topic)` — Unsubscribe from a topic

Optional `options` parameter for `publish()`:

```ts
{
  excludeSelf?: boolean;   // Throws error if true (not yet implemented)
  partitionKey?: string;   // Route to specific partition (optional, for sharded pubsub)
  meta?: Record<string, unknown>; // Additional metadata (e.g., { senderId: "user:123" })
}
```

```ts
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roomId?: string };
const router = createRouter<AppData>();

const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const UserJoined = message("USER_JOINED", {
  roomId: z.string(),
  userId: z.string(),
});
const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  message: z.string(),
});
const NewMessage = message("NEW_MESSAGE", {
  roomId: z.string(),
  userId: z.string(),
  message: z.string(),
});
const UserLeft = message("USER_LEFT", { userId: z.string() });

router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data?.userId || "anonymous";

  // Store room ID and subscribe to topic
  ctx.assignData({ roomId });
  ctx.subscribe(roomId);

  // Send confirmation back
  ctx.send(UserJoined, { roomId, userId });

  // Broadcast to room subscribers with schema validation
  await ctx.publish(roomId, UserJoined, { roomId, userId });
});

router.on(SendMessage, (ctx) => {
  const { roomId, message: msg } = ctx.payload;
  const userId = ctx.ws.data?.userId || "anonymous";

  console.log(`Message in room ${roomId} from ${userId}: ${msg}`);

  // Broadcast the message to all room subscribers
  await ctx.publish(roomId, NewMessage, { roomId, userId, message: msg });
});

router.onClose((ctx) => {
  const userId = ctx.ws.data?.userId || "anonymous";
  const roomId = ctx.ws.data?.roomId;

  if (roomId) {
    ctx.unsubscribe(roomId);
    // Notify others in the room
    await router.publish(roomId, UserLeft, { userId });
  }
});
```

The `publish()` function ensures that all broadcast messages are validated against their schemas before being sent, providing the same type safety for broadcasts that you get with direct messaging.

## Error handling and sending error messages

Effective error handling is crucial for maintaining robust WebSocket connections. WS-Kit provides built-in error response support with standardized error codes and automatic retry inference for clients.

### Error handling with ctx.error()

Use `ctx.error()` to send type-safe error responses with optional retry hints:

```ts
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { userId?: string };
const router = createRouter<AppData>();

const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });

router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;

  // Check if room exists
  const roomExists = await checkRoomExists(roomId);
  if (!roomExists) {
    // Send non-retryable error with context
    ctx.error("NOT_FOUND", `Room ${roomId} does not exist`, { roomId });
    return;
  }

  // Continue with normal flow
  ctx.assignData({ roomId });
  ctx.subscribe(roomId);
});
```

For transient errors, include a backoff hint:

```ts
router.on(SomeMessage, async (ctx) => {
  try {
    const result = await getDataWithQuota();
    // ...
  } catch (error) {
    if (isRateLimited(error)) {
      // Send retryable error with backoff hint
      ctx.error("RESOURCE_EXHAUSTED", "Rate limit exceeded", undefined, {
        retryable: true,
        retryAfterMs: 1000, // Client should wait 1s before retry
      });
    } else {
      ctx.error("INTERNAL", "Server error");
    }
  }
});
```

### Standard error codes

The standard error codes (13 codes, aligned with gRPC) are automatically inferred as retryable or non-retryable:

**Terminal errors (non-retryable):**

- `UNAUTHENTICATED` — Authentication failed
- `PERMISSION_DENIED` — Authenticated but lacks rights
- `INVALID_ARGUMENT` — Invalid payload or schema mismatch
- `FAILED_PRECONDITION` — Operation preconditions not met
- `NOT_FOUND` — Resource not found
- `ALREADY_EXISTS` — Resource already exists
- `UNIMPLEMENTED` — Feature not implemented
- `CANCELLED` — Request cancelled by client

**Transient errors (retryable with backoff):**

- `DEADLINE_EXCEEDED` — Request deadline exceeded
- `RESOURCE_EXHAUSTED` — Rate limit, backpressure, or quota exceeded
- `UNAVAILABLE` — Service temporarily unavailable
- `ABORTED` — Concurrency conflict or operation aborted

**Mixed (app-specific):**

- `INTERNAL` — Unexpected server error (retryability determined by app)

Clients automatically infer retry behavior from the error code. Use `retryAfterMs` to provide backoff hints for transient errors, or override `retryable` for specific cases.

See [ADR-015](docs/adr/015-error-handling.md) for the complete error code taxonomy and [docs/specs/error-handling.md](docs/specs/error-handling.md) for retry semantics.

### Custom error handling

You can add error handling middleware or lifecycle hooks:

```ts
// Error handling in connection setup
router.onOpen((ctx) => {
  try {
    console.log(`Client ${ctx.ws.data?.clientId} connected`);
  } catch (error) {
    console.error("Error in connection setup:", error);
    ctx.error("INTERNAL", "Failed to set up connection");
  }
});

// Error handling with middleware
router.use((ctx, next) => {
  try {
    return next();
  } catch (error) {
    ctx.error("INTERNAL", "Request failed");
  }
});

// Error handling in message handlers
const AuthenticateUser = message("AUTH", { token: z.string() });
router.on(AuthenticateUser, (ctx) => {
  try {
    const { token } = ctx.payload;
    const user = validateToken(token);

    if (!user) {
      ctx.error("UNAUTHENTICATED", "Invalid authentication token");
      return;
    }

    // Use assignData for type-safe connection data updates
    ctx.assignData({ userId: user.id, userRole: user.role });
  } catch (error) {
    ctx.error("INTERNAL", "Authentication process failed");
  }
});
```

## Rate Limiting

Protect your WebSocket server from abuse with atomic, distributed rate limiting. WS-Kit provides an adapter-first rate limiting system that works across single-instance and multi-pod deployments.

### Quick Start (Single-Instance)

For development or single-instance deployments, use the in-memory adapter:

```ts
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

const limiter = rateLimit({
  limiter: memoryRateLimiter({
    capacity: 200, // Max 200 tokens per bucket
    tokensPerSecond: 100, // Refill at 100 tokens/second
  }),
  key: keyPerUserPerType, // Per-user per-message-type buckets (recommended)
});

const router = createRouter<AppData>();
router.use(limiter); // Apply to all messages
```

### Multi-Pod Deployments (Redis)

For distributed deployments, coordinate via Redis:

```ts
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { redisRateLimiter } from "@ws-kit/adapters/redis";
import { createClient } from "redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const limiter = rateLimit({
  limiter: redisRateLimiter(redisClient, {
    capacity: 200,
    tokensPerSecond: 100,
  }),
  key: keyPerUserPerType,
});

router.use(limiter);
```

### Cloudflare Workers (Durable Objects)

For Cloudflare Workers, use Durable Objects for coordination:

```ts
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { durableObjectRateLimiter } from "@ws-kit/adapters/cloudflare-do";

const limiter = rateLimit({
  limiter: durableObjectRateLimiter(env.RATE_LIMITER, {
    capacity: 200,
    tokensPerSecond: 100,
  }),
  key: keyPerUserPerType,
});

router.use(limiter);
```

### Key Functions

Three built-in key functions provide different isolation strategies:

- **`keyPerUserPerType`** (recommended) — One bucket per (user, message type). Prevents one operation from starving others.
- **`keyPerUserOrIpPerType`** — Per-user for authenticated traffic, IP fallback for anonymous (requires router integration for IP access).
- **`perUserKey`** — Simpler per-user bucket. Use `cost()` to weight operations within a shared budget.

Create custom key functions for other strategies:

```ts
const limiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 }),
  key: (ctx) => `${ctx.ws.data?.userId}:${ctx.type}`, // Custom keying
  cost: (ctx) => (ctx.type === "ExpensiveOp" ? 10 : 1),
});
```

### Observability

Rate limit violations are reported via the `onLimitExceeded` hook:

```ts
serve(router, {
  port: 3000,
  onLimitExceeded(info) {
    if (info.type === "rate") {
      console.warn("rate_limited", {
        clientId: info.clientId,
        observed: info.observed, // Attempted cost
        limit: info.limit, // Bucket capacity
        retryAfterMs: info.retryAfterMs,
      });
      metrics.increment("rate_limit.exceeded");
    }
  },
});
```

For complete documentation, see [docs/proposals/rate-limiting.md](docs/proposals/rate-limiting.md) and [docs/guides/rate-limiting.md](docs/guides/rate-limiting.md).

## Multi-Instance Deployments

For distributed deployments across multiple server instances, use Redis to coordinate subscriptions and broadcasting:

```ts
import { createRouter } from "@ws-kit/zod";
import { redisPubSub } from "@ws-kit/redis-pubsub";
import { createClient } from "redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const router = createRouter({
  pubsub: redisPubSub(redisClient),
});

// Now ctx.publish() and ctx.subscribe() work across all instances
router.on(JoinRoom, (ctx) => {
  ctx.subscribe(ctx.payload.roomId);
  ctx.publish(ctx.payload.roomId, UserJoined, { userId: ctx.ws.data?.userId });
});
```

Without explicit `pubsub` configuration, broadcasting is scoped to the current instance. Redis enables cross-instance pub/sub for chat rooms, notifications, and real-time dashboards.

## How to compose routes

Organize code by splitting handlers into separate routers, then merge them into a main router using the `merge()` method:

```ts
import { createRouter } from "@ws-kit/zod";
import { chatRoutes } from "./chat";
import { notificationRoutes } from "./notification";

type AppData = { userId?: string };

// Create main router
const mainRouter = createRouter<AppData>();

// Compose with sub-routers
mainRouter.merge(chatRoutes).merge(notificationRoutes);
```

Where `chatRoutes` and `notificationRoutes` are separate routers created with `createRouter<AppData>()` in their own files. The `merge()` method combines handlers, lifecycle hooks, and middleware from the composed routers.

## Browser Client

Type-safe browser WebSocket client with automatic reconnection, authentication, and request/response patterns — using the same validator and message definitions:

```ts
import { rpc, message, wsClient } from "@ws-kit/client/zod";

// Define message schemas
const Hello = rpc("HELLO", { name: z.string() }, "HELLO_OK", {
  text: z.string(),
});
const ServerBroadcast = message("BROADCAST", { data: z.string() });

// Create type-safe client with authentication
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: () => localStorage.getItem("access_token"),
  },
});

await client.connect();

// Send fire-and-forget message
client.send(Hello, { name: "Anna" });

// Listen for server broadcasts with full type inference
client.on(ServerBroadcast, (msg) => {
  // ✅ msg.payload.data is typed as string
  console.log("Server broadcast:", msg.payload.data);
});

// Request/response with auto-detected response schema (modern RPC-style)
try {
  const reply = await client.request(
    Hello,
    { name: "Bob" },
    {
      timeoutMs: 5000,
    },
  );
  // ✅ reply.payload.text is fully typed from RPC schema
  console.log("Server replied:", reply.payload.text);
} catch (err) {
  console.error("Request failed:", err);
}

// Graceful disconnect
await client.close();
```

You can also use explicit response schemas for backward compatibility (traditional style):

```ts
// Traditional: client.request(schema, payload, responseSchema, options)
const reply = await client.request(Hello, { name: "Bob" }, HelloOk, {
  timeoutMs: 5000,
});
```

**Client Features:**

- Auto-reconnection with exponential backoff
- Configurable offline message queueing
- Request/response pattern with timeouts
- Built-in auth (query param or protocol header)
- Full TypeScript type inference from schemas

See the [Client Documentation](./docs/specs/client.md) for complete API reference and advanced usage.

## Breaking Changes & Migration

### Error Message Parameter is Optional

The `ctx.error()` method now has an optional message parameter and supports retry semantics:

```ts
// Old signature (still works - backward compatible)
ctx.error("NOT_FOUND", "Resource not found", { resourceId });

// New signature with retry hints
ctx.error("RESOURCE_EXHAUSTED", undefined, undefined, {
  retryable: true,
  retryAfterMs: 1000,
});
```

The wire format for errors now includes optional `retryable` and `retryAfterMs` fields. Clients automatically infer retry behavior from error codes via `ERROR_CODE_META`.

### Validator is Required

The router now requires a validator to be configured. All imports should come from validator packages to ensure the correct validator is set up:

```ts
// ✅ Correct: Validator is included
import { createRouter } from "@ws-kit/zod";
const router = createRouter();

// ❌ Incorrect: Will throw if no validator is set
import { WebSocketRouter } from "@ws-kit/core";
const router = new WebSocketRouter(); // ← Error: validator is required
```

**Migration:** Always import `createRouter()` from `@ws-kit/zod` or `@ws-kit/valibot`, not from `@ws-kit/core`.

### Heartbeat is Now Opt-In

Heartbeat is no longer enabled by default. Enable it explicitly if you need client liveness detection:

```ts
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

const router = createRouter();

serve(router, {
  port: 3000,
  heartbeat: {
    intervalMs: 30_000, // Ping every 30s (default)
    timeoutMs: 5_000, // Wait 5s for pong (default)
    onStaleConnection(clientId, ws) {
      console.log(`Connection ${clientId} is stale, closing...`);
      ws.close();
    },
  },
});
```

**Migration:** Add `heartbeat` config to `serve()` options if you previously relied on default heartbeat behavior.

### PubSub is Lazily Initialized

PubSub (for `ctx.publish()` and subscriptions) is now created only on first use. Apps without broadcasting incur zero overhead.

**Migration:** No action needed. Broadcasting works the same way; initialization is just deferred.

## Design & Architecture

See [Architectural Decision Records](./docs/adr/) for the core design decisions that shaped ws-kit, including type safety patterns, platform adapters, and composability.

## Support

Questions or issues? Join us on [Discord](https://discord.gg/aW29wXyb7w).

## Backers

<a href="https://reactstarter.com/b/1"><img src="https://reactstarter.com/b/1.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/2"><img src="https://reactstarter.com/b/2.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/3"><img src="https://reactstarter.com/b/3.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/4"><img src="https://reactstarter.com/b/4.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/5"><img src="https://reactstarter.com/b/5.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/6"><img src="https://reactstarter.com/b/6.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/7"><img src="https://reactstarter.com/b/7.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/8"><img src="https://reactstarter.com/b/8.png" height="60" /></a>

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
