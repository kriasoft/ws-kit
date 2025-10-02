# Browser WebSocket Client

Type-safe WebSocket client for browsers with schema-based message validation.

## Features

- 🔒 **Type-safe messaging** – Full TypeScript inference from schema to handler
- 🔄 **Auto-reconnection** – Exponential backoff with configurable jitter
- 📦 **Message queueing** – Configurable offline buffering
- 🔐 **Auth support** – Query param or WebSocket protocol attachment
- ⏱️ **Request/response** – RPC-style messaging with correlation tracking
- 🎯 **Multi-handler** – Register multiple handlers per message type
- 🪶 **Tiny bundle** – ~3KB min+gz (without validator)

## Usage

### Basic Client

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";
import { createClient } from "bun-ws-router/client";

// Create schemas (shared with server)
const { messageSchema } = createMessageSchema(z);
const Hello = messageSchema("HELLO", { name: z.string() });
const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

// Create client
const client = createClient({ url: "wss://example.com/ws" });

// Register handlers
client.on(HelloOk, (msg) => {
  console.log("Server says:", msg.payload.text);
});

// Connect and send
await client.connect();
client.send(Hello, { name: "Alice" });
```

### Request/Response

```typescript
// RPC-style request/response
const reply = await client.request(Hello, { name: "Bob" }, HelloOk, {
  timeoutMs: 5000,
});
console.log(reply.payload.text);
```

### Auto-Connection

```typescript
const client = createClient({
  url: "wss://example.com/ws",
  autoConnect: true, // Auto-connect on first send/request
});

// No explicit connect() needed
client.send(Hello, { name: "Charlie" }); // Triggers connection
```

### Authentication

```typescript
// Query parameter (default)
const client = createClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: () => localStorage.getItem("access_token"),
    attach: "query", // Appends ?access_token=...
  },
});

// WebSocket protocol header
const client = createClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: () => localStorage.getItem("access_token"),
    attach: "protocol", // Uses Sec-WebSocket-Protocol header
    protocolPrefix: "bearer.",
  },
});
```

### Reconnection

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  reconnect: {
    enabled: true,
    maxAttempts: Infinity,
    initialDelayMs: 300,
    maxDelayMs: 10_000,
    jitter: "full", // Prevents thundering herd
  },
});
```

### Message Queueing

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  queue: "drop-newest", // or "drop-oldest" or "off"
  queueSize: 1000,
});

// Messages are queued while offline
const sent = client.send(Hello, { name: "David" });
if (!sent) {
  console.warn("Message dropped (offline or buffer full)");
}
```

## API Reference

See [client.md](../specs/client.md) for full API documentation.

## Type Safety

The client enforces schema constraints at compile time:

```typescript
// ✅ Type-safe payload
client.send(Hello, { name: "Eve" });

// ❌ Type error
client.send(Hello, { name: 123 });

// ✅ Required extended meta
const RoomMsg = messageSchema(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Required meta
);

client.send(
  RoomMsg,
  { text: "hi" },
  {
    meta: { roomId: "general" }, // Required
  },
);
```

## Error Handling

```typescript
import {
  TimeoutError,
  ServerError,
  ConnectionClosedError,
} from "bun-ws-router/client";

try {
  const reply = await client.request(Hello, { name: "Frank" }, HelloOk);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.warn(`Timeout after ${error.timeoutMs}ms`);
  } else if (error instanceof ServerError) {
    console.error(`Server error: ${error.code}`, error.context);
  } else if (error instanceof ConnectionClosedError) {
    console.warn("Connection closed before reply");
  }
}
```

## State Management

```typescript
// Monitor connection state
client.onState((state) => {
  console.log("State:", state); // "closed" | "connecting" | "open" | "closing" | "reconnecting"
});

// Wait for connection
await client.onceOpen();

// Check current state
console.log(client.state);

// Check selected protocol
console.log(client.protocol); // Selected WebSocket subprotocol
```

## License

MIT
