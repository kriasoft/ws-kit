# WS-Kit — Schema-First WebSocket Framework

[![CI](https://github.com/kriasoft/ws-kit/actions/workflows/main.yml/badge.svg)](https://github.com/kriasoft/ws-kit/actions)
[![Coverage](https://codecov.io/gh/kriasoft/ws-kit/branch/main/graph/badge.svg)](https://app.codecov.io/gh/kriasoft/ws-kit)
[![npm](https://img.shields.io/npm/v/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![Downloads](https://img.shields.io/npm/dm/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![Discord](https://img.shields.io/discord/643523529131950086?label=Discord)](https://discord.gg/aW29wXyb7w)

> ⚠️ **WARNING**: WS-Kit is transitioning to a new plugin architecture with a normalized adapter façade. The codebase is evolving quickly and several components are still incomplete. Early feedback, testing, and PRs are appreciated.

Define message contracts with Zod or Valibot, get complete TypeScript inference across server and client. Type-safe RPC, pub/sub, middleware, and error handling out of the box. Plugin-driven architecture for extensibility — swap validators, adapters, and middleware. Runs on Bun, Cloudflare, Node.js, and browsers with testable, composable handlers.

## Features

What you get out of the box (things you'd otherwise build manually):

- **Full TypeScript inference** — Type-safe from schema to handler, connection data, and errors
- **Schema validation** — Automatic with Zod or Valibot; rejects invalid messages before handlers
- **Request-response** — RPC with `ctx.reply()` and `ctx.progress()` for streaming
- **Broadcasting** — Type-safe pub/sub with no manual serialization
- **Client resilience** — Auto-reconnect, offline queueing, automatic retry inference
- **Lifecycle hooks** — `onOpen()`, `onClose()`, `onError()` with full context
- **Middleware** — Per-handler auth, rate limiting, logging; merge feature routers
- **Connection state** — Type-safe per-connection data shared across routers
- **Error handling** — Standardized codes with automatic retry inference
- **Testing** — Built-in test harness with fake connections, fake clock, and event capture
- **Plugin architecture** — Swap validators and adapters; zero overhead for unused features

## Architecture

WS-Kit is a modular monorepo. Mix any validator with any platform:

**Core Packages:**

- **`@ws-kit/core`** — Platform-agnostic router and type system
- **`@ws-kit/zod`** / **`@ws-kit/valibot`** — Validator adapters with `createRouter()`

**Plugins:**

- **`@ws-kit/plugins`** — Core framework plugins (`withMessaging`, `withRpc`)
- **`@ws-kit/pubsub`** — Pub/Sub plugin for broadcasting and subscriptions

**Platform Adapters:**

- **`@ws-kit/bun`** — Bun platform adapter with `serve()` and `createBunHandler()`
- **`@ws-kit/cloudflare`** — Cloudflare Durable Objects adapter

**Client:**

- **`@ws-kit/client`** — Universal WebSocket client (works with any server adapter)

**Middleware & Production Features:**

- **`@ws-kit/rate-limit`** — Rate limiting middleware (per-user, per-type bucketing)
- **`@ws-kit/middleware`** — Additional middleware (auth helpers, logging, telemetry)

**Adapters for Distributed Deployments:**

- **`@ws-kit/memory`** — In-memory pub/sub and rate limiting (local/single-instance)
- **`@ws-kit/redis`** — Redis pub/sub and rate limiting (multi-instance deployments)

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

The **canonical import pattern** is the first-class way to use WS-Kit — import from a single validator package to ensure type safety and avoid dual-package hazards:

```ts
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define message schemas with full type inference
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

// Create router and enable validation via plugin
const router = createRouter().plugin(withZod());

// Register handlers — fully typed!
router.on(PingMessage, (ctx) => {
  console.log(`Received: ${ctx.payload.text}`); // ✅ Fully typed
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

// Serve with authentication and lifecycle hooks
serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "u_123" } : undefined;
  },
  onOpen(ctx) {
    console.log(`Connected: ${ctx.data?.userId}`);
  },
  onClose(ctx) {
    console.log(`Disconnected: ${ctx.data?.userId}`);
  },
});
```

**That's it!** Import from your validator package (`@ws-kit/zod` or `@ws-kit/valibot`), create a router, add plugins for features you need, and serve. Type-safe from server to client.

### Import Patterns: Where Does `createRouter` Come From?

`createRouter()` is available from **both** `@ws-kit/core` and `@ws-kit/zod`/`@ws-kit/valibot`:

- **`@ws-kit/core`** — Base router factory (minimal, validator-agnostic)
- **`@ws-kit/zod`** / **`@ws-kit/valibot`** — Re-exports `createRouter` for convenience, plus validators and helpers

**Recommended**: Import from your validator package for a single canonical import source:

```ts
// ✅ Single import source (recommended)
import { createRouter, withZod, z, message } from "@ws-kit/zod";
```

**If you prefer**: Import from core and plugins separately:

```ts
// ✅ Also works (explicit imports)
import { createRouter } from "@ws-kit/core";
import { withZod, z, message } from "@ws-kit/zod";
```

**Key point**: The validator plugin (`withZod()` / `withValibot()`) is **explicit and required** for RPC and payload validation. Create a bare router anytime, but enable validation when needed:

```ts
// Bare router (no validation)
const router = createRouter();
router.on(MyMessage, (ctx) => {
  /* payload not typed */
});

// With validation plugin
const validatedRouter = createRouter().plugin(withZod());
validatedRouter.on(MyMessage, (ctx) => {
  /* payload fully typed */
});
validatedRouter.rpc(RpcSchema, handler); // RPC available with validation
```

### Multi-Router Apps: Module Augmentation

For applications with **multiple routers across files**, use TypeScript **module augmentation** to define connection data once — all routers automatically share it:

```ts
// types/connection-data.d.ts (project root)
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    email?: string;
    roles?: string[];
  }
}
```

Now create feature routers without repeating type parameters:

```ts
// src/features/chat.ts
import { createRouter, withZod } from "@ws-kit/zod";
import { JoinRoom, SendMessage, UserJoined } from "./schema";

const chatRouter = createRouter().plugin(withZod()); // ✅ Connection data is automatically typed, validation enabled

chatRouter.on(JoinRoom, async (ctx) => {
  const userId = ctx.data?.userId; // ✅ Properly typed
  const roomId = ctx.payload.roomId;
  await ctx.topics.subscribe(roomId);
  ctx.send(UserJoined, { roomId, userId: userId || "anonymous" });
});

export { chatRouter };
```

Compose feature routers into your main app:

```ts
// src/server.ts
import { createRouter, withZod } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { chatRouter } from "./features/chat";
import { presenceRouter } from "./features/presence";

const mainRouter = createRouter()
  .plugin(withZod())
  .merge(chatRouter)
  .merge(presenceRouter);

serve(mainRouter, { port: 3000 });
```

**Key pattern**: Module augmentation at the project level eliminates type repetition across all routers.

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
import { createDurableObjectHandler } from "@ws-kit/cloudflare";
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
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { verifyIdToken } from "./auth"; // Your authentication logic

declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    email?: string;
    roles?: string[];
  }
}

const SendMessage = message("SEND_MESSAGE", {
  text: z.string(),
});

const router = createRouter().plugin(withZod());

// Global middleware for auth checks
router.use((ctx, next) => {
  if (!ctx.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return; // Skip handler
  }
  return next();
});

// Handlers have full type safety
router.on(SendMessage, (ctx) => {
  const userId = ctx.data?.userId; // ✅ Type narrowed
  const email = ctx.data?.email; // ✅ Type narrowed
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
  onOpen(ctx) {
    console.log(`User ${ctx.data?.email} connected`);
  },
  onClose(ctx) {
    console.log(`User ${ctx.data?.email} disconnected`);
  },
});
```

The `authenticate` function receives the HTTP upgrade request and returns user data that becomes `ctx.data` in all handlers. If it returns `null` or `undefined`, the connection is rejected.

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
import { z, rpc, createRouter, withZod } from "@ws-kit/zod";

const GetUser = rpc("GET_USER", { userId: z.string() }, "USER_DATA", {
  name: z.string(),
  email: z.string(),
});

const router = createRouter().plugin(withZod());

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
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { JoinRoom, UserJoined, SendMessage, UserLeft } from "./schema";

declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    roomId?: string;
  }
}

const router = createRouter().plugin(withZod());

// Handle new connections
router.onOpen((ctx) => {
  console.log(`Client connected: ${ctx.data?.userId}`);
});

// Handle specific message types (fully typed!)
router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload; // ✅ Fully typed from schema
  const userId = ctx.data?.userId;

  // Store roomId in connection data for later use
  ctx.assignData({ roomId });

  // Subscribe to room broadcasts
  await ctx.topics.subscribe(roomId);

  console.log(`User ${userId} joined room: ${roomId}`);

  // Send confirmation (type-safe!)
  ctx.send(UserJoined, { roomId, userId: userId || "anonymous" });

  // Broadcast to other subscribers in the room
  await ctx.publish(roomId, UserJoined, {
    roomId,
    userId: userId || "anonymous",
  });
});

router.on(SendMessage, async (ctx) => {
  const { roomId, text } = ctx.payload; // ✅ Fully typed
  const userId = ctx.data?.userId;

  console.log(`[${roomId}] ${userId}: ${text}`);

  // Broadcast to room subscribers (type-safe!)
  await ctx.publish(roomId, SendMessage, {
    roomId,
    text,
    userId: userId || "anonymous",
  });
});

// Handle disconnections
router.onClose((ctx) => {
  const userId = ctx.data?.userId;
  const roomId = ctx.data?.roomId;

  if (roomId && userId) {
    // Use router.publish() in lifecycle hooks (ctx.publish available in handlers only)
    void router.publish(roomId, UserLeft, { userId });
  }
  console.log(`Disconnected: ${userId}`);
});
```

**Context Fields:**

- `ctx.data` — Connection data (type-narrowed from module augmentation)
- `ctx.payload` — Typed payload from schema (✅ fully typed!)
- `ctx.type` — Message type literal (e.g., `"JOIN_ROOM"`)
- `ctx.meta` — Client metadata (clientId, timestamp)
- `ctx.send(schema, data)` — Type-safe send to this client only
- `ctx.publish(topic, schema, data)` — Broadcast to topic subscribers (only in handlers)
- `ctx.topics.subscribe(topic)` / `ctx.topics.unsubscribe(topic)` — Topic management (async)
- `ctx.error(code, message?, details?, options?)` — Send type-safe error with optional retry hints
- `router.publish(topic, schema, data)` — Broadcast from lifecycle hooks or middleware

## Broadcasting and Subscriptions

Broadcasting messages to multiple clients is type-safe with schema validation:

```ts
import { z, message, createRouter, withZod } from "@ws-kit/zod";

const RoomUpdate = message("ROOM_UPDATE", {
  roomId: z.string(),
  users: z.number(),
  text: z.string(),
});

declare module "@ws-kit/core" {
  interface ConnectionData {
    roomId?: string;
  }
}

const router = createRouter().plugin(withZod());

router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;

  // Subscribe to room updates
  await ctx.topics.subscribe(roomId);
  ctx.assignData({ roomId });

  console.log(`User joined: ${roomId}`);

  // Broadcast to all room subscribers (type-safe!)
  await ctx.publish(roomId, RoomUpdate, {
    roomId,
    users: 5,
    text: "A user has joined",
  });
});

router.on(SendMessage, async (ctx) => {
  const { roomId, text } = ctx.payload;

  // Broadcast message to room (fully typed, no JSON.stringify needed!)
  await ctx.publish(roomId, RoomUpdate, {
    roomId,
    users: 5,
    text,
  });
});

router.onClose((ctx) => {
  const roomId = ctx.data?.roomId;
  if (roomId) {
    // Use router.publish() in lifecycle hooks
    void router.publish(roomId, RoomUpdate, {
      roomId,
      users: 4,
      text: "A user has left",
    });
  }
});
```

**Broadcasting API:**

- `ctx.publish(topic, schema, payload, options?)` — Broadcast to topic subscribers (only in message handlers)
- `router.publish(topic, schema, payload, options?)` — Broadcast from lifecycle hooks or middleware; returns `Promise<PublishResult>` with delivery info
- `await ctx.topics.subscribe(topic)` — Subscribe connection to a topic (async, adapter-dependent)
- `await ctx.topics.unsubscribe(topic)` — Unsubscribe from a topic (async)

Optional `options` parameter for `publish()`:

```ts
{
  excludeSelf?: boolean;   // Throws error if true (not yet implemented)
  partitionKey?: string;   // Route to specific partition (optional, for sharded pubsub)
  meta?: Record<string, unknown>; // Additional metadata (e.g., { senderId: "user:123" })
}
```

For more detailed examples including multi-instance deployments with Redis, see the [examples/](./examples) directory and [docs/specs/pubsub.md](./docs/specs/pubsub.md).

## Error handling and sending error messages

Effective error handling is crucial for maintaining robust WebSocket connections. WS-Kit provides built-in error response support with standardized error codes and automatic retry inference for clients.

### Error handling with ctx.error()

Use `ctx.error()` to send type-safe error responses with optional retry hints:

```ts
import { z, message, createRouter, withZod } from "@ws-kit/zod";

interface ConnectionData {
  userId?: string;
}

const router = createRouter<ConnectionData>().plugin(withZod());

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
  await ctx.topics.subscribe(roomId);
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
    console.log(`Client ${ctx.data?.clientId} connected`);
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

Protect your WebSocket server from abuse with atomic, distributed rate limiting. WS-Kit provides a middleware-based rate limiting system that works across single-instance and multi-pod deployments.

### Quick Start (Single-Instance)

For development or single-instance deployments, use the in-memory adapter:

```ts
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/memory";

const router = createRouter();

// Apply rate limiting to all messages
router.use(
  rateLimit({
    limiter: memoryRateLimiter({
      capacity: 200, // Max 200 tokens per bucket
      tokensPerSecond: 100, // Refill at 100 tokens/second
    }),
    key: keyPerUserPerType, // Per-user per-message-type buckets (recommended)
  }),
);

router.on(SendMessage, async (ctx) => {
  // Rate limit is checked automatically before handler runs
  await ctx.publish(roomId, SendMessage, ctx.payload);
});

serve(router, { port: 3000 });
```

### Multi-Pod Deployments (Redis)

For distributed deployments, coordinate via Redis:

```ts
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { redisRateLimiter } from "@ws-kit/redis";
import { createClient } from "redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

router.use(
  rateLimit({
    limiter: redisRateLimiter(redisClient, {
      capacity: 200,
      tokensPerSecond: 100,
    }),
    key: keyPerUserPerType,
  }),
);
```

### Key Functions

Three built-in key functions provide different isolation strategies:

- **`keyPerUserPerType`** (recommended) — One bucket per (user, message type). Prevents one operation from starving others.
- **`keyPerUser`** — Per-user bucket. Use `cost()` to weight operations within a shared budget.

Create custom key functions:

```ts
router.use(
  rateLimit({
    limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 }),
    key: (ctx) => `${ctx.data?.userId}:${ctx.type}`, // Custom keying
    cost: (ctx) => (ctx.type === "ExpensiveOp" ? 10 : 1),
  }),
);
```

For complete documentation, see [docs/specs/router.md](./docs/specs/router.md) and examples in the [`@ws-kit/middleware`](./packages/middleware) package.

## Multi-Instance Deployments

For distributed deployments across multiple server instances, use Redis or Cloudflare to coordinate subscriptions and broadcasting:

```ts
import { createRouter, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { redisPubSub } from "@ws-kit/redis";
import { serve } from "@ws-kit/bun";
import { createClient } from "redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub({ adapter: redisPubSub(redisClient) }));

// Now ctx.publish() and ctx.topics.subscribe() work across all instances
router.on(JoinRoom, async (ctx) => {
  await ctx.topics.subscribe(ctx.payload.roomId);
  await ctx.publish(ctx.payload.roomId, UserJoined, {
    userId: ctx.data?.userId,
  });
});

serve(router, { port: 3000 });
```

Without Redis pubsub, broadcasting is scoped to the current instance. Redis enables cross-instance pub/sub for chat rooms, notifications, and real-time dashboards.

For Cloudflare Durable Objects, use the native `createDurableObjectHandler`:

```ts
import { createRouter, withZod } from "@ws-kit/zod";
import { createDurableObjectHandler } from "@ws-kit/cloudflare";

const router = createRouter().plugin(withZod());
const handler = createDurableObjectHandler(router, {
  /* options */
});

export default {
  fetch(req: Request) {
    return handler.fetch(req);
  },
};
```

## How to compose routes

Organize code by splitting handlers into feature modules, then merge them into a main router using the `merge()` method:

```ts
// types/connection-data.d.ts (project root - define once, share everywhere)
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
  }
}
```

Create feature routers in separate modules:

```ts
// src/features/chat.ts
import { createRouter, withZod } from "@ws-kit/zod";
import { JoinRoom, SendMessage, UserJoined } from "./schema";

export function createChatRouter() {
  const router = createRouter().plugin(withZod());

  router.on(JoinRoom, async (ctx) => {
    const { roomId } = ctx.payload;
    const userId = ctx.data?.userId;

    await ctx.topics.subscribe(roomId);
    ctx.assignData({ roomId });

    ctx.send(UserJoined, { roomId, userId });
    await ctx.publish(roomId, UserJoined, { roomId, userId });
  });

  router.on(SendMessage, async (ctx) => {
    // Handle message
  });

  return router;
}
```

Compose in your main application:

```ts
// src/server.ts
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { createChatRouter } from "./features/chat";
import { createPresenceRouter } from "./features/presence";

const mainRouter = createRouter()
  .merge(createChatRouter())
  .merge(createPresenceRouter());

serve(mainRouter, { port: 3000 });
```

The `merge()` method combines handlers, lifecycle hooks, and middleware from composed routers. With module augmentation, all routers automatically share the same `ConnectionData` type.

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
