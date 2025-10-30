# Client Setup

The ws-kit client provides a type-safe browser WebSocket client that reuses the same message schemas as your server.

## Installation

Choose your validator and install the client:

```bash
# With Zod (recommended for familiar APIs)
bun add @ws-kit/client @ws-kit/zod zod

# With Valibot (lighter bundles)
bun add @ws-kit/client @ws-kit/valibot valibot
```

## Quick Start

### 1. Share Schemas

Define message schemas once, import in both client and server:

```typescript
// shared/schemas.ts
import { z, message } from "@ws-kit/zod";

export const Hello = message("HELLO", { name: z.string() });
export const HelloReply = message("HELLO_REPLY", { greeting: z.string() });
export const Broadcast = message("BROADCAST", { message: z.string() });
```

### 2. Create the Client

```typescript
// client.ts
import { wsClient } from "@ws-kit/client/zod";
import { Hello, HelloReply, Broadcast } from "./shared/schemas";

const client = wsClient({
  url: "wss://api.example.com/ws",
});

// Connect
await client.connect();

// Send a message (fire-and-forget)
client.send(Hello, { name: "Alice" });

// Listen for replies
client.on(HelloReply, (msg) => {
  // ✅ msg.payload.greeting is typed as string
  console.log(msg.payload.greeting);
});

// Listen for broadcasts
client.on(Broadcast, (msg) => {
  console.log(`Broadcast: ${msg.payload.message}`);
});

// Gracefully disconnect
await client.disconnect();
```

### 3. Use Schemas on Server

```typescript
// server.ts
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { Hello, HelloReply, Broadcast } from "./shared/schemas";

const router = createRouter();

router.on(Hello, (ctx) => {
  // ✅ ctx.payload.name is typed as string
  ctx.send(HelloReply, {
    greeting: `Hello, ${ctx.payload.name}!`,
  });
});

// Broadcast to all clients
router.publish("all", Broadcast, {
  message: "Server broadcast",
});

serve(router, { port: 3000 });
```

## Client API

### Connection Management

```typescript
const client = wsClient({ url: "wss://api.example.com/ws" });

// Connect
await client.connect();

// Check connection state
if (client.isConnected) {
  console.log("Connected!");
}

// Listen to state changes
client.onState((state) => {
  console.log(`State: ${state}`);
  // States: "disconnected", "connecting", "connected", "closing"
});

// Wait for connection to open
await client.onceOpen();

// Disconnect
await client.disconnect();
```

### Sending Messages

**Fire-and-forget (no response expected):**

```typescript
client.send(HelloMessage, { name: "Bob" });

// Messages without payload
client.send(PingMessage);
```

**Request/Response (with timeout):**

```typescript
const reply = await client.request(HelloMessage, HelloReplyMessage, {
  timeoutMs: 5000,
});

console.log(reply.payload.greeting);
```

### Receiving Messages

**Register handlers:**

```typescript
client.on(BroadcastMessage, (msg) => {
  // ✅ msg fully typed
  console.log(`Message: ${msg.payload.text}`);
});

// Remove handler (calling returned function)
const unsubscribe = client.on(SomeMessage, handler);
unsubscribe();
```

**Handle unknown messages:**

```typescript
client.onUnhandled((msg) => {
  console.log(`Unknown message type: ${msg.type}`);
});
```

**Handle errors:**

```typescript
client.onError((error, context) => {
  console.error(`Error (${context.type}): ${error.message}`);
  // Types: "parse", "validation", "overflow", "unknown"
});
```

## Authentication

### Query Parameter

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: async () => localStorage.getItem("token"),
  },
});

// Token is sent as ?token=<value>
```

### Authorization Header

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: async () => localStorage.getItem("token"),
    type: "Bearer", // Sent as: Authorization: Bearer <token>
  },
});
```

### Server-Side Validation

```typescript
import { serve } from "@ws-kit/bun";

serve(router, {
  authenticate(req) {
    // Get token from header or query param
    const token = req.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return undefined; // Connection rejected
    }

    try {
      const user = verifyToken(token);
      return { userId: user.id, username: user.username };
    } catch (err) {
      return undefined; // Connection rejected
    }
  },
});
```

## Message Queueing

Messages are automatically queued while connecting or offline:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  queue: {
    maxSize: 100, // Max queued messages
  },
});

// This will be queued if not connected yet
client.send(SomeMessage, payload);

await client.connect();
// Queued messages are sent automatically
```

## Auto-Reconnection

The client automatically reconnects with exponential backoff:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: {
    initialDelay: 1000, // Start with 1 second
    maxDelay: 30000, // Cap at 30 seconds
    maxAttempts: Infinity, // Retry forever
  },
});

await client.connect();
// Reconnects automatically on failure
```

Disable reconnection if needed:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: false,
});
```

## Error Handling

### Type-Safe Error Codes

Server errors use standard error codes:

```typescript
client.on(ErrorMessage, (msg) => {
  // Standard error codes
  if (msg.payload.code === "UNAUTHENTICATED") {
    console.log("Authentication failed");
  } else if (msg.payload.code === "RESOURCE_EXHAUSTED") {
    console.log("Rate limited");
  }
});
```

### Handling Validation Errors

```typescript
client.onError((error, context) => {
  if (context.type === "validation") {
    console.log("Invalid message received from server");
  }
});
```

## Import Patterns

Always use the correct import source:

```typescript
// ✅ CORRECT: Single import source
import { message } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";

// ❌ AVOID: Mixing imports
import { z } from "zod"; // Different instance
import { wsClient } from "@ws-kit/client/zod";
// Type mismatches in handlers!
```

## Advanced: Using with TypeScript

Infer types from your router:

```typescript
// server.ts
import { createRouter } from "@ws-kit/zod";
import { Hello, HelloReply } from "./shared/schemas";

export const router = createRouter();

router.on(Hello, (ctx) => {
  ctx.send(HelloReply, { greeting: "Hi" });
});

export type AppRouter = typeof router;
```

**Client:**

```typescript
import { wsClient } from "@ws-kit/client/zod";
import type { AppRouter } from "./server";

// Client is fully typed based on server router
const client = wsClient<AppRouter>({ url: "wss://api.example.com/ws" });

// All message schemas are inferred from server
client.on(HelloReply, (msg) => {
  console.log(msg.payload.greeting); // ✅ Fully typed
});
```

## Valibot Alternative

Use `@ws-kit/client/valibot` for Valibot schemas:

```bash
bun add @ws-kit/client @ws-kit/valibot valibot
```

The API is identical:

```typescript
import { v, message } from "@ws-kit/valibot";
import { wsClient } from "@ws-kit/client/valibot";

const client = wsClient({ url: "wss://api.example.com/ws" });
// Everything else is the same!
```

## See Also

- `@ws-kit/zod` — Server-side Zod adapter
- `@ws-kit/valibot` — Server-side Valibot adapter
- `docs/examples.md` — Real-world example code
