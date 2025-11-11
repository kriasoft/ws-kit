# @ws-kit/redis-pubsub

Redis-based PubSub adapter for WS-Kit, enabling cross-process broadcasting for multi-server deployments.

## Purpose

Use this adapter when you need to broadcast messages across multiple WS-Kit server instances (e.g., Bun clusters, load-balanced deployments, Kubernetes pods). Each instance connects to a shared Redis server and automatically receives and delivers messages to all subscribers.

## When to Use

✅ **Good fit for:**

- Multi-instance Bun clusters behind a load balancer
- Node.js cluster deployments
- Horizontal scaling with stateless server instances
- Real-time features requiring cross-instance messaging
- Multi-tenant applications with Redis as coordination layer

❌ **Not needed for:**

- Single Bun process (use native `BunPubSub`)
- Cloudflare Durable Objects (use `DurablePubSub`)
- Testing (use `MemoryPubSub`)

## Installation

```bash
bun add @ws-kit/core @ws-kit/redis-pubsub redis
```

Required packages:

- `@ws-kit/core` — Core router and types
- `@ws-kit/redis-pubsub` — This adapter
- `redis` — Redis client (v4.6.0+ or v5.9.0+)

## Runtime Support

- **Node.js**: ≥ 22
- **Bun**: ≥ 1.1 (with Node-compat enabled)
- **Redis client**: ≥ 4.6.0

## Quick Start

### Recommended: With Bun

Use `@ws-kit/bun` with Redis PubSub for the simplest integration:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";

// Create router with Redis PubSub for multi-instance broadcasting
const router = createRouter({
  pubsub: createRedisPubSub({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  }),
});

// Define message schemas
const ChatMessage = message("CHAT", {
  userId: z.string(),
  text: z.string(),
});

// Register handler
router.on(ChatMessage, async (ctx) => {
  // This broadcasts to all instances
  await router.publish("chat:general", ChatMessage, {
    userId: ctx.payload.userId,
    text: ctx.payload.text,
  });
});

// Serve with type-safe handlers
serve(router, { port: 3000 });
```

### Advanced: Direct Router Construction

For lower-level control, construct the router directly:

```typescript
import { WebSocketRouter } from "@ws-kit/core";
import { createBunAdapter } from "@ws-kit/bun";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import { z, message, zodValidator } from "@ws-kit/zod";

const router = new WebSocketRouter({
  platform: createBunAdapter(),
  validator: zodValidator(),
  pubsub: createRedisPubSub({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  }),
});

const ChatMessage = message("CHAT", {
  userId: z.string(),
  text: z.string(),
});

router.on(ChatMessage, async (ctx) => {
  await router.publish("chat:general", ChatMessage, {
    userId: ctx.payload.userId,
    text: ctx.payload.text,
  });
});
```

## Semantics (Key Guarantees)

Before using this adapter, understand its delivery model. These are **non-negotiable design decisions**:

### Delivery Model

- **At-least-once**: Messages may be redelivered on reconnect
- **Per-channel FIFO**: Messages on the same channel are ordered; unordered across channels
- **Unordered on reconnect**: Reconnections don't preserve order across instances
- **Fail-fast publish**: Publishing while disconnected rejects immediately (no buffering)
  - **Why**: Prevents silent message loss, eliminates unbounded memory growth, keeps semantics predictable
  - **Alternative**: Use `publishWithRetry()` for automatic backoff, or buffer at application layer

### Serialization Contract

- **Default (`"json"`)**: `JSON.stringify` on send, `JSON.parse` on receive (all types, including strings, are quoted)
- **Text mode (`"text"`)**: Only strings allowed; non-strings throw `SerializationError`
- **Binary mode (`"binary"`)**: Expects `Buffer` or `Uint8Array`; encoded as base64 on wire
- **Custom**: User-provided `{ encode, decode }` replaces defaults entirely

Example:

```typescript
// JSON mode (default)
await pubsub.publish("ch", "hello"); // Wire: "\"hello\""
// On receive: "hello" (string)

