# Client API Reference

Complete API documentation for the browser WebSocket client.

::: tip
For complete type definitions and implementation details, see the [Client Specification](./specs/client.md).
:::

::: info
**Topic subscription methods** (`subscribe()`, `unsubscribe()`) are not yet implemented. See [Client Specification](./specs/client.md) for planned features.
:::

::: tip
For error handling patterns and troubleshooting, see [Client Error Handling](./client-errors.md). For complete error code taxonomy, see [Error Handling Spec](./specs/error-handling.md).
:::

## Installation & Usage

```typescript
import { z, message } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";

// Define message schemas
const Hello = message("HELLO", { name: z.string() });
const HelloOk = message("HELLO_OK", { text: z.string() });

// Create client
const client = wsClient({
  url: "wss://api.example.com",
  autoConnect: false, // default: false (explicit connect() required)
  reconnect: {
    enabled: true, // default: true
    maxAttempts: Infinity,
    initialDelayMs: 300,
    maxDelayMs: 10_000,
    jitter: "full",
  },
  queue: "drop-newest", // default: "drop-newest"
  queueSize: 1000, // default: 1000
});

// Connect explicitly (or use autoConnect: true)
await client.connect();

// Send fire-and-forget message
client.send(Hello, { name: "Alice" });

// Listen for messages
client.on(HelloOk, (msg) => {
  console.log(msg.payload.text); // Fully typed
});

// Request/response pattern
const response = await client.request(Hello, { name: "Bob" }, HelloOk);
console.log(response.payload.text); // Fully typed
```

**Available imports:**

- **Zod:** `import { wsClient, z, message, rpc } from "@ws-kit/client/zod"`
- **Valibot:** `import { wsClient, v, message, rpc } from "@ws-kit/client/valibot"`

Note: The typed client packages re-export schema helpers (`message`, `rpc`) and validators (`z`, `v`) for convenience. You can also import them from `@ws-kit/zod` or `@ws-kit/valibot` directly.

## Properties

### state

Current connection state (read-only).

```typescript
readonly state: ClientState
```

**Value:** One of `"closed"`, `"connecting"`, `"open"`, `"closing"`, or `"reconnecting"`

**Notes:**

- Use `onState()` to subscribe to state changes
- Check `isConnected` for a boolean shorthand when you only need to know if connection is open

**Example:**

```typescript
if (client.state === "open") {
  console.log("Connected and ready");
}

// Subscribe to state changes
client.onState((state) => {
  console.log("State:", state);
});
```

### isConnected

Convenience flag for checking if connection is open.

```typescript
readonly isConnected: boolean
```

**Notes:**

- `true` when `state === "open"`, `false` otherwise
- Shorter alternative to `client.state === "open"`

**Example:**

```typescript
if (client.isConnected) {
  client.send(Message, {
    /* ... */
  });
} else {
  console.warn("Not connected");
}
```

### protocol

Negotiated WebSocket subprotocol from server.

```typescript
readonly protocol: string
```

**Notes:**

- Read after connection opens to verify server selected expected protocol
- Value comes from `Sec-WebSocket-Protocol` header
- Useful for validating auth or feature negotiation
- Empty string if no subprotocol negotiated

**Example:**

```typescript
await client.connect();
if (client.protocol.startsWith("bearer.")) {
  console.log("Authenticated via bearer token");
}
```

## Methods

### connect()

Establish WebSocket connection.

```typescript
connect(): Promise<void>
```

**Behavior:**

- **Idempotent**: Returns in-flight promise if already connecting
- Resolves immediately if already open
- Auto-called by `send()`/`request()` when `autoConnect: true`

**Example:**

```typescript
await client.connect();
console.log("Connected!");
```

### close()

Gracefully close connection.

```typescript
close(opts?: { code?: number; reason?: string }): Promise<void>
```

**Behavior:**

- **Fully idempotent**: Safe to call in any state
- **Never rejects**: Always resolves, even if already closed
- Cancels reconnection
- Pending requests reject with `ConnectionClosedError`

