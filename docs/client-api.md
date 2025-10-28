# Client API Reference

Complete API documentation for the browser WebSocket client.

::: tip
For complete type definitions and implementation details, see the [Client Specification](https://github.com/kriasoft/ws-kit/blob/main/specs/client.md).
:::

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

**Returns:** Unsubscribe function

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

// Remove handler
unsubscribe();
```

### send()

Send fire-and-forget message.

```typescript
// With payload
send<S extends AnyMessageSchema>(
  schema: S,
  payload: InferPayload<S>,
  opts?: { meta?: InferMeta<S>; correlationId?: string }
): boolean

// Without payload (if schema has no payload)
send<S extends AnyMessageSchema>(
  schema: S,
  opts?: { meta?: InferMeta<S>; correlationId?: string }
): boolean
```

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
// With payload
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

// Without payload (if schema has no payload)
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

**Returns:** Promise resolving to reply message

**Rejects with:**

- `ValidationError`: Invalid payload or malformed reply
- `TimeoutError`: No reply within timeout
- `ServerError`: Server sent error response
- `ConnectionClosedError`: Connection closed before reply
- `StateError`: Aborted via signal or pending limit exceeded

**Never throws synchronously** - Always returns a Promise

**Example:**

```typescript
try {
  const reply = await client.request(Hello, { name: "Anna" }, HelloOk, {
    timeoutMs: 5000,
  });
  console.log(reply.payload.text);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn("Timeout");
  }
}

// With AbortSignal
const controller = new AbortController();
const promise = client.request(Hello, { name: "Bob" }, HelloOk, {
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

Server-sent error response.

```typescript
class ServerError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly context?: Record<string, unknown>
  );
}
```

### ConnectionClosedError

Connection closed before reply.

```typescript
class ConnectionClosedError extends Error {}
```

### StateError

Invalid state for operation.

```typescript
class StateError extends Error {}
```

**Usage:**

```typescript
import {
  ValidationError,
  TimeoutError,
  ServerError,
  ConnectionClosedError,
  StateError,
} from "@ws-kit/client";

try {
  const reply = await client.request(Hello, { name: "test" }, HelloOk);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn(`Timeout after ${err.timeoutMs}ms`);
  } else if (err instanceof ServerError) {
    console.error(`Server error: ${err.code}`, err.context);
  }
}
```

## Type Utilities

### InferMessage

Extract full message type from schema.

```typescript
import type { InferMessage } from "@ws-kit/zod";

const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

type HelloOkMessage = InferMessage<typeof HelloOk>;
// { type: "HELLO_OK", meta: { timestamp?: number }, payload: { text: string } }
```

### InferPayload

Extract payload type from schema.

```typescript
import type { InferPayload } from "@ws-kit/zod";

type HelloPayload = InferPayload<typeof Hello>;
// { name: string }
```

### InferMeta

Extract meta type from schema.

```typescript
import type { InferMeta } from "@ws-kit/zod";

const RoomMsg = messageSchema(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta
);

type RoomMeta = InferMeta<typeof RoomMsg>;
// { timestamp?: number, roomId: string }
```
