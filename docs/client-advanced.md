# Advanced Usage

Advanced patterns for reconnection, queueing, request/response, and auto-connection.

## Reconnection

The client automatically reconnects on connection loss with exponential backoff.

### Basic Reconnection

```typescript
import { wsClient } from "@ws-kit/client/zod"; // ✅ Typed client

const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: {
    enabled: true, // default: true
    maxAttempts: Infinity, // default: Infinity
    initialDelayMs: 300, // default: 300
    maxDelayMs: 10000, // default: 10000
    jitter: "full", // default: "full"
  },
});
```

### Backoff Algorithm

The client uses exponential backoff with configurable jitter:

```typescript
// Delay calculation
delay = min(maxDelayMs, initialDelayMs × 2^(attempt-1))

// Jitter options:
// - "full": random(0, delay)  // Prevents thundering herd
// - "none": delay              // Deterministic (testing)
```

**Example delays (defaults):**

- Attempt 1: 0-300ms (random)
- Attempt 2: 0-600ms
- Attempt 3: 0-1200ms
- Attempt 7+: 0-10000ms (capped)

### Monitor Reconnection State

```typescript
client.onState((state) => {
  switch (state) {
    case "connecting":
      console.log("Initial connection attempt");
      break;

    case "reconnecting":
      console.log("Waiting before reconnect");
      break;

    case "open":
      console.log("Connected!");
      break;

    case "closed":
      console.log("Disconnected");
      break;
  }
});
```

### Disable Reconnection

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: { enabled: false }, // No auto-reconnect
});

// Manual reconnection
client.onState((state) => {
  if (state === "closed") {
    setTimeout(() => client.connect(), 5000);
  }
});
```

### Limited Reconnection Attempts

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: {
    enabled: true,
    maxAttempts: 5, // Stop after 5 attempts
  },
});

client.onState((state) => {
  if (state === "closed") {
    console.log("Gave up after 5 attempts");
    showOfflineUI();
  }
});
```

## Message Queueing

Queue messages when offline for delivery when reconnected.

### Queue Modes

```typescript
type QueueMode = "drop-oldest" | "drop-newest" | "off";
```

**`drop-newest`** (default) - Queue until full, reject new messages:

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  queue: "drop-newest", // default
  queueSize: 1000, // default: 1000
});

// When offline and queue full
const sent = client.send(ChatMessage, { text: "Hello" });
if (!sent) {
  console.warn("Queue full, message dropped");
}
```

**`drop-oldest`** - Queue until full, evict oldest:

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  queue: "drop-oldest",
  queueSize: 1000,
});

// When offline and queue full
client.send(ChatMessage, { text: "New message" });
// Oldest message evicted, new message queued
```

**`off`** - Drop immediately when offline:

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  queue: "off", // No queueing
});

// When offline
const sent = client.send(ChatMessage, { text: "Hello" });
// sent === false (dropped immediately)
```

### Queue Overflow Handling

```typescript
client.onError((error, context) => {
  if (context.type === "overflow") {
    console.warn("Queue overflow, message dropped");
    showWarning("Too many pending messages");

    // Track metrics
    metrics.increment("ws.queue.overflow");
  }
});
```

### Custom Queue Size

```typescript
// Large queue for high-volume apps
const client = createClient({
  url: "wss://api.example.com/ws",
  queue: "drop-oldest",
  queueSize: 5000, // 5000 messages
});

// Small queue for low-latency apps
const client = createClient({
  url: "wss://api.example.com/ws",
  queue: "drop-newest",
  queueSize: 100, // 100 messages
});
```

## Request/Response

Advanced request/response patterns with correlation, timeout, and cancellation.

### Basic Request

```typescript
try {
  const reply = await client.request(Hello, { name: "Anna" }, HelloOk, {
    timeoutMs: 5000,
  });

  console.log("Reply:", reply.payload.text);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.warn("Request timed out");
  }
}
```

### Custom Correlation ID

```typescript
const correlationId = `req-${Date.now()}`;