// Text mode
const pubsub = createRedisPubSub({ serializer: "text" });
await pubsub.publish("ch", "hello"); // Wire: "hello"
await pubsub.publish("ch", 42); // ERROR: SerializationError

// Binary mode (for raw bytes)
const pubsub = createRedisPubSub({ serializer: "binary" });
await pubsub.publish("ch", Buffer.from("data")); // Wire: base64-encoded
```

### Lifecycle Ownership

- **User-owned client** (`client` option): You own cleanup; RedisPubSub never calls `quit()`
- **Created client** (default): RedisPubSub creates and owns cleanup via `close()`
- **After `close()`**: All operations reject with `DisconnectedError { retryable: false }`

## Configuration

Choose **one** connection method:

```typescript
// Option 1: URL (recommended)
createRedisPubSub({ url: "redis://username:password@localhost:6379/0" });

// Option 2: Pre-configured client (you own cleanup)
import { createClient } from "redis";
const client = createClient({
  /* your options */
});
await client.connect();
createRedisPubSub({ client });
```

Full configuration options:

```typescript
createRedisPubSub({
  // Connection (choose ONE)
  url: "redis://localhost:6379",  // Single source of truth for all connection params
  // OR
  client: redisClient,            // User-owned Redis client (RedisPubSub calls duplicate())

  // Namespace for multi-tenancy (default: "")
  namespace: "myapp:prod",

  // Message serialization (default: "json")
  serializer: "json" | "text" | "binary" | {
    encode: (msg: unknown) => string;
    decode: (s: string) => unknown;
  },

  // Reconnection behavior (exponential backoff + jitter)
  retry: {
    initialMs: 100,         // Initial delay (default: 100)
    factor: 2,              // Backoff multiplier (default: 2)
    maxMs: 30_000,          // Max delay cap (default: 30_000)
    maxAttempts: "infinite", // Max attempts (default: "infinite")
    jitter: "full",         // "full" | "none" | "decorrelated" (default: "full")
  },

  // Safety limit (default: Infinity)
  maxSubscriptions: 1000,

  // Optional observability (no logs by default)
  logger: {
    info: console.log,
    warn: console.warn,
    error: console.error,
  },

  // Optional custom error classification for retry decisions
  isRetryable: (err) => undefined, // Return true/false to override default logic
});
```

## Core Invariants

These invariants help AI reasoning about correctness and are strictly enforced:

1. **No silent failures**: If `publish()` succeeds, message reached Redis. If it throws, message never sent.
2. **Subscriptions are stateful**: `desiredChannels` persist across reconnects; auto-resubscription happens automatically.
3. **Publish is transactional**: No buffering; fail-fast on disconnect. Use `publishWithRetry()` or app-layer buffering for resilience.
4. **No double-prefixing**: If namespace is set, channels starting with `namespace:` are rejected (fail-fast), forcing use of `ns()` helper or correct composition.
5. **`ready()` waits for ACK**: Both `sub.ready` and `pubsub.ready()` resolve after Redis confirms (not after data received).
6. **Two connections required**: `publish()` and `subscribe()` use separate connections (Redis protocol constraint); single connection is a fatal bug.
7. **Idempotent cleanup**: `sub.unsubscribe()`, `pubsub.close()`, and event unsubscribe functions are safe to call multiple times.

## Semantics & Invariants

**Document your assumptions—these are non-negotiable:**

### Message Delivery

- **At-least-once** (not exactly-once): Reconnects may replay messages. Handlers must be idempotent.
- **Per-channel FIFO only**: Order is guaranteed per channel. Across channels or after reconnect: undefined order.
- **Fail-fast publish**: No buffering. Disconnected `publish()` rejects immediately with retryable error. Use `publishWithRetry()` for automatic handling.

### Subscription Semantics

- **`sub.ready` resolves after Redis ACK**, not after the first message. Safe to assume Redis knows about the subscription after awaiting `ready`. Why: Allows bootstrapping logic to wait for subscriptions to be active before sending data.
- **Reconnections re-subscribe automatically** (no API call needed): `desiredChannels` persist across disconnects; `confirmedChannels` are cleared **immediately on error** (not on 'end' event) to prevent stale state and fail-fast on queries. Why: Subscriptions are **stateful** (we own the state); publish is **transactional** (we don't buffer). This asymmetry is intentional—subscriptions auto-restore because they represent application intent; publish fails fast to prevent silent loss.
- **Pattern vs. exact subscriptions are independent**: Both `subscribe()` and `psubscribe()` can be active; no ordering guarantee between them. Why: Redis treats them as separate subscription types; attempting to order them is implementation noise.
- **Idempotent unsubscription**: Calling `sub.unsubscribe()` multiple times is safe; only the first call removes the handler. Why: Simplifies cleanup in error paths and race conditions.

### Serialization Contract

- **No auto-detection**: "json" mode quotes all strings (e.g., `"hello"` becomes `"\"hello\""` on wire). Always match sender/receiver serializers.
- **"text" mode is strict**: Non-strings throw `SerializationError` immediately (not deserialization-time).
- **"binary" mode uses base64**: `Buffer` and `Uint8Array` are encoded as base64 strings for wire transmission.
- **Custom serializers replace pipeline entirely**: No fallback or composition. If you need multiple formats, encode it in the message itself.

### Lifecycle & Ownership

- **Two connections required by Redis protocol**: `publish()` and `subscribe()` use separate connections. If you pass a client, it must support `duplicate()`.
- **After `close()`**: All operations reject with `DisconnectedError { retryable: false }`. Cannot reconnect; create a new instance.
- **User-owned clients are never quit by RedisPubSub**: You own cleanup if you pass a `client` option.

### State Consistency Under Reconnects

- **`pendingSubs` maps are cleared IMMEDIATELY on error** (not on 'end' event), ensuring `ensureSubscribed()` fails fast if queried during reconnect.
- **Rapid subscribe/unsubscribe churn across reconnects can leave dangling state**: Clean up handlers explicitly; don't rely on implicit cleanup.
- **`inflightPublishes` counter decrements on all exits** (success, error, serialization error, timeout). Use for observability only; not a buffer.

### Jitter Strategy

- **Default is "full" jitter** [0, delay] to prevent thundering herd on reconnect storms. "none" is predictable but risky at scale.
- **Applies to auto-reconnect only**, not to `publishWithRetry()` delays (which use their own policy).

### Namespace Guard

- **Throws `TypeError` if channel is pre-colon-prefixed** when namespace is set (e.g., `subscribe("app:ch")` when `namespace: "app"`).
- **Namespace validation**: Must match `/^[A-Za-z0-9][A-Za-z0-9:_-]*$/`; trailing colons are stripped automatically.
- **Guard prevents silent bugs**: Double-prefixing prevention catches mistakes early. Use `ns()` helper for safe scoping.

### Event Payloads (Strongly Typed)

- **"connect" / "reconnected"**: No payload (`undefined`).
- **"disconnect"**: `{ willReconnect: boolean }` — useful to distinguish permanent vs. temporary disconnects.
- **"reconnecting"**: `{ attempt: number; delayMs: number }` — actual delay (includes jitter), not base backoff.
- **"error"**: Full `Error` object with `.code` and `.retryable` properties.

## Connection Architecture

### Two-Connection Topology (Required)

RedisPubSub always uses **two separate Redis connections**:

1. **Publisher connection** (`publishClient`) — For `publish()` operations
2. **Subscriber connection** (`subscribeClient`) — For `subscribe()` and `psubscribe()` operations

**Why**: Redis protocol forbids publish/subscribe on the same connection. Subscriptions require an exclusive connection; mixing them causes silent failures or data loss. This is non-negotiable and enforced explicitly.

RedisPubSub enforces this automatically:

- If you provide a pre-configured Redis client (v4+), it must support the `duplicate()` method to create a second connection
- If not provided, RedisPubSub creates both connections from the URL
- If `duplicate()` is unavailable, initialization throws `ConfigurationError` (fail-fast, not silent degradation)

**Why fail-fast**: Silently falling back to a single connection would hide the protocol violation and surface as mysterious message loss during reconnects.

Example with a user-owned client:

```typescript
import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379" });
await client.connect();

