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
// Returns true if sent/queued, false if dropped

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
await client.close();
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

// Broadcast to all subscribed clients
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
  // States: "closed", "connecting", "open", "closing", "reconnecting"
});

// Wait for connection to open
await client.onceOpen();

// Close
await client.close();
```

See [Client API - Connection State Machine](./client-api.md#connection-state-machine) for complete state diagram and transition rules.

### Sending Messages

**Fire-and-forget (no response expected):**

```typescript
client.send(HelloMessage, { name: "Bob" });

// Messages without payload
client.send(PingMessage);
```

**Request/Response (RPC with auto-detected response):**

```typescript
import { z, rpc, message } from "@ws-kit/zod";

// Define RPC schema - binds request to response
const Hello = rpc("HELLO", { name: z.string() }, "HELLO_REPLY", {
  greeting: z.string(),
});

// Response schema auto-detected from RPC
const reply = await client.request(
  Hello,
  { name: "Alice" },
  {
    timeoutMs: 5000,
  },
);

console.log(reply.payload.greeting);
```

**Request/Response (with explicit response schema):**

```typescript
const reply = await client.request(
  HelloMessage,
  { name: "Alice" },
  HelloReplyMessage,
  {
    timeoutMs: 5000,
  },
);

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

**For complete auth patterns, protocol merging, and setup validation, see [Client Authentication Guide](./client-auth.md).**

### Query Parameter

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: async () => localStorage.getItem("token"),
    attach: "query", // default
    queryParam: "access_token", // default parameter name
  },
});

// Token is sent as ?access_token=<value>
```

### WebSocket Protocol (Sec-WebSocket-Protocol Header)

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: async () => localStorage.getItem("token"),
    attach: "protocol", // Use WebSocket subprotocol for auth
    protocolPrefix: "bearer.", // default prefix
    protocolPosition: "append", // default: append after user protocols
  },
});

// Token is sent via Sec-WebSocket-Protocol header as "bearer.<token>"
```

### Server-Side Validation

```typescript
import { serve } from "@ws-kit/bun";

serve(router, {
  authenticate(req) {
    // Option 1: Get token from query parameter
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get("access_token");

    // Option 2: Get token from Sec-WebSocket-Protocol header
    const protocols =
      req.headers.get("sec-websocket-protocol")?.split(",") || [];
    const tokenFromProtocol = protocols
      .find((p) => p.trim().startsWith("bearer."))
      ?.replace("bearer.", "");

    const token = tokenFromQuery || tokenFromProtocol;

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

Messages are automatically queued while connecting or offline. For detailed queue behavior and delivery semantics, see [Client API Reference - Queue Behavior](./client-api.md#queue-overflow-handling):

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  queue: "drop-newest", // Queue mode: "drop-newest" (default), "drop-oldest", or "off"
  queueSize: 1000, // Max queued messages (default: 1000)
});

// This will be queued if not connected yet
client.send(SomeMessage, { text: "hello" });

await client.connect();
// Queued messages are sent automatically
```

For detailed queue overflow handling and decision patterns, see [Client API - Queue Overflow Handling](./client-api.md#queue-overflow-handling).

## Auto-Reconnection

The client automatically reconnects with exponential backoff:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: {
    enabled: true, // default
    initialDelayMs: 300, // default: Start with 300ms
    maxDelayMs: 10_000, // default: Cap at 10 seconds
    maxAttempts: Infinity, // default: Retry forever
    jitter: "full", // default: Full jitter to prevent thundering herd
  },
});

await client.connect();
// Reconnects automatically on failure
```

Disable reconnection if needed:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: {
    enabled: false,
  },
});
```

## Error Handling

### RPC Errors (ServerError)

When using `request()`, server errors are thrown as `ServerError`:

```typescript
import { ServerError, TimeoutError, ValidationError } from "@ws-kit/client/zod";

try {
  const reply = await client.request(Hello, { name: "Alice" }, HelloReply, {
    timeoutMs: 5000,
  });
  console.log(reply.payload.greeting);
} catch (err) {
  if (err instanceof ServerError) {
    // Server sent ERROR message with standard error code
    if (err.code === "UNAUTHENTICATED") {
      console.log("Authentication failed");
    } else if (err.code === "RESOURCE_EXHAUSTED") {
      console.log("Rate limited");
    }
  } else if (err instanceof TimeoutError) {
    console.log("Request timed out");
  } else if (err instanceof ValidationError) {
    console.log("Invalid message");
  }
}
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

Always use the typed client package for your validator:

```typescript
// ✅ CORRECT: Import everything from typed client package
import { z, message, rpc, wsClient } from "@ws-kit/client/zod";

// Also correct: Import schemas from validator package
import { z, message, rpc } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";

// ❌ AVOID: Mixing validator instances
import { z } from "zod"; // Different Zod instance!
import { message } from "@ws-kit/zod";
// May cause type mismatches
```

## Advanced: Type-Safe Schemas

Share schemas between client and server for full type safety:

```typescript
// shared/schemas.ts
import { z, message } from "@ws-kit/zod";

export const Hello = message("HELLO", { name: z.string() });
export const HelloReply = message("HELLO_REPLY", { greeting: z.string() });

// server.ts
import { createRouter } from "@ws-kit/zod";
import { Hello, HelloReply } from "./shared/schemas";

const router = createRouter();

router.on(Hello, (ctx) => {
  ctx.send(HelloReply, { greeting: `Hi ${ctx.payload.name}!` });
});

// client.ts
import { wsClient } from "@ws-kit/client/zod";
import { Hello, HelloReply } from "./shared/schemas";

const client = wsClient({ url: "wss://api.example.com/ws" });

// Full type inference from shared schemas
client.on(HelloReply, (msg) => {
  console.log(msg.payload.greeting); // ✅ Fully typed as string
});

client.send(Hello, { name: "Alice" }); // ✅ Payload typed from schema
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
