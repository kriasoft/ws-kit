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
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z);

export const Hello = messageSchema("HELLO", { name: z.string() });
export const HelloOk = messageSchema("HELLO_OK", { text: z.string() });
export const ChatMessage = messageSchema("CHAT", { text: z.string() });
```

### 2. Create the Client

```typescript
// client.ts
import { createClient } from "@ws-kit/client/zod"; // ✅ Typed client
import { Hello, HelloOk } from "./shared/schemas";

const client = createClient({
  url: "wss://api.example.com/ws",
});

// Connect to server
await client.connect();

// Send message
client.send(Hello, { name: "Anna" });

// Receive messages with full type inference
client.on(HelloOk, (msg) => {
  // ✅ msg.payload.text is typed as string
  console.log("Server says:", msg.payload.text);
});
```

::: tip TYPED CLIENT REQUIRED
Use `/zod/client` or `/valibot/client` for full type inference as shown above. The generic client (`/client`) provides `unknown` in handlers and is only for custom validators.
:::

### 3. Use on the Server

```typescript
// server.ts
import { WebSocketRouter } from "@ws-kit/zod";
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

### Typed Clients (Recommended)

**For full type safety, import from validator-specific paths:**

```typescript
// Zod users - RECOMMENDED
import { createClient } from "@ws-kit/client/zod";

// Valibot users - RECOMMENDED
import { createClient } from "@ws-kit/client/valibot";
```

**Why typed clients?**

Typed clients provide full TypeScript inference in message handlers:

```typescript
import { createClient } from "@ws-kit/client/zod"; // ✅ Typed client

const client = createClient({ url: "wss://api.example.com" });

client.on(HelloOk, (msg) => {
  // ✅ msg is fully typed: { type: "HELLO_OK", meta: {...}, payload: { text: string } }
  console.log(msg.type); // "HELLO_OK" (literal type)
  console.log(msg.payload.text.toUpperCase()); // ✅ String methods work!
});
```

**Generic client (custom validators only):**

```typescript
// ⚠️ Only for custom validators - handlers receive `unknown`
import { createClient } from "@ws-kit/client";

client.on(HelloOk, (msg) => {
  // ⚠️ msg is unknown - requires manual type assertion
  const typed = msg as InferMessage<typeof HelloOk>;
});
```

### Validator Packages

Choose Zod or Valibot:

```typescript
// Zod (server and client)
import { WebSocketRouter, createMessageSchema } from "@ws-kit/zod";
import type { AnyMessageSchema, InferMessage } from "@ws-kit/zod";

// Valibot (recommended for browsers)
import { WebSocketRouter, createMessageSchema } from "@ws-kit/valibot";
import type { AnyMessageSchema, InferMessage } from "@ws-kit/valibot";
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

**AutoConnect Semantics:**

- First `send()` or `request()` triggers `connect()` if `state === "closed"` AND client never connected before
- Connection errors:
  - `send()` returns `false` (logged to console, never throws)
  - `request()` returns rejected Promise (never throws synchronously)
- After successful auto-connect, normal queue behavior applies
- Does **NOT** auto-reconnect from `"closed"` after manual `close()`

**When to Use AutoConnect:**

| Scenario                                 | Use AutoConnect? | Reason                                 |
| ---------------------------------------- | ---------------- | -------------------------------------- |
| Prototypes/demos                         | ✅ Yes           | Simplifies code, connection assumed    |
| Single connection lifecycle              | ✅ Yes           | Connection established once at startup |
| Complex apps with reconnect logic        | ❌ No            | Need explicit connection control       |
| Apps requiring connection error handling | ❌ No            | Errors hidden in fire-and-forget       |
| Production real-time dashboards          | ⚠️ Maybe         | If connection failure is acceptable    |

::: warning Production Guidance
Auto-connect is convenient for prototypes but may hide connection errors. For production apps with critical real-time requirements, prefer explicit connection control with error handling.
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