// RedisPubSub will call client.duplicate() internally for subscriptions
const pubsub = createRedisPubSub({ client });
```

## API Design Decisions

These choices reflect years of distributed systems experience and are documented here for clarity:

### Why `subscribe()` returns a `Subscription` object (not a function)

Returns `{ channel, ready, unsubscribe() }` instead of a bare unsubscribe function.

**Why**: Prevents silent bugs when multiple subscriptions to the same channel coexist. With bare functions, `const off = sub1; const off2 = sub2; off()` is ambiguous—which subscription is removed? With an object, `sub1.unsubscribe()` is explicit and idempotent.

Also enables: accessing `sub.channel` and awaiting `sub.ready` without separate API calls.

Example:

```typescript
const sub1 = pubsub.subscribe("ch", handler1);
const sub2 = pubsub.subscribe("ch", handler2);

sub1.unsubscribe(); // ✅ Clear: removes handler1 only
sub2.unsubscribe(); // ✅ Clear: removes handler2 only
await sub1.ready; // ✅ Wait for ACK
```

### Why `psubscribe()` is separate from `subscribe()`

Patterns are **explicit and separate** to prevent accidental pattern matching:

- `subscribe("user:*")` → exact match on literal string "user:\*" (not a pattern)
- `psubscribe("user:*")` → glob pattern matching "user:123", "user:abc", etc.

**Design Rationale**:

1. **Intent clarity** — Call sites are unambiguous. `psubscribe()` signals "I'm using a pattern"; `subscribe()` signals "I want this exact channel".
2. **Accidental glob prevention** — A typo in `psubscribe("room:*")` won't silently fail as an exact match; developers will catch it immediately.
3. **Redis alignment** — `psubscribe` mirrors Redis terminology, so developers familiar with Redis know what to expect.
4. **Type safety** — No flags to forget. Each method has one clear contract.

Pattern subscriptions use the same `Subscription` object as exact subscriptions, so the API is familiar. Just the method name differs.

### Why `publish()` is fail-fast (no buffering)

Synchronous rejection on disconnect; no queue.

**Why**: Buffering silently hides failures (messages queued but never sent); fail-fast forces you to decide. Either: (a) retry at app layer with your own semantics, (b) use `publishWithRetry()` for transient errors, or (c) use a persistent queue if you need "guaranteed" delivery (pub/sub doesn't provide this anyway).

**Invariant**: `publish()` either completes or throws; it never silently loses messages. If you see no error, the message reached Redis. If you see a retryable error, you can retry (explicitly or via `publishWithRetry()`). If you see a non-retryable error, the message won't succeed (stop retrying).

## API Reference

### Publishing

```typescript
// Publish a message (fails immediately if disconnected)
await pubsub.publish(channel, message);
// → Throws PublishError if publish fails
// → Throws DisconnectedError if not connected (retryable: true initially)
// → Throws SerializationError if message can't be serialized
```

### Subscribing to Exact Channels

```typescript
// Subscribe to an exact channel (returns Subscription object with ready promise)
const sub = pubsub.subscribe<UserEvent>(channel, (msg) => {
  console.log("Received:", msg);
});

