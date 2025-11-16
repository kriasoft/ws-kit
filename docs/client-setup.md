# Client Setup

The ws-kit client provides a type-safe browser WebSocket client that reuses the same message schemas as your server.

## Installation

Choose your validator and install the client:

```bash
# With Zod
bun add @ws-kit/client @ws-kit/zod zod

# With Valibot (smaller bundle size)
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
```

### 2. Create the Client

```typescript
// client.ts
import { wsClient } from "@ws-kit/client/zod";
import { Hello, HelloReply } from "./shared/schemas";

const client = wsClient({
  url: "wss://api.example.com/ws",
});

// Connect
await client.connect();

// Send a message (fire-and-forget)
// Returns true if sent/queued, false if dropped
const sent = client.send(Hello, { name: "Alice" });

// Listen for replies
client.on(HelloReply, (msg) => {
  // ✅ msg.payload.greeting is typed as string
  console.log(msg.payload.greeting);
});

// Gracefully disconnect
await client.close();
```

### 3. Use Schemas on Server

```typescript
// server.ts
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { Hello, HelloReply } from "./shared/schemas";

const router = createRouter();

router.on(Hello, (ctx) => {
  // ✅ ctx.payload.name is typed as string
  ctx.send(HelloReply, {
    greeting: `Hello, ${ctx.payload.name}!`,
  });
});

serve(router, { port: 3000 });
```

## Request/Response (RPC)

For request/response patterns, use the `request()` method with an explicit response schema:

```typescript
// Request with explicit response schema
const reply = await client.request(
  Hello, // Request message
  { name: "Alice" }, // Request payload
  HelloReply, // Response message
  {
    timeoutMs: 5000, // Optional timeout
  },
);

console.log(reply.payload.greeting); // ✅ Fully typed
```

Or use the `rpc()` helper to bind request and response at schema creation time:

```typescript
import { z, rpc } from "@ws-kit/zod";

// Define RPC schema - binds request to response
const Hello = rpc("HELLO", { name: z.string() }, "HELLO_REPLY", {
  greeting: z.string(),
});

// Response type is inferred automatically
const reply = await client.request(Hello, { name: "Alice" });
```

For streaming responses with progress updates, see [Client API Reference - Streaming Responses](./client-api.md#streaming-responses-with-progress-updates).

## Core API

The client provides three main APIs:

- **Connection**: `connect()`, `close()`, `isConnected`, `onState()`, `onceOpen()`
- **Messaging**: `send()` for fire-and-forget, `request()` for request/response (RPC)
- **Handlers**: `on()` to register message handlers, `onUnhandled()` for unknown messages, `onError()` for centralized error handling

See [Client API Reference](./client-api.md) for complete API documentation including connection state machine, streaming responses with `onProgress`, and advanced options like `autoConnect` and `pendingRequestsLimit`.

## Authentication

Use token-based authentication via query parameters or WebSocket protocol headers:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: async () => localStorage.getItem("token"),
    attach: "query", // or "protocol"
  },
});
```

For complete authentication patterns, server setup, protocol merging, and edge cases, see [Client Authentication Guide](./client-auth.md).

## Message Queueing

Messages are automatically queued while connecting or offline:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  queue: "drop-newest", // "drop-newest" (default), "drop-oldest", or "off"
  queueSize: 1000, // Max queued messages
});

// Queued if offline, sent automatically when connected
client.send(SomeMessage, { text: "hello" });
```

For overflow behavior decisions (drop-newest vs drop-oldest), guidance, and advanced management, see [Client API Reference - Queue Overflow Handling](./client-api.md#queue-overflow-handling).

## Auto-Reconnection

The client reconnects automatically with exponential backoff when connection drops:

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: {
    enabled: true, // default
    initialDelayMs: 300, // start delay
    maxDelayMs: 10_000, // max delay
    maxAttempts: Infinity, // retry forever
  },
});
```

**Note:** This is **auto-reconnect**—reconnecting after connection loss. To connect automatically on first `send()` or `request()` when offline, use the `autoConnect` option (see Client API Reference).

For reconnection strategies, fine-tuning delays, handling reconnection events, and disabling reconnection, see [Client Advanced Guide](./client-advanced.md#reconnection).

## Error Handling

Use typed error classes for request failures and centralized error handler for message validation:

```typescript
import {
  RpcError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "@ws-kit/client/zod";

try {
  // request() never throws synchronously
  const reply = await client.request(Hello, { name: "Alice" });
} catch (err) {
  if (err instanceof RpcError) {
    // Server sent RPC_ERROR with error code (typical RPC failure)
    console.log("RPC error:", err.code);
  } else if (err instanceof ServerError) {
    // Server sent ERROR (e.g., validation failed before correlationId extracted)
    console.log("Server error:", err.code);
  } else if (err instanceof TimeoutError) {
    console.log("Request timed out");
  }
}

// Handle message validation errors centrally
client.onError((error, context) => {
  if (context.type === "validation") {
    console.log("Invalid message from server");
  }
});
```

**Note:** The `request()` method always returns a Promise—it never throws synchronously. RPC errors are typically wrapped in RPC_ERROR messages, but if the server cannot extract a valid `correlationId` from the request (e.g., early validation failure), it sends an ERROR message instead (with code `INVALID_ARGUMENT`), which the client rejects as ServerError.

For complete error taxonomy, RPC error patterns, handling validation errors with details, and recovery strategies, see [Client Error Handling Guide](./client-errors.md).

## Import Patterns

Always import from the typed client package to avoid dual-package hazards:

```typescript
// ✅ PRIMARY: Import everything from typed client package
import { z, message, rpc, wsClient } from "@ws-kit/client/zod";

// ✅ ALSO VALID: Import schemas from validator, client from typed package
import { z, message, rpc } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";

// ❌ AVOID: Mixing validator instances
import { z } from "zod"; // Different instance!
import { message } from "@ws-kit/zod"; // Incompatible types
```

For details on why this matters, see [Core Concepts - Schema Identity](./core-concepts.md#schema-identity).

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

**Next Steps**

- [Client API Reference](./client-api.md) — Complete API documentation
- [Client Advanced Guide](./client-advanced.md) — Reconnection, streaming, and advanced patterns
- [Client Authentication Guide](./client-auth.md) — Auth patterns, protocol merging, edge cases
- [Client Error Handling Guide](./client-errors.md) — Error taxonomy and recovery strategies

**Other Resources**

- [Getting Started Guide](./getting-started.md) — Full project setup
- [Examples](./examples.md) — Real-world code examples
- [Core Concepts](./core-concepts.md) — Message routing and handler patterns
- [RPC Specification](./guides/rpc.md) — Request/response protocol details