const reply = await client.request(Hello, { name: "Anna" }, HelloOk, {
  correlationId,
  timeoutMs: 5000,
});

console.log("Reply to:", correlationId);
```

### Request Cancellation

Use `AbortSignal` for cancellable requests:

```typescript
const controller = new AbortController();

const promise = client.request(Hello, { name: "Anna" }, HelloOk, {
  signal: controller.signal,
  timeoutMs: 30000,
});

// Cancel after 2 seconds
setTimeout(() => controller.abort(), 2000);

try {
  const reply = await promise;
} catch (err) {
  if (err instanceof StateError) {
    console.log("Request cancelled");
  }
}
```

### Component Unmount Cancellation

```typescript
// React example
useEffect(() => {
  const controller = new AbortController();

  async function fetchData() {
    try {
      const reply = await client.request(GetData, { id: 123 }, GetDataOk, {
        signal: controller.signal,
      });
      // Update state with the reply payload
      setState(reply.payload);
    } catch (err) {
      if (!(err instanceof StateError)) {
        console.error(err);
      }
    }
  }

  fetchData();

  // Cancel on unmount
  return () => controller.abort();
}, []);
```

### Pending Request Limit

Prevent memory leaks with bounded pending requests:

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  pendingRequestsLimit: 1000, // default: 1000
});

// When limit exceeded
try {
  await client.request(Hello, { name: "test" }, HelloOk);
} catch (err) {
  if (err instanceof StateError) {
    console.warn("Too many pending requests");
    // Add application-level throttling
  }
}
```

### Timeout Behavior

Timeout starts when message is **sent** (not queued):

```typescript
// Timeout starts after connection opens
client.connect();
client.request(Hello, { name: "test" }, HelloOk, {
  timeoutMs: 5000, // 5s after message sent, not after request() call
});

// If offline, timeout starts after reconnect + send
client.request(Hello, { name: "test" }, HelloOk, {
  timeoutMs: 5000, // 5s after message actually sent
});
```

## Auto-Connection

Lazy connection initialization for simpler code.

### Enable Auto-Connect

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  autoConnect: true, // Auto-connect on first operation
});

// No explicit connect() needed
client.send(Hello, { name: "Anna" }); // Triggers connection
```

### Auto-Connect Behavior

**Triggers on:**

- First `send()` when `state === "closed"` and never connected
- First `request()` when `state === "closed"` and never connected

**Does NOT trigger:**

- After manual `close()` (requires explicit `connect()`)
- When already connected or connecting

### Error Handling with Auto-Connect

```typescript
const client = createClient({
  url: "wss://api.example.com/ws",
  autoConnect: true,
});

// send() - auto-connect failure returns false
const sent = client.send(Hello, { name: "Anna" });
if (!sent) {
  console.warn("Auto-connect failed or message dropped");
}

// request() - auto-connect failure rejects Promise
try {
  const reply = await client.request(Hello, { name: "Anna" }, HelloOk);
} catch (err) {
  console.error("Auto-connect or request failed:", err);
}
```

### When to Use Auto-Connect

**✅ Good for:**

- Prototypes and demos
- Single connection lifecycle apps
- Simplified UI code

**❌ Avoid for:**

- Complex connection lifecycle control
- Explicit connection error handling
- Apps requiring manual reconnect after close

## Extended Meta Fields

Use extended meta for additional message context.

### Define Schema with Extended Meta

```typescript
import { z, message } from "@ws-kit/zod";

// Required meta field
const RoomMessage = message(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta
);

// Optional meta field
const NotifyMessage = message(
  "NOTIFY",
  { text: z.string() },
  { priority: z.enum(["low", "high"]).optional() },
);
```

### Send with Extended Meta

```typescript
// Required meta
client.send(
  RoomMessage,
  { text: "Hello" },
  {
    meta: { roomId: "general" },
  },
);