// Wait for subscription to be confirmed with Redis (optional)
await sub.ready;
// sub.channel — the channel name
// sub.unsubscribe() — idempotent method to remove handler

// Unsubscribe:
sub.unsubscribe();
```

### Subscribing to Patterns

```typescript
// Subscribe to a channel pattern (glob syntax: *, ?, [...])
// Different method prevents accidental glob subscriptions
const patternSub = pubsub.psubscribe("user:*:messages", (msg, meta) => {
  // meta.channel — the actual matching channel name
  console.log(`Received on ${meta.channel}:`, msg);
});
await patternSub.ready;
patternSub.unsubscribe();
```

### Publish with Automatic Retry

```typescript
// Publish with built-in retry + exponential backoff + jitter
const result = await pubsub.publishWithRetry("notifications", payload, {
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10_000,
  jitter: "full",
  onAttempt: (attempt, delayMs, err) => {
    logger.warn(`Publish attempt ${attempt}, retrying in ${delayMs}ms`, err);
  },
});

// result.capability: "unknown" (Redis pub/sub doesn't report delivery count)
// result.attempts: number of attempts performed
// result.durationMs: total time spent (including retries and delays)
console.log(
  `Published after ${result.attempts} attempts in ${result.durationMs}ms`,
);
```

### Scoped Namespacing

```typescript
// Create a scoped prefix to prevent double-colon accidents
const chat = pubsub.ns("chat");

