# Getting Started

Welcome to Bun WebSocket Router! This guide will help you get started with building type-safe WebSocket applications in Bun.

## Installation

Choose your preferred validation library:

::: code-group

```bash [Zod (default)]
bun add bun-ws-router zod
```

```bash [Valibot (90% smaller)]
bun add bun-ws-router valibot
```

:::

## Quick Start

Here's a minimal example to get you started:

```typescript
import { WebSocketRouter, messageSchema } from "bun-ws-router";
import { z } from "zod";

// Define a message schema
const ChatMessage = messageSchema(
  "CHAT_MESSAGE",
  z.object({
    text: z.string(),
    roomId: z.string(),
  }),
);

// Create router and define handlers
const router = new WebSocketRouter()
  .onOpen((ws) => {
    console.log(`Client ${ws.data.clientId} connected`);
  })
  .onMessage(ChatMessage, (ctx) => {
    // TypeScript knows ctx.payload has { text: string, roomId: string }
    console.log(`Message from ${ctx.clientId}: ${ctx.payload.text}`);

    // Broadcast to room
    ctx.publish(`room:${ctx.payload.roomId}`, ChatMessage, {
      text: ctx.payload.text,
      roomId: ctx.payload.roomId,
    });
  })
  .onClose((ws) => {
    console.log(`Client ${ws.data.clientId} disconnected`);
  });

// Create Bun server
Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (server.upgrade(req)) {
      return; // WebSocket upgrade successful
    }
    return new Response("Please use a WebSocket client");
  },
  websocket: router.handlers(),
});

console.log("WebSocket server running on ws://localhost:3000");
```

## Basic Concepts

### Message Structure

All messages follow a consistent structure:

```typescript
{
  type: string,        // Message type for routing
  meta: {              // Metadata (auto-populated)
    clientId: string,  // Unique client identifier
    timestamp: number, // Unix timestamp
  },
  payload?: any        // Your data (validated by schema)
}
```

### Creating Message Schemas

Use `messageSchema` to define type-safe messages:

```typescript
import { messageSchema } from "bun-ws-router";
import { z } from "zod";

// Simple message without payload
const PingMessage = messageSchema("PING");

// Message with validated payload
const JoinRoomMessage = messageSchema(
  "JOIN_ROOM",
  z.object({
    roomId: z.string().uuid(),
    username: z.string().min(1).max(20),
  }),
);
```

### Handling Messages

Register handlers for your message types:

```typescript
router
  .onMessage(PingMessage, (ctx) => {
    // Respond with PONG
    ctx.send({ type: "PONG" });
  })
  .onMessage(JoinRoomMessage, (ctx) => {
    // Join the room
    ctx.subscribe(`room:${ctx.payload.roomId}`);

    // Notify others in the room
    ctx.publish(`room:${ctx.payload.roomId}`, {
      type: "USER_JOINED",
      payload: { username: ctx.payload.username },
    });
  });
```

## Integration with HTTP Frameworks

### Using with Hono

```typescript
import { Hono } from "hono";
import { WebSocketRouter } from "bun-ws-router";

const app = new Hono();
const router = new WebSocketRouter();

// Regular HTTP routes
app.get("/", (c) => c.text("WebSocket server"));

// WebSocket endpoint
app.get("/ws", (c) => {
  const success = c.env.server.upgrade(c.req.raw, {
    data: {
      clientId: crypto.randomUUID(),
      // Add any auth data here
    },
  });

  if (success) return; // WebSocket upgrade successful
  return c.text("WebSocket upgrade failed", 426);
});

// Start server
Bun.serve({
  port: 3000,
  fetch: app.fetch,
  websocket: router.handlers(),
});
```

## Next Steps

- Learn about [Core Concepts](/core-concepts) like connection lifecycle and error handling
- Explore [Message Schemas](/message-schemas) for advanced validation
- Check out [Examples](/examples) for real-world patterns
- Switch to [Valibot](/valibot-integration) for smaller bundle sizes