// Optional meta
client.send(NotifyMessage, { text: "Alert" }); // OK
client.send(
  NotifyMessage,
  { text: "Alert" },
  {
    meta: { priority: "high" },
  },
);

// With correlationId
client.send(
  RoomMessage,
  { text: "Hello" },
  {
    meta: { roomId: "general" },
    correlationId: "msg-123",
  },
);
```

### Type Safety

TypeScript enforces required meta fields:

```typescript
// ✅ Compiles
client.send(
  RoomMessage,
  { text: "Hi" },
  {
    meta: { roomId: "general" },
  },
);

// ❌ Type error - missing required roomId
client.send(RoomMessage, { text: "Hi" });

// ✅ Optional meta can be omitted
client.send(NotifyMessage, { text: "Hi" });
```

## Multiple Handlers

Register multiple handlers for the same message type.

### Handler Order

Handlers execute in registration order:

```typescript
const unsub1 = client.on(HelloOk, (msg) => {
  console.log("Handler 1:", msg.payload.text);
});

const unsub2 = client.on(HelloOk, (msg) => {
  console.log("Handler 2:", msg.payload.text);
});

// When HelloOk arrives:
// Handler 1: ...
// Handler 2: ...
```

### Handler Error Isolation

Handler errors don't stop other handlers:

```typescript
client.on(HelloOk, (msg) => {
  throw new Error("Handler 1 error");
  // Logged to console.error
});

client.on(HelloOk, (msg) => {
  console.log("Handler 2 still runs!");
});
```

### Unsubscribe During Dispatch

Unsubscribing during dispatch doesn't affect current cycle:

```typescript
let unsub2: () => void;

client.on(HelloOk, (msg) => {
  console.log("Handler 1");
  unsub2(); // Remove handler 2
});

unsub2 = client.on(HelloOk, (msg) => {
  console.log("Handler 2"); // Still runs this cycle
});

// Next message: only handler 1 runs
```

## Unhandled Messages

Handle messages with no registered schema.

### Basic Usage

```typescript
client.onUnhandled((msg) => {
  console.warn("Unhandled message type:", msg.type);
  console.log("Payload:", msg.payload);

  // Graceful degradation
  if (msg.type === "NEW_FEATURE") {
    console.log("Update app to use new feature");
  }
});
```

### Contract

`onUnhandled()` receives:

- Structurally valid messages: `{ type: string, meta?: object, payload?: any }`
- Messages with no registered schema
- **Never** receives invalid messages (dropped before routing)

### Use Cases

**Version mismatch handling:**

```typescript
client.onUnhandled((msg) => {
  if (msg.type.startsWith("V2_")) {
    showUpdatePrompt("New version available");
  }
});
```

**Debug logging:**

```typescript
if (process.env.NODE_ENV === "development") {
  client.onUnhandled((msg) => {
    console.log("Unhandled:", msg.type, msg.payload);
  });
}
```

**Protocol negotiation:**

```typescript
const supportedTypes = new Set(["HELLO", "CHAT", "NOTIFY"]);

client.onUnhandled((msg) => {
  if (!supportedTypes.has(msg.type)) {
    console.warn(`Server sent unsupported type: ${msg.type}`);
  }
});
```

## Testing Patterns

### Fake WebSocket

Use `wsFactory` for dependency injection:

```typescript
import { createClient } from "@ws-kit/client/zod";

class FakeWebSocket {
  readyState = WebSocket.CONNECTING;

  constructor(public url: string) {}

  send(data: string) {
    console.log("Fake send:", data);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }
}

const client = createClient({
  url: "ws://test",
  wsFactory: (url) => new FakeWebSocket(url) as any,
});
```

### Deterministic Backoff

Use `jitter: "none"` for predictable reconnection in tests:

```typescript
const client = createClient({
  url: "ws://test",
  reconnect: {
    enabled: true,
    jitter: "none", // Deterministic delays
    initialDelayMs: 100,
    maxDelayMs: 1000,
  },
});

// Delays: 100, 200, 400, 800, 1000, 1000...
```
