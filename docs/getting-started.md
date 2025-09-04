# Getting Started

Welcome to Bun WebSocket Router! This guide will help you get started with building type-safe WebSocket applications in Bun.

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

// Create the message schema factory (required for proper type inference)
const { messageSchema } = createMessageSchema(z);

// Define a message schema
const ChatMessage = messageSchema("CHAT_MESSAGE", {
  text: z.string(),
  roomId: z.string(),
});

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
    // Handle WebSocket upgrade
    if (
      server.upgrade(req, {
        data: {
          clientId: crypto.randomUUID(),
        },
      })
    ) {
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

First create a message schema factory, then use it to define type-safe messages:

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
router
  .onMessage(PingMessage, (ctx) => {
    // Respond with PONG
    ctx.send({
      type: "PONG",
      meta: { clientId: ctx.clientId, timestamp: Date.now() },
    });
  })
  .onMessage(JoinRoomMessage, (ctx) => {
    // Join the room
    ctx.subscribe(`room:${ctx.payload.roomId}`);

    // Notify others in the room
    ctx.publish(`room:${ctx.payload.roomId}`, {
      type: "USER_JOINED",
      meta: { clientId: ctx.clientId, timestamp: Date.now() },
      payload: { username: ctx.payload.username },
    });
  });
```

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
  const success = c.env?.server?.upgrade(c.req.raw, {
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