// All operations automatically prefixed
const sub = chat.subscribe("room:1", handler); // subscribes to "chat:room:1"
await chat.publish("room:1", msg); // publishes to "chat:room:1"

// Nested scoping
const rooms = chat.ns("rooms");
const roomSub = rooms.subscribe("general", handler); // "chat:rooms:general"
```

### Waiting for Single Messages

```typescript
// Wait for a single message on an exact channel and auto-unsubscribe
const msg = await pubsub.once<UserEvent>(channel, { timeoutMs: 5000 });

// Or without timeout
const msg = await pubsub.once(channel);

// Wait for a single message matching a pattern and auto-unsubscribe
const msg = await pubsub.ponce<UserEvent>("user:*:events", {
  timeoutMs: 10000,
});
```

### Connection & Status

```typescript
// Wait for connection to be established
await pubsub.ready();

// Check current status
const status = pubsub.status();
console.log(`Connected: ${status.connected}`);
console.log(`Subscribed channels: ${status.channels.exact.join(", ")}`);
console.log(`Pattern subscriptions: ${status.channels.patterns.join(", ")}`);
console.log(`In-flight publishes: ${status.inflightPublishes}`);
if (status.lastError) {
  console.log(`Last error: ${status.lastError.message}`);
}

// Check if connected now
if (pubsub.isConnected()) {
  await pubsub.publish(channel, msg);
}

// Check if channel has subscribers
if (!pubsub.isSubscribed(channel)) {
  console.warn(`No one is listening to "${channel}"`);
}

// Check if instance is destroyed
if (!pubsub.isDestroyed()) {
  await pubsub.publish(channel, msg);
}
```

### Lifecycle

```typescript
// Establish connection eagerly (optional; normally lazy on first use)
await pubsub.connect();

// Gracefully shutdown (idempotent)
await pubsub.close();
```

### Events

All events are strongly typed for IDE autocomplete:

```typescript
// Listen for connection events (strongly typed)
const offConnect = pubsub.on("connect", () => {
  console.log("Connected to Redis");
});

const offReconnecting = pubsub.on("reconnecting", (info) => {
  // info: { attempt: number; delayMs: number }
  console.log(`Reconnecting in ${info.delayMs}ms (attempt ${info.attempt})`);
});

const offReconnected = pubsub.on("reconnected", () => {
  console.log("Reconnection successful, subscriptions restored");
});

const offDisconnect = pubsub.on("disconnect", (info) => {
  // info: { willReconnect: boolean }
  if (info.willReconnect) {
    console.log("Disconnected (will auto-reconnect)");
  } else {
    console.log("Disconnected permanently (instance destroyed)");
  }
});

const offError = pubsub.on("error", (err) => {
  // err: Error with code, message, retryable flag
  console.error("Redis error:", err.code, err.message);
});