**Example:**

```typescript
await client.close({ code: 1000, reason: "Done" });
```

### onState()

Subscribe to connection state changes.

```typescript
onState(cb: (state: ClientState) => void): () => void
```

**Returns:** Unsubscribe function

**Example:**

```typescript
const unsubscribe = client.onState((state) => {
  console.log("State changed to:", state);
});

// Later: unsubscribe()
```

### onceOpen()

Wait until connection opens.

```typescript
onceOpen(): Promise<void>
```

**Behavior:**

- Resolves immediately if already open
- Waits for next `"open"` state transition otherwise

**Example:**

```typescript
await client.onceOpen();
// Now connected, safe to send
```

### on()

Register message handler.

```typescript
on<S extends AnyMessageSchema>(
  schema: S,
  handler: (msg: InferMessage<S>) => void
): () => void
```

**Returns:** Unsubscribe function (call to remove this specific handler)

**Features:**

- Multiple handlers per schema (execute in registration order)
- Full type inference for handler
- Handler errors logged to console, don't stop other handlers

**Example:**

```typescript
const unsubscribe = client.on(HelloOk, (msg) => {
  console.log("Payload:", msg.payload);
  console.log("Meta:", msg.meta);
});

// Remove handler later
unsubscribe();
```

::: info
**Note:** There is no `off()` method. Use the returned unsubscribe function to remove a specific handler. This pattern follows modern JavaScript conventions (similar to `addEventListener` with `AbortController`).
:::

### send()

Send fire-and-forget message.

```typescript
// With payload (schema defines payload field)
send<S extends AnyMessageSchema>(
  schema: S,
  payload: InferPayload<S>,
  opts?: { meta?: InferMeta<S>; correlationId?: string }
): boolean

// Without payload (schema has no payload field)
send<S extends AnyMessageSchema>(
  schema: S,
  opts?: { meta?: InferMeta<S>; correlationId?: string }
): boolean
```

**Overloads:** TypeScript uses conditional types to enforce correct usage - schemas with payload require the payload parameter, schemas without payload omit it.

**Returns:**

- `true`: Message sent or queued successfully
- `false`: Message dropped (offline with `queue: "off"`, queue overflow, or validation error)

**Never throws** - Fire-and-forget design never blocks or rejects. Check the return value to detect delivery failures. This matches WebSocket semantics where the underlying protocol is asynchronous and best-effort.

**Example:**

```typescript
const sent = client.send(ChatMessage, { text: "Hello!" });
if (!sent) {
  console.warn("Message dropped");
}

// With extended meta
client.send(
  RoomMessage,
  { text: "Hi" },
  {
    meta: { roomId: "general" },
  },
);
```

### request()

Send request and wait for reply.

```typescript
// Traditional: explicit response schema (with payload)
request<S extends AnyMessageSchema, R extends AnyMessageSchema>(
  schema: S,
  payload: InferPayload<S>,
  reply: R,
  opts?: {
    timeoutMs?: number;        // default: 30000
    meta?: InferMeta<S>;
    correlationId?: string;
    signal?: AbortSignal;
    onProgress?: (data: unknown) => void;  // Streaming progress updates
  }
): Promise<InferMessage<R>>

// Traditional: explicit response schema (no payload)
request<S extends AnyMessageSchema, R extends AnyMessageSchema>(
  schema: S,
  reply: R,
  opts?: {
    timeoutMs?: number;
    meta?: InferMeta<S>;
    correlationId?: string;
    signal?: AbortSignal;
    onProgress?: (data: unknown) => void;  // Streaming progress updates
  }
): Promise<InferMessage<R>>
```

**RPC-Style Shorthand:** When using `rpc()` helper to create request/response pairs, omit the `reply` parameter and let the response type be auto-detected:

