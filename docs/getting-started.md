# Getting Started

This guide shows you how to build type-safe WebSocket applications with ws-kit. You'll learn how to set up both the server and client using shared message schemas for full-stack type safety.

## Installation

### Server

```bash
# With Zod (recommended)
bun add zod @ws-kit/zod @ws-kit/bun

# With Valibot (lighter bundles)
bun add valibot @ws-kit/valibot @ws-kit/bun
```

::: tip
The router includes a built-in in-memory pub/sub adapter by default. For production multi-instance deployments, add `@ws-kit/redis-pubsub` or configure a Cloudflare Durable Objects adapter. See [Deployment](/deployment) for details.
:::

### Client (Browser)

```bash
# With Zod
bun add zod @ws-kit/client

# With Valibot (recommended for browsers due to smaller bundle)
bun add valibot @ws-kit/client
```

::: tip
Valibot is recommended for browser clients due to its smaller bundle size (~1-2 KB). Zod is great for servers or apps already using Zod.
:::

## Quick Start

### 1. Define Shared Message Schemas

Create message types once and share them between server and client:

```typescript
// shared/schemas.ts (imported by both server and client)
import { z, message } from "@ws-kit/zod";

export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
});

export const ChatMessage = message("CHAT_MESSAGE", {
  text: z.string(),
  roomId: z.string(),
});

export const UserJoined = message("USER_JOINED", {
  username: z.string(),
  roomId: z.string(),
});

export const UserLeft = message("USER_LEFT", {
  userId: z.string(),
});
```

Simple and straightforward—no factories, just plain functions.

### 2. Set Up Server

```typescript
// server.ts
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { JoinRoom, ChatMessage, UserJoined, UserLeft } from "./shared/schemas";

type AppData = {
  userId?: string;
  roomId?: string;
};

const router = createRouter<AppData>();

router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;

  // Subscribe to room and store in connection data
  ctx.assignData({ roomId });
  await ctx.topics.subscribe(roomId);
});

router.on(ChatMessage, async (ctx) => {
  const { text, roomId } = ctx.payload;
  const userId = ctx.ws.data.userId || "anonymous";

  // Broadcast to room subscribers
  await ctx.publish(roomId, ChatMessage, {
    text,
    roomId,
  });
});

// Serve with type-safe handlers
serve(router, {
  port: 3000,
  authenticate(req) {
    // Validate token or session and return user data
    const token = req.headers.get("authorization");
    return token ? { userId: "user_123" } : undefined;
  },
  onOpen(ctx) {
    console.log(`Client ${ctx.ws.data.userId} connected`);
  },
  async onClose(ctx) {
    const { roomId, userId } = ctx.ws.data;
    console.log(`Client ${userId} disconnected from ${roomId}`);

    if (roomId) {
      await ctx.publish(roomId, UserLeft, { userId: userId || "unknown" });
    }
  },
  // Optional: handle connection errors
  onError(ctx, err) {
    console.error(`Connection error for ${ctx.ws.data.userId}:`, err.message);
  },
});

console.log("WebSocket server running on ws://localhost:3000");
```

### 3. Set Up Client

```typescript
// client.ts
import { wsClient } from "@ws-kit/client/zod";
import { JoinRoom, ChatMessage, UserJoined, UserLeft } from "./shared/schemas";

// Create type-safe client with auto-reconnect and message queueing
const client = wsClient({
  url: "ws://localhost:3000",
  auth: {
    getToken: () => localStorage.getItem("access_token"),
  },
  // Auto-reconnect with exponential backoff (optional)
  reconnect: {
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30_000,
  },
  // Queue messages while offline (optional)
  queue: {
    mode: "drop-oldest", // or "drop-newest", "off"
    maxSize: 100,
  },
});

// Connect and listen for messages
await client.connect();

// Join a room
client.send(JoinRoom, {
  roomId: "general",
});

// Listen for room updates
client.on(ChatMessage, (msg) => {
  console.log(`${msg.payload.roomId}: ${msg.payload.text}`);
});

client.on(UserJoined, (msg) => {
  console.log(`${msg.payload.username} joined ${msg.payload.roomId}`);
});

// Send message
client.send(ChatMessage, {
  text: "Hello, world!",
  roomId: "general",
});

// Graceful disconnect
await client.close();
```

::: tip Full Type Safety
Notice how both server and client have complete TypeScript inference from the shared schemas. No manual type annotations needed!
:::

::: tip Server Lifecycle Hooks
The `serve()` function supports additional lifecycle hooks beyond `onOpen`, `onClose`, and `onError`:

- `onUpgrade(req)` — Customize HTTP upgrade response before WebSocket handshake
- `onBroadcast(ctx, topic, data)` — Observe or intercept broadcast events

See the [API Reference](./api-reference) for details.
:::

## Basic Concepts

### Message Structure

All messages follow a consistent structure:

```typescript
{
  type: string,          // Message type for routing
  meta?: {               // Optional metadata
    timestamp?: number,  // Producer timestamp (client clock)
    correlationId?: string, // Optional request tracking
  },
  payload?: any          // Your validated data
}
```

::: warning Server Timestamp
**Server logic must use `ctx.receivedAt`** (authoritative server time), not `meta.timestamp` (client clock, untrusted). The `ctx.receivedAt` field is added by the router at message ingress and reflects the server's clock.
:::

### Message Schemas

Schemas support flexible patterns:

```typescript
// Message without payload
const PingMessage = message("PING");

// Message with validated payload
const JoinRoomMessage = message("JOIN_ROOM", {
  roomId: z.string().uuid(),
  username: z.string().min(1).max(20),
});

// With optional fields
const MessageWithOptional = message("MSG", {
  text: z.string(),
  mentions: z.array(z.string()).optional(),
});
```

### Client Features

The browser client provides:

- **Auto-reconnection** with exponential backoff
- **Offline message queueing** when disconnected
- **Request/response pattern (RPC)** with timeouts and correlation tracking
- **Progress updates** for long-running operations
- **Built-in authentication** via token or headers
- **Full type inference** from shared schemas

#### Request/Response Pattern (RPC)

Define RPC schemas using either the modern `message()` syntax or legacy `rpc()` helper:

```typescript
import { z, message, rpc } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";
import { createRouter } from "@ws-kit/zod";

// Modern syntax (recommended)
const QueryUsers = message("QUERY_USERS", {
  payload: { query: z.string() },
  response: { users: z.array(UserSchema) },
});

// Legacy syntax (still supported)
const Ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });

// Server setup
const router = createRouter();

router.rpc(QueryUsers, async (ctx) => {
  const users = await db.query(ctx.payload.query);
  ctx.reply(QueryUsers.response, { users });
});

router.rpc(Ping, (ctx) => {
  ctx.reply(Ping.response, { reply: `Got: ${ctx.payload.text}` });
});

// Client setup
const client = wsClient({ url: "ws://localhost:3000" });
await client.connect();

// Make RPC request with timeout
try {
  const response = await client.request(
    QueryUsers,
    { query: "active" },
    { timeoutMs: 5000 },
  );
  console.log("Users:", response.payload.users);
} catch (err) {
  console.error("Request failed or timed out:", err);
}
```

#### Progress Updates for Long-Running Operations

For operations that take time (uploads, processing, etc.), send progress updates without terminating the RPC:

```typescript
// Server: send multiple progress updates before final reply
router.rpc(ProcessFile, async (ctx) => {
  const { fileId } = ctx.payload;

  ctx.progress({ status: "validating", percent: 10 });
  await validateFile(fileId);

  ctx.progress({ status: "processing", percent: 50 });
  const result = await processFile(fileId);

  ctx.progress({ status: "storing", percent: 90 });
  await storeResult(fileId, result);

  // Terminal response ends the RPC
  ctx.reply(ProcessFile.response, { success: true, resultId: result.id });
});

// Client: listen to progress updates
const call = client.request(ProcessFile, { fileId: "file_123" });

// Listen to progress events
call.progress.on("message", (msg) => {
  console.log(`${msg.payload.status}: ${msg.payload.percent}%`);
});

// Wait for final reply
const response = await call;
console.log("Done:", response.payload.resultId);
```

#### Request Cancellation

Cancel in-flight RPC requests using AbortSignal:

```typescript
const controller = new AbortController();

const requestPromise = client.request(
  QueryUsers,
  { query: "active" },
  {
    timeoutMs: 30_000,
    signal: controller.signal,
  },
);

// Cancel after 5 seconds if still pending
setTimeout(() => controller.abort(), 5000);

try {
  const response = await requestPromise;
} catch (err) {
  if (err.name === "AbortError") {
    console.log("Request was cancelled");
  }
}
```

## Next Steps

Now that you understand the basics:

- **[Core Concepts](./core-concepts)** — Message routing, lifecycle hooks, error handling
- **[Client Setup](./client-setup)** — Complete client API and advanced features
- **[Message Schemas](./message-schemas)** — Schema patterns and validation
- **[API Reference](./api-reference)** — Complete API documentation
- **[Advanced Usage](./advanced-usage)** — Middleware, composition, patterns
- **[Deployment](./deployment)** — Production patterns and scaling
