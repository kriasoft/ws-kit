# Client API Reference

Complete API documentation for the browser WebSocket client.

## Types

### ClientOptions

Configuration options for creating a client.

```typescript
type ClientOptions = {
  url: string | URL;
  protocols?: string | string[]; // WebSocket subprotocols

  reconnect?: {
    enabled?: boolean; // default: true
    maxAttempts?: number; // default: Infinity
    initialDelayMs?: number; // default: 300
    maxDelayMs?: number; // default: 10_000
    jitter?: "full" | "none"; // default: "full"
  };

  queue?: "drop-oldest" | "drop-newest" | "off"; // default: "drop-newest"
  queueSize?: number; // default: 1000

  autoConnect?: boolean; // default: false

  pendingRequestsLimit?: number; // default: 1000

  auth?: {
    getToken?: () =>
      | string
      | null
      | undefined
      | Promise<string | null | undefined>;
    attach?: "query" | "protocol"; // default: "query"
    queryParam?: string; // default: "access_token"
    protocolPrefix?: string; // default: "bearer."
    protocolPosition?: "append" | "prepend"; // default: "append"
  };

  wsFactory?: (url: string | URL, protocols?: string | string[]) => WebSocket;
};
```

#### Options Details

**`url`** - WebSocket server URL (required)

- Must be a valid `ws://` or `wss://` URL

**`protocols`** - WebSocket subprotocols

- Single protocol: `"chat-v2"`
- Multiple protocols: `["chat-v2", "auth-v1"]`

**`reconnect`** - Automatic reconnection settings

- `enabled`: Enable auto-reconnect (default: `true`)
- `maxAttempts`: Max reconnect attempts (default: `Infinity`)
- `initialDelayMs`: Starting delay (default: `300`)
- `maxDelayMs`: Maximum delay cap (default: `10000`)
- `jitter`: Randomization strategy (default: `"full"`)
  - `"full"`: Random delay between 0 and calculated delay
  - `"none"`: Use exact calculated delay

**`queue`** - Message queueing strategy when offline

- `"drop-newest"` (default): Queue until full, then reject new messages
- `"drop-oldest"`: Queue until full, then evict oldest messages
- `"off"`: Drop all messages immediately when offline

**`queueSize`** - Maximum queue size (default: `1000`)

**`autoConnect`** - Auto-connect on first operation (default: `false`)

- When `true`, first `send()` or `request()` triggers connection
- Does NOT auto-reconnect after manual `close()`

**`pendingRequestsLimit`** - Max concurrent pending requests (default: `1000`)

- Prevents memory leaks if server stops replying
- New requests reject with `StateError` when exceeded

**`auth`** - Authentication configuration

- See [Authentication](/client-auth) for details

**`wsFactory`** - WebSocket factory for testing

- Dependency injection for tests with fake WebSocket

### ClientState

Connection states:

```typescript
type ClientState =
  | "closed" // No connection; initial state
  | "connecting" // Connection attempt in progress
  | "open" // Connected, messages flow
  | "closing" // Graceful disconnect initiated
  | "reconnecting"; // Waiting during backoff delay
```

### WebSocketClient

Main client interface:

```typescript
interface WebSocketClient {
  // State properties
  readonly state: ClientState;
  readonly isConnected: boolean; // Sugar for state === "open"
  readonly protocol: string; // Selected subprotocol

  // Connection methods
  connect(): Promise<void>;
  close(opts?: { code?: number; reason?: string }): Promise<void>;

  // State listeners
  onState(cb: (state: ClientState) => void): () => void;
  onceOpen(): Promise<void>;

  // Message handlers
  on<S extends AnyMessageSchema>(
    schema: S,
    handler: (msg: InferMessage<S>) => void,
  ): () => void;

  // Sending messages
  send<S extends AnyMessageSchema>(
    schema: S,
    payload: InferPayload<S>,
    opts?: { meta?: InferMeta<S>; correlationId?: string },
  ): boolean;

  request<S extends AnyMessageSchema, R extends AnyMessageSchema>(
    schema: S,
    payload: InferPayload<S>,
    reply: R,
    opts?: {
      timeoutMs?: number;
      meta?: InferMeta<S>;
      correlationId?: string;
      signal?: AbortSignal;
    },
  ): Promise<InferMessage<R>>;

  // Hooks
  onUnhandled(cb: (msg: AnyInboundMessage) => void): () => void;
  onError(cb: (error: Error, context: ErrorContext) => void): () => void;
}

type ErrorContext = {
  type: "parse" | "validation" | "overflow" | "unknown";
  details?: unknown;
};
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
send<S extends AnyMessageSchema>(
  schema: S,
  payload: InferPayload<S>,
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
} from "bun-ws-router/client";

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
import type { InferMessage } from "bun-ws-router/zod";

const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

type HelloOkMessage = InferMessage<typeof HelloOk>;
// { type: "HELLO_OK", meta: { timestamp: number }, payload: { text: string } }
```

### InferPayload

Extract payload type from schema.

```typescript
import type { InferPayload } from "bun-ws-router/zod";

type HelloPayload = InferPayload<typeof Hello>;
// { name: string }
```

### InferMeta

Extract meta type from schema.

```typescript
import type { InferMeta } from "bun-ws-router/zod";

const RoomMsg = messageSchema(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta
);

type RoomMeta = InferMeta<typeof RoomMsg>;
// { timestamp: number, roomId: string }
```
