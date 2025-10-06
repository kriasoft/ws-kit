# Getting Started

This guide will help you build type-safe WebSocket applications with Bun.

## Installation

Choose your preferred validation library:

::: code-group

```bash [Zod]
bun add bun-ws-router zod
```

```bash [Valibot (90% smaller)]
bun add bun-ws-router valibot
```

:::

## Quick Start

Here's a minimal example to get you started:

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { publish } from "bun-ws-router/zod/publish";

// Create message schema factory
const { messageSchema } = createMessageSchema(z);

// Define a message schema
const ChatMessage = messageSchema("CHAT_MESSAGE", {
  text: z.string(),
  roomId: z.string(),
});

// Create router and define handlers
const router = new WebSocketRouter()
  .onOpen((ctx) => {
    console.log(`Client ${ctx.ws.data.clientId} connected`);
  })
  .onMessage(ChatMessage, (ctx) => {
    // TypeScript knows ctx.payload has { text: string, roomId: string }
    console.log(`Message from ${ctx.ws.data.clientId}: ${ctx.payload.text}`);

    // Subscribe to room for receiving broadcasts
    ctx.ws.subscribe(`room:${ctx.payload.roomId}`);

    // Broadcast to room with type-safe publish helper
    publish(ctx.ws, `room:${ctx.payload.roomId}`, ChatMessage, {
      text: ctx.payload.text,
      roomId: ctx.payload.roomId,
    });
  })
  .onClose((ctx) => {
    console.log(`Client ${ctx.ws.data.clientId} disconnected`);
  });

// Create Bun server
Bun.serve({
  port: 3000,
  fetch(req, server) {
    // Handle WebSocket upgrade - returns Response (101 or 500)
    // The router automatically generates a UUID v7 clientId
    return router.upgrade(req, { server });
  },
  websocket: router.websocket,
});

console.log("WebSocket server running on ws://localhost:3000");
```

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

### Creating Message Schemas

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

// Create factory with your Zod instance
const { messageSchema } = createMessageSchema(z);

// Simple message without payload
const PingMessage = messageSchema("PING");

// Message with validated payload
const JoinRoomMessage = messageSchema("JOIN_ROOM", {
  roomId: z.uuid(),
  username: z.string().min(1).max(20),
});
```

### Handling Messages

Register handlers for your message types:

```typescript
import { publish } from "bun-ws-router/zod/publish";

const PongMessage = messageSchema("PONG");
const UserJoinedMessage = messageSchema("USER_JOINED", {
  username: z.string(),
});

router
  .onMessage(PingMessage, (ctx) => {
    // Respond with PONG (no payload for this message type)
    ctx.send(PongMessage);
  })
  .onMessage(JoinRoomMessage, (ctx) => {
    // Subscribe to room
    ctx.ws.subscribe(`room:${ctx.payload.roomId}`);

    // Notify others in the room with type-safe publish
    publish(ctx.ws, `room:${ctx.payload.roomId}`, UserJoinedMessage, {
      username: ctx.payload.username,
    });
  });
```

### Message Validation Pipeline

When a message arrives, the router processes it through a security pipeline. See [Core Concepts](./core-concepts#message-handling) for details.

## Integration with HTTP Frameworks

### Using with Hono

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);

const app = new Hono();
const router = new WebSocketRouter();

// Regular HTTP routes
app.get("/", (c) => c.text("WebSocket server"));

// WebSocket endpoint
app.get("/ws", (c) => {
  // router.upgrade() auto-generates clientId (UUID v7) and returns Response
  return router.upgrade(c.req.raw, {
    server: c.env?.server,
    // Add any custom auth data here (clientId is auto-generated)
    data: {
      // userId: getUserId(c),
    },
  });
});

// Start server
Bun.serve({
  port: 3000,
  fetch: app.fetch,
  websocket: router.websocket,
});
```