```typescript
const GetUser = rpc("GET_USER", { userId: z.string() }, (r) =>
  r
    .ok("USER", { id: z.string(), name: z.string() })
    .err("NOT_FOUND", { reason: z.string() }),
);

// Auto-detection: reply schema inferred from RPC definition
const user = await client.request(GetUser, { userId: "123" });
```

**Traditional Style:** Explicitly provide response schema as a separate parameter (useful when request and response schemas are defined independently).

**Returns:** Promise resolving to reply message

**Rejects with:**

- `ValidationError`: Invalid payload or malformed reply
- `TimeoutError`: No reply within timeout
- `ServerError`: Server sent error response (legacy)
- `RpcError`: Server sent RPC error with retry hints
- `ConnectionClosedError`: Connection closed before reply
- `WsDisconnectedError`: Connection disconnected during request
- `StateError`: Aborted via signal or pending limit exceeded

**Never throws synchronously** - Always returns a Promise

**Example:**

```typescript
import { z, message, rpc } from "@ws-kit/zod";
import { TimeoutError, RpcError } from "@ws-kit/client";

// Traditional: explicit response schema
const Hello = message("HELLO", { name: z.string() });
const HelloOk = message("HELLO_OK", { text: z.string() });

try {
  const reply = await client.request(Hello, { name: "Anna" }, HelloOk, {
    timeoutMs: 5000,
  });
  console.log(reply.payload.text);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn("Timeout");
  } else if (err instanceof RpcError) {
    console.error(`RPC error: ${err.code}`, err.details);
  }
}

// With payload-less schema
const Ping = message("PING");
const Pong = message("PONG", { timestamp: z.number() });

const reply = await client.request(Ping, Pong, {
  timeoutMs: 5000,
});

// With AbortSignal
const controller = new AbortController();
const promise = client.request(Hello, { name: "test" }, HelloOk, {
  signal: controller.signal,
});

// Cancel if needed
controller.abort();
```

### onUnhandled()

Hook for unhandled message types.

```typescript
onUnhandled(cb: (msg: AnyInboundMessage) => void): () => void
```

**Returns:** Unsubscribe function

**Receives:**

- Structurally valid messages with no registered schema
- Messages that pass structure check: `{ type: string, meta?: object, payload?: any }`

**Never receives:**

- Messages that fail schema validation (dropped)
- Invalid messages (dropped)

**Important:** Only one callback can be registered at a time. Registering a new callback replaces the previous one:

```typescript
client.onUnhandled((msg) => {
  console.warn("Callback A:", msg.type);
});

client.onUnhandled((msg) => {
  console.warn("Callback B:", msg.type); // Callback A is replaced
});
// Only Callback B will fire for unhandled messages
```

Use the returned unsubscribe function to remove the callback and register a new one:

```typescript
const unsub = client.onUnhandled((msg) => {
  console.warn("Callback A:", msg.type);
});

unsub(); // Remove callback A
client.onUnhandled((msg) => {
  console.warn("Callback B:", msg.type); // Now callback B is active
});
```

**Example:**

```typescript
client.onUnhandled((msg) => {
  console.warn("Unhandled message type:", msg.type);
  console.log("Payload:", msg.payload);
});
```

### onError()

Hook for non-fatal internal errors.

```typescript
onError(cb: (error: Error, context: ErrorContext) => void): () => void
```

**Returns:** Unsubscribe function

**Fires for:**

- `"parse"`: JSON parse failures
- `"validation"`: Message validation failures
- `"overflow"`: Queue overflow
- `"unknown"`: Other internal errors

**Does NOT fire for:**

- Request rejections (caller handles)
- Handler errors (logged to console)

**Example:**

```typescript
client.onError((error, context) => {
  switch (context.type) {
    case "parse":
      console.warn("Invalid JSON:", error.message);
      break;
    case "validation":
      console.warn("Validation failed:", context.details);
      break;
    case "overflow":
      console.warn("Queue full, message dropped");
      break;
  }
});
```

## Connection & Authentication

