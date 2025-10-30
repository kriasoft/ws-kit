# Getting Started

This guide shows you how to build type-safe WebSocket applications with ws-kit. You'll learn how to set up both the server and client using shared message schemas for full-stack type safety.

## Installation

### Server

```bash
# With Zod (recommended)
bun add @ws-kit/zod @ws-kit/bun

# With Valibot (lighter bundles)
bun add @ws-kit/valibot @ws-kit/bun
```

### Client (Browser)

```bash
# With Zod
bun add @ws-kit/client/zod

# With Valibot (recommended for browsers due to smaller bundle)
bun add @ws-kit/client/valibot
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

router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  // Subscribe to room and store in connection data
  ctx.assignData({ roomId });
  ctx.subscribe(roomId);
});

router.on(ChatMessage, (ctx) => {
  const { text, roomId } = ctx.payload;
  const userId = ctx.ws.data.userId || "anonymous";

  // Broadcast to room subscribers
  router.publish(roomId, ChatMessage, {
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
  onClose(ctx) {
    const { roomId, userId } = ctx.ws.data;
    console.log(`Client ${userId} disconnected from ${roomId}`);

    if (roomId) {
      router.publish(roomId, UserLeft, { userId: userId || "unknown" });
    }
  },
});

console.log("WebSocket server running on ws://localhost:3000");
```

### 3. Set Up Client

```typescript
// client.ts
import { wsClient } from "@ws-kit/client/zod";
import { JoinRoom, ChatMessage, UserJoined, UserLeft } from "./shared/schemas";

// Create type-safe client
const client = wsClient({
  url: "ws://localhost:3000",
  auth: {
    getToken: () => localStorage.getItem("access_token"),
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
- **Built-in authentication** via token or headers
- **Full type inference** from shared schemas

```typescript
import { z, rpc } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";
import { createRouter } from "@ws-kit/zod";

// Define RPC schema (binds request and response)
const Ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });

// Server setup
const router = createRouter();

router.rpc(Ping, (ctx) => {
  ctx.reply(Ping.response, { reply: `Got: ${ctx.payload.text}` });
});

// Client setup
const client = wsClient({ url: "ws://localhost:3000" });
await client.connect();

// Request/response with auto-detected response schema
try {
  const response = await client.request(
    Ping,
    { text: "ping" },
    { timeoutMs: 5000 },
  );
  console.log("Got response:", response.payload.reply);
} catch (err) {
  console.error("Request failed or timed out:", err);
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
