# Client API Reference

Complete API documentation for the browser WebSocket client.

::: tip
For complete type definitions and implementation details, see the [Client Specification](./specs/client.md).
:::

::: info
**Topic subscription methods** (`subscribe()`, `unsubscribe()`) are not yet implemented. See [Client Specification](./specs/client.md) for planned features.
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

**Never throws** - Use return value to detect failures

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
  }
): Promise<InferMessage<R>>
```

**Note:** RPC schemas created with the `rpc()` helper automatically bind the response type. When using `client.request(rpcSchema, payload, options)`, the response type is auto-detected from the RPC schema, eliminating the need for an explicit response schema parameter.

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

## Error Classes

### ValidationError

Validation failure (outbound or inbound).

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string[]; message: string }>
  );
}
```

### TimeoutError

Request timeout.

```typescript
class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number);
}
```

### ServerError

Server-sent error response (legacy - prefer RpcError for new code).

```typescript
class ServerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  );
}
```

### RpcError

Enhanced RPC error from server with retry hints.

```typescript
class RpcError<TCode extends RpcErrorCode = RpcErrorCode> extends Error {
  constructor(
    message: string,
    public readonly code: TCode,
    public readonly details?: unknown,
    public readonly retryable?: boolean,
    public readonly retryAfterMs?: number,
    public readonly correlationId?: string
  );
}
```

**Standard Error Codes:**

Terminal errors (don't auto-retry):

- `UNAUTHENTICATED` - Missing or invalid authentication
- `PERMISSION_DENIED` - Authenticated but insufficient permissions
- `INVALID_ARGUMENT` - Input validation failed
- `FAILED_PRECONDITION` - Stateful precondition not met
- `NOT_FOUND` - Resource does not exist
- `ALREADY_EXISTS` - Uniqueness or idempotency violation
- `ABORTED` - Concurrency conflict (race condition)

Transient errors (retry with backoff):

- `DEADLINE_EXCEEDED` - RPC timed out
- `RESOURCE_EXHAUSTED` - Rate limit, quota, or buffer overflow
- `UNAVAILABLE` - Transient infrastructure error

Server/evolution:

- `UNIMPLEMENTED` - Feature not supported or deployed
- `INTERNAL` - Unexpected server error (unhandled exception)
- `CANCELLED` - Call cancelled (client disconnect, abort)

See [Error Handling Spec](./specs/error-handling.md) for complete list.

### ConnectionClosedError

Connection closed before reply.

```typescript
class ConnectionClosedError extends Error {}
```

### StateError

Invalid state for operation.

```typescript
class StateError extends Error {
  constructor(message: string);
}
```

### WsDisconnectedError

Connection disconnected during RPC request.

```typescript
class WsDisconnectedError extends Error {
  constructor(message?: string);
}
```

Thrown when socket closes while request is in-flight and no idempotencyKey is provided (or reconnect window expires without reconnecting).

**Usage:**

```typescript
import {
  ValidationError,
  TimeoutError,
  ServerError,
  RpcError,
  ConnectionClosedError,
  StateError,
  WsDisconnectedError,
} from "@ws-kit/client";

try {
  const reply = await client.request(Hello, { name: "test" }, HelloOk);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn(`Timeout after ${err.timeoutMs}ms`);
  } else if (err instanceof RpcError) {
    console.error(`RPC error: ${err.code}`, err.details);
    if (err.retryable && err.retryAfterMs) {
      // Wait and retry
      await new Promise((r) => setTimeout(r, err.retryAfterMs));
    }
  } else if (err instanceof ServerError) {
    console.error(`Server error: ${err.code}`, err.context);
  } else if (err instanceof WsDisconnectedError) {
    console.warn("Disconnected during request");
  }
}
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
// { timestamp?: number, roomId: string }
```
