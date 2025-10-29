# WS-Kit — Type-Safe WebSocket Router

[![npm version](https://img.shields.io/npm/v/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![npm downloads](https://img.shields.io/npm/dm/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![GitHub Actions](https://github.com/kriasoft/bun-ws-router/actions/workflows/main.yml/badge.svg)](https://github.com/kriasoft/bun-ws-router/actions)
[![Chat on Discord](https://img.shields.io/discord/643523529131950086?label=Discord)](https://discord.gg/aW29wXyb7w)

Type-safe WebSocket router for Bun and Cloudflare with **Zod** or **Valibot** validation. Routes messages to handlers with full TypeScript support on both server and client.

## ⚠️ Environment Requirements

**ws-kit is ESM-only** and optimized for modern runtimes:

- **Bun** (recommended) — native ESM and WebSocket support
- **Cloudflare Workers/Durable Objects** — native ESM support
- **Node.js** (with bundler) — requires Node 18+ and a bundler like Vite, esbuild, or Rollup
- **Browser** — works with modern bundlers

**Not compatible** with CommonJS-only projects or legacy runtimes.

## Monorepo Structure

ws-kit is organized as a modular monorepo with independent packages:

- **`@ws-kit/core`** — Platform-agnostic router and type system (foundation)
- **`@ws-kit/zod`** — Zod validator adapter with `createRouter()` helper
- **`@ws-kit/valibot`** — Valibot validator adapter with `createRouter()` helper
- **`@ws-kit/bun`** — Bun platform adapter with `serve()` high-level and `createBunHandler()` low-level
- **`@ws-kit/cloudflare-do`** — Cloudflare Durable Objects adapter
- **`@ws-kit/client`** — Universal browser/Node.js client
- **`@ws-kit/redis-pubsub`** — Optional Redis PubSub for multi-server scaling

Combine any validator adapter with platform-specific packages. Each platform package (e.g., `@ws-kit/bun`) exports both high-level convenience (`serve()`) and low-level APIs (`createBunHandler()`).

### Key Features

**Server (Bun)**

- 🔒 Type-safe message routing with Zod/Valibot validation
- 🚀 Built on Bun's native WebSocket implementation
- 📡 PubSub with schema-validated broadcasts
- 🧩 Composable routers and middleware support

**Client (Browser)**

- 🔄 Auto-reconnection with exponential backoff
- 📦 Configurable offline message queueing
- ⏱️ Request/response pattern with timeouts
- 🔐 Built-in auth (query param or protocol header)

**Shared**

- ✨ Shared schemas between server and client
- ⚡ Choose Zod (familiar) or Valibot (60-80% smaller)
- 🔒 Full TypeScript inference on both sides

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

The **export-with-helpers pattern** is the first-class way to use ws-kit—no factories, no dual imports:

```ts
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define message schemas with full type inference
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

// Create type-safe router with optional connection data
type AppData = { userId?: string };
const router = createRouter<AppData>();

// Register handlers—fully typed!
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

For applications with multiple routers, reduce repetition by declaring your connection data type once using TypeScript **declaration merging**. Then omit the generic everywhere—it's automatic:

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

Now all routers automatically use this type—no repetition:

```ts
// ✅ No generic needed—automatically uses AppDataDefault
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

Choose between Zod and Valibot—same API, different trade-offs:

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

Use platform-specific imports for production deployments—they provide correct options, type safety, and clear errors:

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

export default {
  fetch(req: Request) {
    return serve(router, {
      authenticate(req) {
        /* ... */
      },
    }).fetch(req);
  },
};
```

### Authentication

Secure your router by validating clients during the WebSocket upgrade. Pass authenticated user data via the `authenticate` hook—all handlers then have type-safe access to this data:

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
    ctx.error("AUTH_ERROR", "Not authenticated");
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
    console.error(`ws-kit error in ${ctx?.type}:`, error);
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

## Message Schemas (No Factories!)

Use the `message()` helper directly—no factory pattern needed:

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

### Request-Response Pairs with `rpc()`

For request-response patterns, use `rpc()` to bind request and response schemas together—no schema repetition at call sites:

```ts
import { z, rpc } from "@ws-kit/zod";

// Define RPC schema - binds request to response type
const Ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });

// With Valibot
import { v, rpc } from "@ws-kit/valibot";
const Query = rpc("QUERY", { id: v.string() }, "RESULT", { data: v.string() });
```

The client auto-detects the response type from the RPC schema, eliminating the need to specify it separately on every request.

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

router.on(SendMessage, (ctx) => {
  const { text } = ctx.payload;
  const userId = ctx.ws.data?.userId;
  const roomId = ctx.ws.data?.roomId;

  console.log(`[${roomId}] ${userId}: ${text}`);

  // Broadcast to room subscribers (type-safe!)
  router.publish(roomId, SendMessage, { text, userId: userId || "anonymous" });
});

// Handle disconnections
router.onClose((ctx) => {
  const userId = ctx.ws.data?.userId;
  const roomId = ctx.ws.data?.roomId;

  if (roomId) {
    ctx.unsubscribe(roomId);
    // Notify others
    router.publish(roomId, UserLeft, { userId: userId || "anonymous" });
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
- `ctx.send()` / `ctx.reply()` — Type-safe send (this client only)
- `ctx.assignData()` — Type-safe partial data updates
- `ctx.subscribe()` / `ctx.unsubscribe()` — Topic management
- `ctx.error()` — Send type-safe error messages

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

router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  // Subscribe to room updates
  ctx.subscribe(roomId);
  ctx.assignData({ roomId });

  console.log(`User joined: ${roomId}`);

  // Broadcast to all room subscribers (type-safe!)
  router.publish(roomId, RoomUpdate, {
    roomId,
    users: 5,
    message: "A user has joined",
  });
});

router.on(SendMessage, (ctx) => {
  const roomId = ctx.ws.data?.roomId;

  // Broadcast message to room (fully typed, no JSON.stringify needed!)
  router.publish(roomId, RoomUpdate, {
    roomId,
    users: 5,
    message: ctx.payload.text,
  });
});

router.onClose((ctx) => {
  const roomId = ctx.ws.data?.roomId;
  if (roomId) {
    ctx.unsubscribe(roomId);
    router.publish(roomId, RoomUpdate, {
      roomId,
      users: 4,
      message: "A user has left",
    });
  }
});
```

**Broadcasting API:**

- `router.publish(scope, schema, payload)` — Type-safe broadcast to all subscribers on a scope
- `ctx.subscribe(topic)` — Subscribe connection to a topic (adapter-dependent)

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
  const userId = ctx.ws.data?.userId || ctx.ws.data?.clientId;

  // Store room ID and subscribe to topic
  ctx.assignData({ roomId });
  ctx.ws.subscribe(roomId);

  // Send confirmation back
  ctx.send(UserJoined, { roomId, userId });

  // Broadcast to room subscribers with schema validation
  router.publish(roomId, UserJoined, { roomId, userId });
});