**For comprehensive authentication patterns, setup, and protocol merging edge cases, see [Client Authentication Guide](./client-auth.md).**

### Connection State Machine

The client progresses through well-defined states:

```
closed → connecting → open → closing → closed
  ↑__________________________________|  (manual reconnect via connect())
closed → reconnecting → connecting      (auto-reconnect)
```

**State Descriptions:**

- **closed** — Initial state or after `close()`. No connection established.
- **connecting** — Connection attempt in progress.
- **open** — WebSocket connected and ready for messaging.
- **closing** — Graceful disconnect initiated (during `close()`).
- **reconnecting** — Waiting before retry attempt (exponential backoff when `reconnect.enabled: true`).

**Transitions:**

- Manual connection: Call `connect()` from `closed` → `connecting` → `open`
- Graceful shutdown: Call `close()` from any state → `closing` → `closed`
- Auto-reconnect: After connection loss, cycles `closed` → `reconnecting` → `connecting` → `open` (if enabled)

### Authentication & Protocol Merging

By default, WebSocket client uses query parameters for auth tokens:

```typescript
const client = wsClient({
  url: "wss://api.example.com",
  auth: {
    attach: "query", // default
    queryParam: "access_token", // param name (default)
    getToken: async () => {
      const token = await localStorage.getItem("token");
      return token;
    },
  },
});

// Sends: wss://api.example.com?access_token=<token>
await client.connect();
```

**Alternative: Protocol-Based Auth**

For environments where query params are inconvenient (e.g., proxies, firewalls), attach token to the WebSocket subprotocol header:

```typescript
const client = wsClient({
  url: "wss://api.example.com",
  auth: {
    attach: "protocol", // Use Sec-WebSocket-Protocol header
    protocolPrefix: "bearer.", // default
    getToken: async () => token,
  },
});

// Sends: Sec-WebSocket-Protocol: bearer.<token>
await client.connect();
```

**Combining with User Protocols**

If your app defines custom WebSocket subprotocols, merge with auth:

```typescript
const client = wsClient({
  url: "wss://api.example.com",
  protocols: ["v1", "v2"], // App-defined protocols
  auth: {
    attach: "protocol",
    protocolPrefix: "bearer.",
    getToken: async () => token,
  },
});

// Sent protocols: ["bearer.<token>", "v1", "v2"]
// Server selects one; check client.protocol after connection:
await client.connect();
if (client.protocol === "v1") {
  // Server chose v1 protocol
}
```

**Notes:**

- Auth token is refreshed before each connection attempt (including reconnects)
- Reserved query params or protocol prefixes are stripped to prevent spoofing
- Server validates and selects the actual protocol (read `client.protocol` to check)

## Edge Cases & Advanced Patterns

### Multiple Handlers Per Schema

When registering multiple handlers for the same schema, all execute in registration order:

```typescript
client.on(Message, () => console.log("First"));
client.on(Message, () => console.log("Second"));
// Both fire when Message is received

// Each returns its own unsubscribe function
const unsub1 = client.on(Message, handler1);
const unsub2 = client.on(Message, handler2);

unsub1(); // Remove handler1 only; handler2 still active
```

**Error Handling:** If a handler throws, the error is logged to console but other handlers still execute. This ensures one broken handler doesn't silently drop messages.

### onUnhandled Exclusivity

`onUnhandled()` fires only for messages with no matching schema. Once a schema matches, `onUnhandled()` does not fire:

```typescript
client.on(KnownMessage, (msg) => {
  // This fires if schema matches
});

client.onUnhandled((msg) => {
  // This fires ONLY if no schema matched the type
  // Never fires for KnownMessage
});
```

### AbortSignal Semantics

Cancel pending requests via `AbortSignal`:

```typescript
const controller = new AbortController();
const promise = client.request(Query, payload, Reply, {
  signal: controller.signal,
});

// Later: abort the request
controller.abort();
// promise rejects with StateError
```

**Notes:**