// Stop listening:
offConnect();
offReconnecting();
offReconnected();
offDisconnect();
offError();
```

## Error Handling

All errors extend `PubSubError`:

```typescript
try {
  await pubsub.publish(channel, msg);
} catch (err) {
  if (err instanceof PubSubError) {
    console.error(`${err.code}: ${err.message}`);
    console.error(`Retryable: ${err.retryable}`);

    if (err.code === "PUBLISH_FAILED" && err.retryable) {
      // Transient error (network, etc.); safe to retry
      await retry();
    } else if (err.code === "SERIALIZATION_ERROR") {
      // Permanent error; don't retry
      console.error("Bad message format:", err.cause);
    } else if (err.code === "DISCONNECTED" && !err.retryable) {
      // Instance is destroyed
      throw new Error("PubSub is dead");
    }
  }
}
```

Error codes and meanings:

| Code                         | Meaning                                     | Retryable     | Notes                                          |
| ---------------------------- | ------------------------------------------- | ------------- | ---------------------------------------------- |
| `PUBLISH_FAILED`             | Publish operation failed                    | Depends       | Network errors: yes; invalid channel: no       |
| `SUBSCRIBE_FAILED`           | Subscribe operation failed                  | Depends       | Network errors: yes; bad pattern: no           |
| `SERIALIZATION_ERROR`        | Message can't be serialized                 | **No**        | Fix your message format                        |
| `DESERIALIZATION_ERROR`      | Message can't be deserialized               | **No**        | Handler logic error or bad data                |
| `DISCONNECTED`               | Not connected or destroyed                  | Until destroy | Before destroy: yes; after: no                 |
| `CONFIGURATION_ERROR`        | Invalid configuration or missing capability | **No**        | Redis client must support `duplicate()` method |
| `MAX_SUBSCRIPTIONS_EXCEEDED` | Hit subscription limit                      | **No**        | Increase limit or unsubscribe some             |

## Multi-Tenancy with Namespaces

Namespace all channels for a tenant to avoid collisions:

```typescript
const pubsub = createRedisPubSub({
  url: "redis://localhost:6379",
  namespace: `tenant:${req.tenantId}`, // e.g., "tenant:acme-corp"
});

// Subscribe to "messages" → actually subscribes to "tenant:acme-corp:messages"
pubsub.subscribe("messages", handler);

// Guard against accidents:
pubsub.subscribe("tenant:acme-corp:messages", handler);
// ❌ TypeError: Channel is already namespaced
```

## Pattern Subscriptions

Use `psubscribe()` to subscribe to multiple channels using glob patterns:

**Exact subscriptions** (`subscribe()`) match literal channel names.
**Pattern subscriptions** (`psubscribe()`) match glob patterns (\*, ?, [...]).

The separate method makes intent explicit and prevents accidental pattern matching.

### Pattern Syntax

- `*` — Matches any sequence of characters
- `?` — Matches a single character
- `[abc]` — Matches any character in the set
- `[a-z]` — Matches any character in the range

### Examples

```typescript
// Match any user ID
pubsub.psubscribe("user:*:messages", (msg, meta) => {
  console.log(`Received on ${meta.channel}:`, msg);
});

// Match alphanumeric notifications
pubsub.psubscribe("notif:[a-z0-9]*", (msg, meta) => {
  console.log(`Received on ${meta.channel}:`, msg);
});

// Match multiple levels (Redis glob syntax)
pubsub.psubscribe("system:*:alerts", (msg, meta) => {
  console.log(`Received on ${meta.channel}:`, msg);
});

