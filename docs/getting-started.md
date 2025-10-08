# Getting Started

This guide shows you how to build type-safe WebSocket applications with Bun WebSocket Router. You'll learn how to set up both the server (Bun) and client (browser) using shared message schemas for full-stack type safety.

## Installation

### Server (Bun)

```bash
bun add bun-ws-router zod
# or
bun add bun-ws-router valibot  # 60-80% smaller bundles
```

### Client (Browser)

```bash
npm install bun-ws-router zod
# or
npm install bun-ws-router valibot  # Recommended for browsers
```

::: tip
Valibot is recommended for browser clients due to its smaller bundle size (~2-3 KB). Zod is great for servers or apps already using Zod.
:::

## Quick Start

### 1. Define Shared Schemas

Create schemas once and share them between server and client:

```typescript
// shared/schemas.ts (imported by both server and client)
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);

export const ChatMessage = messageSchema("CHAT_MESSAGE", {
  text: z.string(),
  roomId: z.string(),
});

export const UserJoined = messageSchema("USER_JOINED", {
  username: z.string(),
  roomId: z.string(),
});
```

### 2. Set Up Server

```typescript
// server.ts
import { WebSocketRouter } from "bun-ws-router/zod";
import { publish } from "bun-ws-router/zod/publish";
import { ChatMessage, UserJoined } from "./shared/schemas";

const router = new WebSocketRouter()
  .onOpen((ctx) => {
    console.log(`Client ${ctx.ws.data.clientId} connected`);
  })
  .onMessage(ChatMessage, (ctx) => {
    console.log(`Message from ${ctx.ws.data.clientId}: ${ctx.payload.text}`);

    // Subscribe to room
    ctx.ws.subscribe(`room:${ctx.payload.roomId}`);

    // Broadcast to room
    publish(ctx.ws, `room:${ctx.payload.roomId}`, ChatMessage, ctx.payload);
  })
  .onClose((ctx) => {
    console.log(`Client ${ctx.ws.data.clientId} disconnected`);
  });

Bun.serve({
  port: 3000,
  fetch(req, server) {
    return router.upgrade(req, { server });
  },
  websocket: router.websocket,
});

console.log("WebSocket server running on ws://localhost:3000");
```

### 3. Set Up Client

```typescript
// client.ts
import { createClient } from "bun-ws-router/zod/client";
import { ChatMessage, UserJoined } from "./shared/schemas";

const client = createClient({
  url: "ws://localhost:3000",
  reconnect: { enabled: true },
});

// Register handlers before connecting
client.on(ChatMessage, (msg) => {
  console.log(`Received: ${msg.payload.text}`);
});

client.on(UserJoined, (msg) => {
  console.log(`${msg.payload.username} joined ${msg.payload.roomId}`);
});

// Connect and send
await client.connect();
client.send(ChatMessage, {
  text: "Hello, world!",
  roomId: "general",
});
```

::: tip Full Type Safety
Notice how both server and client have complete TypeScript inference from the shared schemas. No manual type annotations needed!
:::

## Basic Concepts

### Message Structure

All messages follow a consistent structure:

```typescript
{
  type: string,         // Message type for routing
  meta: {               // Metadata (optional)
    timestamp?: number, // Producer time (client clock, UI display only)
    correlationId?: string, // Optional request tracking
  },
  payload?: any         // Your data (validated by schema)
}
```

::: tip Server Timestamp Usage
**Server logic must use `ctx.receivedAt`** (authoritative server time), not `meta.timestamp` (client clock, untrusted). See [Core Concepts - Timestamp Handling](./core-concepts#timestamp-handling) for guidance.
:::

### Schema Patterns

Message schemas support different patterns:

```typescript
// Simple message without payload
const PingMessage = messageSchema("PING");

// Message with validated payload
const JoinRoomMessage = messageSchema("JOIN_ROOM", {
  roomId: z.uuid(),
  username: z.string().min(1).max(20),
});

// Message with extended metadata
const RoomMessage = messageSchema(
  "ROOM_MSG",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta fields
);
```

### Client Features

The browser client provides:

- **Auto-reconnection** with exponential backoff
- **Message queueing** when offline
- **Request/response pattern** with timeouts
- **Built-in authentication** (query param or protocol header)
- **Full type inference** from shared schemas

```typescript
// Request/response pattern (for schemas without payload)
const PingMessage = messageSchema("PING");
const PongMessage = messageSchema("PONG");

try {
  const reply = await client.request(PingMessage, PongMessage, {
    timeoutMs: 5000,
  });
  console.log("Got pong!");
} catch (err) {
  console.error("Timeout or error:", err);
}
```

See [Client Setup](./client-setup) for complete client documentation.

## Next Steps

Now that you understand the basics, explore:

- **[Core Concepts](./core-concepts)** - Message structure, routing, error handling
- **[Client Setup](./client-setup)** - Full client API and advanced features
- **[Message Schemas](./message-schemas)** - Schema patterns and validation
- **[API Reference](./api-reference)** - Complete API documentation
- **[Examples](./examples)** - Real-world usage patterns

### Framework Integration

The router works with any HTTP framework. For framework-specific examples:

- **[Advanced Usage](./advanced-usage#framework-integration)** - Hono, Express, and more
- **[Deployment](./deployment)** - Production deployment patterns