- Abort immediately rejects the promise with `StateError`
- Aborting after response arrives does nothing (race condition is safe)
- Each request needs its own controller for independent cancellation

### Reserved Meta Keys

The following meta fields are reserved and automatically stripped from user-provided meta:

- `clientId` — Auto-injected by server
- `receivedAt` — Auto-injected by server
- `correlationId` — Reserved for request/response correlation (overwrite carefully)

Stripping prevents client from spoofing server-provided metadata. If you provide these keys, they are silently removed:

```typescript
client.send(Message, payload, {
  meta: {
    custom: "value",
    clientId: "ignored", // Removed before sending
  },
});
```

## Error Classes

For complete error class definitions, detailed examples, and usage patterns, see [Client Error Handling Guide](./client-errors.md#error-classes).

**In Brief:** Import and catch errors from `@ws-kit/client`:

```typescript
import {
  ValidationError,
  TimeoutError,
  RpcError,
  ConnectionClosedError,
  StateError,
  WsDisconnectedError,
} from "@ws-kit/client";

try {
  const reply = await client.request(Query, payload, Response);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn(`Timeout after ${err.timeoutMs}ms`);
  } else if (err instanceof RpcError) {
    console.error(`RPC error: ${err.code}`, err.details);
  }
}
```

## Common Patterns & Best Practices

### Graceful Shutdown

Always close the client before app exit to cancel pending requests and release resources:

```typescript
async function shutdown() {
  await client.close({ code: 1000, reason: "App shutdown" });
  console.log("Client closed");
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

**What happens:** Pending requests reject with `ConnectionClosedError`. Messages still in queue are discarded.

### Request Delivery Guarantees

`send()` offers **best-effort delivery**: message is queued offline but may not survive reconnection without explicit idempotency handling:

```typescript
// Not guaranteed if connection lost before delivery
client.send(Message, payload);

// For at-least-once semantics, use request/response
const reply = await client.request(Query, payload, Response);
```

**Pattern:** If you need guaranteed delivery, wrap in application-level retry with idempotency key:

```typescript
const idempotencyKey = crypto.randomUUID();
for (let i = 0; i < 3; i++) {
  try {
    await client.request(PaymentRequest, { idempotencyKey, ...payload }, PaymentReply);
    break; // Success
  } catch (err) {
    if (err instanceof TimeoutError && i < 2) {
      // Retry with same key (server deduplicates)
      continue;
    }
    throw;
  }
}
```

**Server-side:** See [Advanced Usage - Error Recovery & Idempotency](./advanced-usage.md#error-recovery--idempotency) for implementation details on server-side deduplication caching.

### Reconnection and Auto-Connect

By default, client auto-connects when you `send()` or `request()`. For explicit control:

```typescript
// Explicit connection management
const client = wsClient({ autoConnect: false });
await client.connect();

// After manual close(), auto-connect is permanently disabled
await client.close();

// To reconnect, call connect() again explicitly
await client.connect();
```

**Note:** Infinite reconnection attempts run forever unless you call `close()`. For graceful degradation, consider explicit retry limits:

```typescript
let attempts = 0;
const maxAttempts = 5;

client.onState((state) => {
  if (state === "closed") {
    attempts++;
    if (attempts > maxAttempts) {
      console.error("Max reconnection attempts exceeded");
      // Handle offline state
    }
  } else if (state === "open") {
    attempts = 0; // Reset on successful connection
  }
});
```

### Pending Request Limits

By default, max 1000 pending requests can accumulate. Once exceeded, new `request()` calls reject with `StateError`:

```typescript
try {
  const reply = await client.request(Query, payload, Response);
} catch (err) {
  if (err instanceof StateError) {
    console.error("Too many pending requests");
    // Server may be slow or unreachable
  }
}
```

### Protocol Negotiation

Use `client.protocol` to validate server-selected subprotocol after connection:

```typescript
await client.connect();

if (client.protocol === "bearer.v1") {
  console.log("Server authenticated request");
} else if (!client.protocol) {
  console.warn("No subprotocol negotiated");
}
```

This is useful for feature version negotiation or auth validation.

### Queue Overflow Handling

With `queue: "drop-newest"` (default), oldest messages survive overflow. Use `onError()` to detect drops:

```typescript
client.onError((error, context) => {
  if (context.type === "overflow") {
    console.warn("Queue full, newest message dropped");
    // Send higher-priority message or reduce send frequency
  }
});
```

**Decision:** Choose queue mode based on priority:

- `drop-newest` (default): Keep older, possibly critical messages
- `drop-oldest`: Keep fresh data, discard stale updates
- `off`: Fail fast, handle offline state explicitly

### Streaming Responses with Progress Updates

For long-running server operations, receive progress updates before the final response using the `onProgress` callback:

```typescript
const response = await client.request(Query, payload, Response, {
  timeoutMs: 60_000,
  onProgress: (data) => {
    // Server sent a progress update
    console.log("Progress:", data);
    // Update UI, progress bar, etc.
  },
});

// Eventually resolves with terminal response
console.log("Final result:", response.payload);
```

**How it works:**

- Server sends non-terminal progress messages of type `$ws:rpc-progress`
- Each progress message passes its `data` field to `onProgress`
- Request continues waiting until server sends terminal response (final message type)
- Final response resolves the promise

**Use cases:**

- File uploads/downloads with progress
- Long-running computations with status updates
- Streaming data with periodic batches
- Async job status polling

**Notes:**

- Progress messages don't settle the promise; request waits for terminal response
- If server never sends terminal response, request times out (respects `timeoutMs`)
- `onProgress` errors are logged to console but don't cancel the request

**Server-side:** See [Advanced Usage - RPC Progress & Streaming](./advanced-usage.md#rpc-progress--streaming) to understand how servers send progress updates with `ctx.progress()`.

### Monitoring Connection Health

Combine `onState()` and periodic health checks:

```typescript
client.onState((state) => {
  if (state === "open") {
    console.log("Connected, ready for requests");
  } else if (state === "closed") {
    console.error("Connection lost");
  }
});

// Periodic health check via ping
const healthCheck = setInterval(async () => {
  if (!client.isConnected) {
    clearInterval(healthCheck);
    return;
  }

  try {
    await client.request(Ping, Pong, { timeoutMs: 5000 });
  } catch (err) {
    console.warn("Health check failed:", err.message);
  }
}, 30_000);
```

## Type Exports

### RpcErrorCode

Standard error codes for RPC operations (gRPC-aligned).

```typescript
type RpcErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENT"
  | "FAILED_PRECONDITION"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "ABORTED"
  | "DEADLINE_EXCEEDED"
  | "RESOURCE_EXHAUSTED"
  | "UNAVAILABLE"
  | "UNIMPLEMENTED"
  | "INTERNAL"
  | "CANCELLED"
  | string; // Extensible for custom codes
```

## Type Utilities

### InferMessage

Extract full message type from schema.

```typescript
import { z, message } from "@ws-kit/zod";
import type { InferMessage } from "@ws-kit/zod";

const HelloOk = message("HELLO_OK", { text: z.string() });

type HelloOkMessage = InferMessage<typeof HelloOk>;
// { type: "HELLO_OK", meta: { timestamp?: number }, payload: { text: string } }
```

### InferPayload

Extract payload type from schema.

```typescript
import { z, message } from "@ws-kit/zod";
import type { InferPayload } from "@ws-kit/zod";

const Hello = message("HELLO", { name: z.string() });

type HelloPayload = InferPayload<typeof Hello>;
// { name: string }
```

### InferMeta

Extract meta type from schema.

```typescript
import { z, message } from "@ws-kit/zod";
import type { InferMeta } from "@ws-kit/zod";

const RoomMsg = message(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta
);

type RoomMeta = InferMeta<typeof RoomMsg>;
// { roomId: string }
```
