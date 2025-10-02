# Client Setup

The Bun WebSocket Router provides a type-safe browser client that reuses the same message schemas as your server.

## Installation

```bash
npm install bun-ws-router
# or
bun add bun-ws-router
```

Choose your validator:

```bash
npm install zod
# or
npm install valibot  # Recommended for browsers (smaller bundle)
```

## Quick Start

### 1. Share Schemas Between Client and Server

Define schemas once, import everywhere:

```typescript
// shared/schemas.ts (imported by both client and server)
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);

export const Hello = messageSchema("HELLO", { name: z.string() });
export const HelloOk = messageSchema("HELLO_OK", { text: z.string() });
export const ChatMessage = messageSchema("CHAT", { text: z.string() });
```

### 2. Create the Client

```typescript
// client.ts
import { createClient } from "bun-ws-router/client";
import { Hello, HelloOk } from "./shared/schemas";

const client = createClient({
  url: "wss://api.example.com/ws",
});

// Connect to server
await client.connect();

// Send message
client.send(Hello, { name: "Anna" });

// Receive messages
client.on(HelloOk, (msg) => {
  console.log("Server says:", msg.payload.text);
});
```

### 3. Use on the Server

```typescript
// server.ts
import { WebSocketRouter } from "bun-ws-router/zod";
import { Hello, HelloOk } from "./shared/schemas";

const router = new WebSocketRouter();

router.onMessage(Hello, (ctx) => {
  ctx.send(HelloOk, { text: `Hello, ${ctx.payload.name}!` });
});

Bun.serve({
  fetch(req, server) {
    return router.upgrade(req, { server });
  },
  websocket: router.websocket,
});
```

## Import Patterns

### Client Package

```typescript
import { createClient } from "bun-ws-router/client";
```

### Validator Packages

Choose Zod or Valibot:

```typescript
// Zod (server and client)
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import type { AnyMessageSchema, InferMessage } from "bun-ws-router/zod";

// Valibot (recommended for browsers)
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/valibot";
import type { AnyMessageSchema, InferMessage } from "bun-ws-router/valibot";
```

::: tip
Valibot is recommended for browser clients due to its smaller bundle size (~2-3 KB client + validator). Zod is acceptable for larger apps already using Zod.
:::

## Connection Patterns

### Explicit Connection (Default)

```typescript
const client = createClient({ url: "wss://example.com/ws" });

// Manually control connection
await client.connect();
client.send(Hello, { name: "Anna" });
```

### Auto-Connection (Opt-in)

```typescript
const client = createClient({
  url: "wss://example.com/ws",
  autoConnect: true, // Auto-connect on first send/request
});

// No explicit connect() needed
client.send(Hello, { name: "Anna" }); // Triggers connection if idle
```

::: warning
Auto-connect is convenient for prototypes but may hide connection errors. For production apps, prefer explicit connection control.
:::

## Basic Usage

### Sending Messages (Fire-and-Forget)

```typescript
// Simple send
const sent = client.send(ChatMessage, { text: "Hello!" });
if (!sent) {
  console.warn("Message dropped (offline or buffer full)");
}
```

### Receiving Messages

```typescript
// Register handler before connecting
client.on(HelloOk, (msg) => {
  console.log("Received:", msg.payload.text);
  console.log("Timestamp:", msg.meta.timestamp);
});

await client.connect();
```

### Request/Response Pattern

```typescript
try {
  const reply = await client.request(Hello, { name: "Bob" }, HelloOk, {
    timeoutMs: 5000,
  });
  console.log("Reply:", reply.payload.text);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn("Request timed out");
  }
}
```

## State Management

### Monitoring Connection State

```typescript
// Subscribe to state changes
client.onState((state) => {
  console.log("Connection state:", state);
  // "closed" | "connecting" | "open" | "closing" | "reconnecting"
});

// Check current state
if (client.state === "open") {
  client.send(Hello, { name: "Anna" });
}

// Sugar for state === "open"
if (client.isConnected) {
  client.send(Hello, { name: "Anna" });
}
```

### Wait for Connection

```typescript
// Wait until connected
await client.onceOpen();
console.log("Connected!");

// Now safe to send
client.send(Hello, { name: "Anna" });
```

## Cleanup

```typescript
// Graceful shutdown
await client.close({ code: 1000, reason: "Done" });

// Unsubscribe from handlers
const unsubscribe = client.on(HelloOk, handler);
unsubscribe(); // Remove this handler
```