// Wait for first matching message with timeout
const msg = await pubsub.ponce("room:*/events", { timeoutMs: 10000 });
console.log("First event from any room:", msg);
```

**Important**: Pattern subscriptions are independent from exact subscriptions. If both are active on the same channel, delivery order is undefined.

## Observability

### Logger Sink

Integrate with your logging system:

```typescript
const pubsub = createRedisPubSub({
  url: "redis://localhost:6379",
  logger: {
    info: (msg, data) => myLogger.info(msg, data),
    warn: (msg, data) => myLogger.warn(msg, data),
    error: (msg, data) => myLogger.error(msg, data),
  },
});
```

No logs are emitted by default (quiet mode).

### Status Monitoring

```typescript
setInterval(() => {
  const status = pubsub.status();
  console.log(`
    Connected: ${status.connected}
    Exact subscriptions: ${status.channels.exact.join(", ")}
    Pattern subscriptions: ${status.channels.patterns.join(", ")}
    Inflight publishes: ${status.inflightPublishes}
    Last error: ${status.lastError?.message ?? "none"}
  `);
}, 10_000);
```

## Examples

### Multi-Instance Chat

```typescript
const pubsub = createRedisPubSub({
  url: process.env.REDIS_URL,
  namespace: "chat",
});

const router = createRouter({ pubsub });

router.on(JoinRoom, async (ctx) => {
  const roomId = ctx.payload.roomId;
  // Broadcast to all instances and all connections in this room
  await router.publish(`room:${roomId}`, JoinRoom, ctx.payload);
});

router.on(SendMessage, async (ctx) => {
  // Broadcast to all instances
  await router.publish(`room:${ctx.payload.roomId}`, SendMessage, ctx.payload);
});
```

### Error Handling & Monitoring

```typescript
const pubsub = createRedisPubSub({
  url: process.env.REDIS_URL,
  logger: {
    error: (msg, err) => {
      console.error(`[Redis] ${msg}`, err);
      metrics.redis_errors.inc();
      sentry.captureException(err);
    },
  },
});

pubsub.on("connect", () => {
  console.log("[Redis] Connected");
  metrics.redis_connected.set(1);
});

pubsub.on("disconnect", () => {
  console.log("[Redis] Disconnected (auto-reconnecting)");
  metrics.redis_connected.set(0);
});

process.on("SIGTERM", async () => {
  console.log("[Redis] Shutting down...");
  await pubsub.close();
  process.exit(0);
});
```

## Connection Management

### Automatic Reconnection

RedisPubSub automatically reconnects with exponential backoff:

- Initial delay: 100ms
- Doubles each attempt: 200ms, 400ms, 800ms, 1.6s, ...
- Capped at `maxMs` (default: 30 seconds)
- Unlimited retries by default (`maxAttempts: "infinite"`)

```typescript
const pubsub = createRedisPubSub({
  url: "redis://localhost:6379",
  retry: {
    initialMs: 100,
    factor: 2,
    maxMs: 60_000, // Cap at 60 seconds
    maxAttempts: 10, // Stop after 10 attempts (optional)
  },
});
```

### Graceful Shutdown

Always call `close()` when shutting down:

```typescript
const pubsub = createRedisPubSub({ url: "redis://localhost:6379" });
const router = createRouter({ pubsub });

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await pubsub.close();
  process.exit(0);
});
```

Subsequent calls to `close()` are safe and idempotent. All operations after `close()` will reject with `DisconnectedError { retryable: false }`.

## Related Packages

- **[@ws-kit/core](https://www.npmjs.com/package/@ws-kit/core)** — Core router and types
- **[@ws-kit/bun](https://www.npmjs.com/package/@ws-kit/bun)** — Bun platform adapter
- **[@ws-kit/cloudflare](https://www.npmjs.com/package/@ws-kit/cloudflare)** — Cloudflare Durable Objects adapter
- **[@ws-kit/zod](https://www.npmjs.com/package/@ws-kit/zod)** — Zod validator
- **[@ws-kit/valibot](https://www.npmjs.com/package/@ws-kit/valibot)** — Valibot validator
- **[@ws-kit/client](https://www.npmjs.com/package/@ws-kit/client)** — Browser/Node.js client

## License

MIT