router.on(SendMessage, (ctx) => {
  const { roomId, message: msg } = ctx.payload;
  const userId = ctx.ws.data?.userId || ctx.ws.data?.clientId;

  console.log(`Message in room ${roomId} from ${userId}: ${msg}`);

  // Broadcast the message to all room subscribers
  router.publish(roomId, NewMessage, { roomId, userId, message: msg });
});

router.onClose((ctx) => {
  const userId = ctx.ws.data?.userId || ctx.ws.data?.clientId;
  const roomId = ctx.ws.data?.roomId;

  if (roomId) {
    ctx.ws.unsubscribe(roomId);
    // Notify others in the room
    router.publish(roomId, UserLeft, { userId });
  }
});
```

The `publish()` function ensures that all broadcast messages are validated against their schemas before being sent, providing the same type safety for broadcasts that you get with direct messaging.

## Error handling and sending error messages

Effective error handling is crucial for maintaining robust WebSocket connections. WS-Kit provides built-in error response support with standardized error codes.

### Error handling with ctx.error()

Use `ctx.error()` to send type-safe error responses:

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
    // Send error with standardized code
    ctx.error("NOT_FOUND", `Room ${roomId} does not exist`, { roomId });
    return;
  }

  // Continue with normal flow
  ctx.assignData({ roomId });
  ctx.ws.subscribe(roomId);
});
```

### Standard error codes

The standard error codes are:

- `VALIDATION_ERROR` — Invalid payload or schema mismatch
- `AUTH_ERROR` — Authentication failed
- `INTERNAL_ERROR` — Server error
- `NOT_FOUND` — Resource not found
- `RATE_LIMIT` — Rate limit exceeded

### Custom error handling

You can add error handling middleware or lifecycle hooks:

```ts
// Error handling in connection setup
router.onOpen((ctx) => {
  try {
    console.log(`Client ${ctx.ws.data?.clientId} connected`);
  } catch (error) {
    console.error("Error in connection setup:", error);
    ctx.error("INTERNAL_ERROR", "Failed to set up connection");
  }
});

// Error handling with middleware
router.use((ctx, next) => {
  try {
    return next();
  } catch (error) {
    ctx.error("INTERNAL_ERROR", "Request failed");
  }
});

// Error handling in message handlers
const AuthenticateUser = message("AUTH", { token: z.string() });
router.on(AuthenticateUser, (ctx) => {
  try {
    const { token } = ctx.payload;
    const user = validateToken(token);

    if (!user) {
      ctx.error("AUTH_ERROR", "Invalid authentication token");
      return;
    }

    // Use assignData for type-safe connection data updates
    ctx.assignData({ userId: user.id, userRole: user.role });
  } catch (error) {
    ctx.error("INTERNAL_ERROR", "Authentication process failed");
  }
});
```

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

Type-safe browser WebSocket client with automatic reconnection, authentication, and request/response patterns—using the same validator and message definitions:

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

// Request/response with auto-detected response schema
try {
  const reply = await client.request(
    Hello,
    { name: "Bob" },
    {
      timeoutMs: 5000,
    },
  );
  // ✅ reply.payload.text is fully typed
  console.log("Server replied:", reply.payload.text);
} catch (err) {
  console.error("Request failed:", err);
}

// Graceful disconnect
await client.disconnect();
```

You can also use explicit response schemas for backward compatibility:

```ts
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

## Design & Architecture

See [Architectural Decision Records](./docs/adr/) for the core design decisions that shaped ws-kit, including type safety patterns, platform adapters, and composability.

## Support

Questions or issues? Join us on [Discord](https://discord.gg/aW29wXyb7w).

## Backers

<a href="https://reactstarter.com/b/1"><img src="https://reactstarter.com/b/1.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/2"><img src="https://reactstarter.com/b/2.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/3"><img src="https://reactstarter.com/b/3.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/4"><img src="https://reactstarter.com/b/4.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/5"><img src="https://reactstarter.com/b/5.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/6"><img src="https://reactstarter.com/b/6.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/7"><img src="https://reactstarter.com/b/7.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/8"><img src="https://reactstarter.com/b/8.png" height="60" /></a>

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
