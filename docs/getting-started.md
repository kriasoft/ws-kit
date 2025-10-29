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
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { ChatMessage, UserJoined, UserLeft } from "./shared/schemas";

type AppData = {
  userId?: string;
  roomId?: string;
};

const router = createRouter<AppData>();

router.onOpen((ctx) => {
  console.log(`Client ${ctx.ws.data?.userId} connected`);
});

router.on(ChatMessage, (ctx) => {
  const { text, roomId } = ctx.payload;
  console.log(`Message in ${roomId}: ${text}`);

  // Subscribe to room
  ctx.assignData({ roomId });
  ctx.subscribe(roomId);

  // Broadcast to room
  router.publish(roomId, ChatMessage, {
    text,
    roomId,
  });
});

router.onClose((ctx) => {
  const { roomId, userId } = ctx.ws.data || {};
  console.log(`Client ${userId} disconnected from ${roomId}`);

  if (roomId) {
    ctx.unsubscribe(roomId);
    router.publish(roomId, UserLeft, { userId: userId || "unknown" });
  }
});

// Serve with type-safe handlers
serve(router, {
  port: 3000,
  authenticate(req) {
    // Validate token or session and return user data
    const token = req.headers.get("authorization");
    return token ? { userId: "user_123" } : undefined;
  },
});

console.log("WebSocket server running on ws://localhost:3000");
```

### 3. Set Up Client

```typescript
// client.ts
import { message, wsClient } from "@ws-kit/client/zod";
import { ChatMessage, UserJoined, UserLeft } from "./shared/schemas";

// Create type-safe client
const client = wsClient({
  url: "ws://localhost:3000",
  auth: {
    getToken: () => localStorage.getItem("access_token"),
  },
});

// Connect and listen for messages
await client.connect();

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

// Request/response pattern
const reply = await client.request(
  ChatMessage,
  { text: "Are you there?", roomId: "general" },
  ChatMessage,
  { timeoutMs: 5000 },
);

console.log("Got reply:", reply.payload.text);

// Graceful disconnect
await client.disconnect();
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
**Server logic must use `ctx.receivedAt`** (authoritative server time), not `meta.timestamp` (client clock, untrusted).
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
- **Request/response pattern** with timeouts
- **Built-in authentication** via token or headers
- **Full type inference** from shared schemas

```typescript
// Request/response example
try {
  const response = await client.request(
    PingMessage,
    { text: "ping" },
    PongMessage,
    { timeoutMs: 5000 },
  );
  console.log("Got response:", response.payload);
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
