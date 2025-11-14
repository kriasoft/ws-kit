# Adapter Responsibilities

## Overview

WS-Kit supports multiple platform adapters: Bun, Cloudflare Durable Objects, and Deno. Each adapter has specific responsibilities for handling WebSocket lifecycle, message delivery, and state management.

This specification documents the expected behavior and guarantees of each adapter implementation.

## Adapter Responsibility Matrix

| Responsibility                        | Bun                   | Cloudflare DO         | Deno                  | Notes                                   |
| ------------------------------------- | --------------------- | --------------------- | --------------------- | --------------------------------------- |
| **Subscribe/Unsubscribe Persistence** | In-memory Map         | Request-scoped only   | In-memory Map         | See [Pub/Sub Model](#pubsub-model)      |
| **Broadcast Fan-out**                 | Sync (loop)           | Via DO storage        | Sync (loop)           | See [Broadcast](#broadcast)             |
| **Connection Limits**                 | OS-based              | 100 concurrent        | OS-based              | See [Platform Limits](#platform-limits) |
| **Reconnection Handling**             | Client-initiated      | Client-initiated      | Client-initiated      | See [Reconnection](#reconnection)       |
| **Message Ordering**                  | FIFO per connection   | FIFO per connection   | FIFO per connection   | Within single connection guaranteed     |
| **Error Propagation**                 | Via onError hook      | Via onError hook      | Via onError hook      | Unhandled errors logged                 |
| **Cleanup on Disconnect**             | Automatic unsubscribe | Automatic unsubscribe | Automatic unsubscribe | Removes from all topics                 |

## Pub/Sub Model

### Bun Adapter

```typescript
// In-memory topic management
const subscriptions = new Map<string, Set<WebSocket>>();

function subscribe(topic: string, ws: WebSocket) {
  if (!subscriptions.has(topic)) {
    subscriptions.set(topic, new Set());
  }
  subscriptions.get(topic)!.add(ws);
}

function publish(topic: string, message: any) {
  const subscribers = subscriptions.get(topic);
  if (!subscribers) return;

  for (const ws of subscribers) {
    ws.send(JSON.stringify(message));
  }
}

function unsubscribe(topic: string, ws: WebSocket) {
  subscriptions.get(topic)?.delete(ws);
}
```

**Guarantees:**

- ✅ Subscriptions persist for connection lifetime
- ✅ Messages broadcast synchronously to all subscribers
- ✅ Automatic cleanup on disconnect
- ⚠️ **No persistence across server restart** — Subscriptions are in-memory

### Cloudflare Durable Objects Adapter

```typescript
// Request-scoped state (Cloudflare DO specific)
export class WebSocketServer extends DurableObject {
  private subscriptions = new Map<string, Set<WebSocket>>();

  async fetch(req: Request) {
    const ws = await req.webSocket();
    // ...subscribe/publish logic
  }

  subscribe(topic: string, ws: WebSocket) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(ws);
  }

  publish(topic: string, message: any) {
    const subscribers = this.subscriptions.get(topic);
    if (!subscribers) return;

    for (const ws of subscribers) {
      ws.send(JSON.stringify(message));
    }
  }
}
```

**Guarantees:**

- ✅ Subscriptions persist for Durable Object lifetime
- ✅ Single DO instance ensures ordered, reliable delivery
- ✅ Automatic cleanup on disconnect
- ⚠️ **Request-scoped per DO instance** — Load balancing requires routing logic

### Deno Adapter

```typescript
// In-memory topic management (similar to Bun)
const subscriptions = new Map<string, Set<WebSocket>>();

function subscribe(topic: string, ws: WebSocket) {
  if (!subscriptions.has(topic)) {
    subscriptions.set(topic, new Set());
  }
  subscriptions.get(topic)!.add(ws);
}

function publish(topic: string, message: any) {
  const subscribers = subscriptions.get(topic);
  if (!subscribers) return;

  for (const ws of subscribers) {
    ws.send(JSON.stringify(message));
  }
}
```

**Guarantees:**

- ✅ Subscriptions persist for server lifetime
- ✅ Messages broadcast synchronously
- ✅ Automatic cleanup on disconnect
- ⚠️ **No persistence across server restart** — Subscriptions are in-memory

## Adapter Composition with Middleware

For composing and extending adapters with custom behaviors, see [middleware patterns](/middleware) and [`@ws-kit/middleware` package](https://www.npmjs.com/package/@ws-kit/middleware) for production-ready utilities (rate limiting, authentication, logging, etc.).

## Adapter Interfaces

WS-Kit uses adapter patterns for cross-platform features that require atomic semantics. Each feature defines a public interface that adapters implement.

### RateLimiter Adapter

The `RateLimiter` interface defines atomic token consumption for rate limiting across all backends. See [ADR-021: Adapter-First Architecture](../adr/021-adapter-first-architecture.md) for design rationale.

**Interface:**

```typescript
export interface RateLimiter {
  consume(key: string, cost: number): Promise<RateLimitDecision>;
  dispose?(): void;
}

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: number; retryAfterMs: number | null };
```

**Atomicity per Adapter:**

| Adapter             | Mechanism             | Use Case              |
| ------------------- | --------------------- | --------------------- |
| **Memory**          | Per-key mutex         | Dev, single-server    |
| **Redis**           | Lua script            | Multi-pod distributed |
| **Durable Objects** | Single-threaded shard | Cloudflare Workers    |

**Middleware Usage:**

```typescript
const decision = await limiter.consume("user:123:SendMessage", 1);
if (!decision.allowed) {
  ctx.error("RESOURCE_EXHAUSTED", "Rate limited", undefined, {
    retryAfterMs: decision.retryAfterMs,
  });
}
```

**Contract Guarantees:** All adapters must pass tests validating atomicity (no token over-spend under concurrency), multi-key isolation, impossible operations (`retryAfterMs: null`), and deterministic clocks. See `docs/proposals/rate-limiting.md` for complete details.

## Broadcast

### Fan-Out Strategy

All adapters use **synchronous fan-out**:

```typescript
// Pseudocode for all adapters
function publish(topic: string, message: any) {
  const subscribers = getSubscribers(topic); // Platform-specific lookup

  for (const subscriber of subscribers) {
    try {
      subscriber.send(JSON.stringify(message));
    } catch (err) {
      console.error(`Failed to broadcast to ${topic}:`, err);
      // Subscriber is cleaned up elsewhere (e.g., onClose)
    }
  }
}
```

**Guarantees:**

- ✅ All connected subscribers in topic receive message
- ✅ Broadcast completes before `publish()` returns
- ⚠️ **Send failures are logged, not rethrown** — One failed send doesn't block others
- ⚠️ **No ordering guarantee across topics** — Different topics are independent

## Platform Limits

### Bun

```typescript
// Bun has no built-in WS connection limit
// Constrained by OS file descriptor limits (typically 1024 - 10000)

// Typical configuration
Bun.serve({
  port: 3000,
  maxRequestSize: 1024 * 1024, // 1MB
  reusePort: true, // Distribute load across processes
});
```

**Limits:**

- **Concurrent connections**: OS file descriptors (e.g., ulimit -n)
- **Message size**: Configurable, default unlimited
- **Memory**: Linear to connection count (minimal overhead)

### Cloudflare Durable Objects

```typescript
// Cloudflare DO limits
// - Max 100 concurrent WebSocket connections per DO instance
// - Max 1MB message size
// - Max 10MB stored state

export class WebSocketServer extends DurableObject {
  async fetch(req: Request) {
    // Check connection count
    if (this.subscriptions.size >= 100) {
      return new Response("Capacity exceeded", { status: 429 });
    }
    // ...
  }
}
```

**Limits:**

- **Concurrent connections**: 100 per Durable Object instance
- **Message size**: 1MB
- **Stored state**: 10MB per Durable Object
- **Mitigation**: Shard across multiple DO instances by topic

### Deno

```typescript
// Deno has no built-in WS limit
// Constrained by OS resources and Deno runtime

import { serve } from "https://deno.land/std@0.200.0/http/server.ts";

serve(
  async (req) => {
    // Deno's Deno.serve() handles resource limits
    // No explicit per-connection limit
  },
  { hostname: "0.0.0.0", port: 3000 },
);
```

**Limits:**

- **Concurrent connections**: OS-dependent (no hard limit)
- **Message size**: Configurable, default unlimited
- **Memory**: Linear to connection count

## Reconnection

All adapters treat reconnection as a **new connection**:

```typescript
// When client reconnects with same user ID:
// 1. Old connection closed (onClose called, subscriptions cleaned up)
// 2. authenticate() called again
// 3. New connection opened (onOpen called)
// 4. Client must re-subscribe to topics

// ⚠️ IMPORTANT: No automatic subscription recovery
serve(router, {
  onClose(ctx) {
    console.log(`User ${ctx.ws.data?.userId} disconnected`);
    // Subscriptions are cleaned up by adapter
  },
});
```

**Guarantees:**

- ✅ Old connection fully cleaned up before new connection
- ✅ No duplicate messages to same user on reconnect
- ⚠️ **No persistence of subscriptions across reconnects** — Client must resubscribe
- ⚠️ **Messages sent during disconnect are lost** — No queuing by default

**Client Reconnection Pattern:**

```typescript
// Client code (type-safe WebSocket client)
client.on("connected", () => {
  // Reconnected: re-subscribe to all topics
  client.send(SubscribeMessage, { topic: "user:123" });
  client.send(SubscribeMessage, { topic: "room:456" });
});
```

## Message Payload Limits & Monitoring

WS-Kit enforces configurable message payload size limits at the protocol level. This protects against:

- Memory exhaustion from oversized messages
- Protocol violations (Cloudflare DO 1MB limit)
- Resource abuse attacks

### Configuration

```typescript
import { createRouter } from "@ws-kit/zod";

const router = createRouter({
  limits: {
    // Maximum allowed message size in bytes (default: 1MB)
    maxPayloadBytes: 1_000_000,

    // How to respond when client exceeds limit
    onExceeded: "send", // "send" (default) | "close" | "custom"
    // - "send": Send RESOURCE_EXHAUSTED error, keep connection open
    // - "close": Close connection with code 1009 (RFC 6455 "Message Too Big")
    // - "custom": Do nothing (app handles in onLimitExceeded hook)

    // WebSocket close code when onExceeded === "close" (default: 1009)
    closeCode: 1009,
  },

  hooks: {
    onLimitExceeded: async (info) => {
      // Called when a client violates payload limits
      // info.type = "payload" | "rate" | "connections" | "backpressure"
      // info.observed = actual bytes sent
      // info.limit = configured limit
      // info.clientId = client identifier
      // info.ws = WebSocket connection

      // Emit metrics for SLOs
      metrics.histogram("payload_violations", {
        observed: info.observed,
        limit: info.limit,
        clientId: info.clientId,
      });

      // Detect abuse patterns
      const violations = await redis.incr(`violations:${info.clientId}`);
      if (violations > 10) {
        // Ban after 10 violations
        info.ws.close(1008, "POLICY_VIOLATION");
      }
    },
  },
});
```

### Adapter-Specific Limits

| Adapter           | Default Limit | Hard Limit | Notes                        |
| ----------------- | ------------- | ---------- | ---------------------------- |
| **Bun**           | 1MB (config)  | None       | Configurable per router      |
| **Cloudflare DO** | 1MB (config)  | 1MB        | Platform enforces hard limit |
| **Deno**          | 1MB (config)  | None       | Configurable per router      |

### Behavior When Limit Exceeded

| Config                 | Response                    | Connection | Hook Called       |
| ---------------------- | --------------------------- | ---------- | ----------------- |
| `onExceeded: "send"`   | `ERROR: RESOURCE_EXHAUSTED` | Stays open | `onLimitExceeded` |
| `onExceeded: "close"`  | None (closes immediately)   | Closes     | `onLimitExceeded` |
| `onExceeded: "custom"` | None (app decides)          | Stays open | `onLimitExceeded` |

**Note**: Limit violations do NOT call `onError` — they are protocol enforcement, not handler errors.

### Best Practices

1. **Monitor limits** - Use `onLimitExceeded` for metrics and alerts
2. **Size reasonably** - Set limits based on your message types (e.g., 1MB for file uploads, 10KB for chat)
3. **Handle gracefully** - Send clear error messages so clients know to retry with smaller payloads
4. **Detect abuse** - Count violations per client and ban repeat offenders

## Adapter Selection

Choose an adapter based on your deployment model:

| Adapter           | Best For                                      | Drawbacks                               |
| ----------------- | --------------------------------------------- | --------------------------------------- |
| **Bun**           | Single-region servers, tight resource control | No builtin scaling                      |
| **Cloudflare DO** | Global distributed apps, auto-scaling         | 100-connection limit per DO, cost model |
| **Deno**          | General-purpose servers, Deno ecosystem       | Smaller community, fewer integrations   |

## Error Handling Across Adapters

All adapters follow **identical error semantics**. See `docs/specs/error-handling.md` for:

- Standard error codes and schemas
- Type-safe error sending with `ctx.error()`
- [Connection Close Policy](./error-handling.md#connection-close-policy) table (when auto-close occurs)
- Error behavior table (connection state, logging, handler invocation)
- Explicit connection close strategies
- Broadcasting errors to topics

**Key principle**: Application errors do not auto-close connections by default. Only transport/policy violations trigger auto-close (handshake auth failures, payload limits with `onExceeded: "close"`). Handlers must explicitly call `ctx.ws.close()` for business logic decisions. See [Connection Close Policy](./error-handling.md#connection-close-policy) for details.

## Advanced Patterns

### Cloudflare DO Sharding for Pub/Sub

When using Cloudflare Durable Objects with pub/sub, each DO instance is limited to 100 concurrent connections. Shard subscriptions across multiple DO instances by mapping topic names to stable shard IDs.

**Worker entrypoint** (routes incoming requests to sharded DO instances):

```typescript
import { getShardedStub } from "@ws-kit/cloudflare/sharding";

export default {
  async fetch(req: Request, env: Env) {
    // Extract room from URL query param or path
    const url = new URL(req.url);
    const roomId = url.searchParams.get("room") ?? "general";

    // Route to sharded DO based on room ID (stable hash)
    // Same room always goes to same DO instance
    const stub = getShardedStub(env, `room:${roomId}`, 10);

    // Forward HTTP upgrade to the sharded DO
    return stub.fetch(req);
  },
};
```

**Durable Object handler** (WebSocket hub for a shard):

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { createDurableObjectHandler } from "@ws-kit/cloudflare";

// Message schemas
const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const SendMessage = message("SEND_MESSAGE", { text: z.string() });
const RoomBroadcast = message("ROOM_BROADCAST", {
  roomId: z.string(),
  userId: z.string(),
  text: z.string(),
});

type AppData = { userId?: string };

const router = createRouter<AppData>();

// Join: subscribe to room updates
router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data?.userId ?? "anonymous";

  await ctx.topics.subscribe(`room:${roomId}`);
  ctx.assignData({ userId });

  // Notify room members of join
  router.publish(`room:${roomId}`, RoomBroadcast, {
    roomId,
    userId,
    text: `${userId} joined the room`,
  });
});

// Send: broadcast to subscribers
router.on(SendMessage, (ctx) => {
  const userId = ctx.ws.data?.userId ?? "anonymous";
  // Room ID comes from subscription context or connection data
  const roomId = "general"; // In real app, track via ctx.ws.data

  router.publish(`room:${roomId}`, RoomBroadcast, {
    roomId,
    userId,
    text: ctx.payload.text,
  });
});

// Export as Durable Object
export class WebSocketRouter {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(req: Request) {
    const handler = createDurableObjectHandler({
      router,
      authenticate(req) {
        // Extract user from auth header, query param, etc.
        const token = req.headers.get("authorization");
        return token ? { userId: token.replace("Bearer ", "") } : undefined;
      },
    });

    return handler.fetch(req);
  }
}
```

**wrangler.toml configuration** (enable Durable Object binding):

```toml
[[durable_objects.bindings]]
name = "ROUTER"
class_name = "WebSocketRouter"
# Optional: script_name = "ws-kit-example"  # for cross-service routing
```

**Optional: Inline hash without helper** (for reference or custom distribution logic):

```typescript
// Pure function for topic → shard name mapping
function topicToDoName(topic: string, shards: number): string {
  let hash = 0;
  for (let i = 0; i < topic.length; i++) {
    hash = (hash << 5) - hash + topic.charCodeAt(i);
    hash = hash | 0; // 32-bit signed integer
  }
  return `ws-router-${(hash >>> 0) % shards}`;
}

// Usage: compute shard, then get stub
const shardName = topicToDoName(`room:${roomId}`, 10);
const doId = env.ROUTER.idFromName(shardName);
const stub = env.ROUTER.get(doId);
```

**Benefits:**

- ✅ **Linear scaling**: Add more DO instances to handle more concurrent connections
- ✅ **Stable routing**: Same topic always maps to same DO (deterministic hash)
- ✅ **No cross-shard overhead**: Each topic's subscribers live on one DO; broadcasts are free (BroadcastChannel)
- ✅ **Simple distribution**: No external router needed; client directly reaches correct shard

**Important**: Changing shard count (`10` → `20`) remaps existing topics. Plan a migration period if using persistent storage or want to preserve session state across deployments.

## Rate Limiter Adapters

Rate limiting adapters implement atomic token bucket consumption via the `RateLimiter` interface. Each adapter chooses how to achieve atomicity appropriate to its backend.

### RateLimiter Interface

```typescript
export interface RateLimiter {
  /**
   * Atomically consume tokens from a rate limit bucket.
   * @param key - Rate limit key (e.g., "user:123:SendMessage")
   * @param cost - Number of tokens to consume (positive integer)
   * @returns Decision: allowed + remaining tokens, or denied + retry time
   */
  consume(key: string, cost: number): Promise<RateLimitDecision>;

  /**
   * Get the policy configuration for this rate limiter.
   * Required by all adapters for accurate error reporting.
   */
  getPolicy(): Policy;

  /**
   * Optional cleanup on app shutdown
   */
  dispose?(): void | Promise<void>;
}

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      remaining: number;
      retryAfterMs: number | null; // null if cost > capacity
    };
```

### Memory Adapter (`@ws-kit/memory`)

**Best for**: Development, single-instance deployments (Bun, Node.js)

```typescript
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = memoryRateLimiter({
  capacity: 100, // Max tokens available
  tokensPerSecond: 10, // Refill rate
  prefix: "api:", // Optional key namespacing
});

const decision = await limiter.consume("user:123", 1);
if (!decision.allowed) {
  console.log(`Retry after ${decision.retryAfterMs}ms`);
}
```

**Atomicity**: Per-key FIFO mutex ensures only one concurrent `consume()` per key.

**Guarantees**:

- ✅ Atomic token mutation (no race conditions within single instance)
- ✅ Deterministic with clock injection (testable via time-travel)
- ❌ No persistence across restarts
- ❌ No distributed coordination

### Redis Adapter (Future)

**Best for**: Multi-pod production deployments

Uses Lua scripting for atomic read-modify-write on Redis:

```typescript
import { redisRateLimiter } from "@ws-kit/redis";

const limiter = redisRateLimiter(redisClient, {
  capacity: 1000,
  tokensPerSecond: 100,
  prefix: "api:",
});

const decision = await limiter.consume("user:123", 1);
```

**Atomicity**: Lua script runs as single Redis operation (EVALSHA).

**Guarantees**:

- ✅ Atomic across all pods (single Redis operation)
- ✅ Distributed coordination
- ✅ Automatic TTL-based cleanup
- ❌ Network latency (~1-2ms per request)

### Cloudflare Durable Objects Adapter (Future)

**Best for**: Cloudflare Workers with distributed sharding

Uses sharded Durable Objects for high-concurrency distributed rate limiting:

```typescript
import { durableObjectRateLimiter } from "@ws-kit/cloudflare";

const limiter = durableObjectRateLimiter(env.RATE_LIMITER_NAMESPACE, {
  capacity: 500,
  tokensPerSecond: 50,
  shards: 128, // Distribute across 128 DO instances
});

const decision = await limiter.consume("user:123", 1);
```

**Atomicity**: Single-threaded per-shard guarantees; keys hash to shards deterministically.

**Guarantees**:

- ✅ Atomic within shard (single-threaded DO)
- ✅ Distributed coordination across shards
- ✅ Automatic mark-and-sweep cleanup
- ✅ High throughput (parallelism across shards)

## Adapter Contract

All rate limiter adapters must:

1. **Validate policy at factory creation time** — Throw immediately if `capacity < 1` or `tokensPerSecond <= 0`
2. **Expose policy via `getPolicy()`** — Return the policy object; **required** for accurate error reporting in middleware
3. **Implement atomic `consume()`** — No token double-spend, even under concurrency
4. **Return consistent structures** — `{ allowed, remaining, retryAfterMs }` always present (or undefined)
5. **Handle non-monotonic clocks** — Clamp negative elapsed time to 0 (NTP adjustments)
6. **Pass contract tests** — All adapters must pass the shared test suite in `packages/adapters/test/contract.ts`

See **[rate limiting proposal](../proposals/rate-limiting.md)** for complete algorithm and implementation details.

### PubSub Engine Interface

Adapters implement the `PubSub` interface for broadcasting:

```typescript
export interface PubSub {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): Promise<() => Promise<void>>;
  unsubscribe(channel: string): Promise<void>;
}
```

**Adapters:**

- **In-Memory** (`@ws-kit/memory`): Request-scoped, fast (development and single-instance)
- **Cloudflare Durable Objects** (`@ws-kit/cloudflare`): Request-scoped within DO instance (distributed via DO routing)
- **Redis** (`@ws-kit/redis`) (optional): For multi-server scaling and distributed rate limiting

When `@ws-kit/redis` is installed, use it for cross-instance broadcasts:

```typescript
import { createClient } from "redis";
import { redisPubSub } from "@ws-kit/redis";

const redis = createClient();
await redis.connect();

const router = createRouter({
  pubsub: redisPubSub(redis),
});
serve(router); // Use Redis for cross-instance broadcasting
```

## Feature Adapters

Beyond platform adapters (Bun, Cloudflare, Deno), WS-Kit uses **feature adapters** for stateful capabilities that need backend implementations. This follows the **Plugin-Adapter Architecture** (see [ADR-031](../adr/031-plugin-adapter-architecture.md)).

### Design Principle

**Plugins** define the API; **adapters** implement the backend. Users swap adapters without code changes:

```typescript
// Same code, different adapters
const router = createRouter()
  .plugin(withPubSub({ adapter: memoryPubSub() })) // Dev: memory
  .use(
    rateLimit({
      limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 10 }),
    }),
  );

// In production, swap adapters:
const productionRouter = createRouter()
  .plugin(withPubSub({ adapter: redisPubSub(redis) }))
  .use(
    rateLimit({
      limiter: redisRateLimiter(redis, { capacity: 1000, tokensPerSecond: 50 }),
    }),
  );
```

### Pub/Sub Adapters

**Plugin**: `withPubSub()` (via `@ws-kit/plugins`)

**Adapters**:

| Adapter        | Location             | Use Case                    | Guarantees                                           |
| -------------- | -------------------- | --------------------------- | ---------------------------------------------------- |
| **Memory**     | `@ws-kit/memory`     | Dev, testing, single-server | ✅ In-memory, fast; ❌ no persistence                |
| **Redis**      | `@ws-kit/redis`      | Multi-pod production        | ✅ Cross-server distribution; ❌ external dependency |
| **Cloudflare** | `@ws-kit/cloudflare` | Cloudflare Workers          | ✅ Durable Objects; ❌ per-DO limits                 |

**Interface** (`@ws-kit/core/pubsub`):

```typescript
export interface PubSubAdapter {
  /**
   * Subscribe a connection to a topic.
   */
  subscribe(clientId: string, topic: string): Promise<void>;

  /**
   * Unsubscribe a connection from a topic.
   */
  unsubscribe(clientId: string, topic: string): Promise<void>;

  /**
   * Publish a message to all subscribers of a topic.
   * Returns the number of subscribers that received the message.
   */
  publish(topic: string, message: SerializedMessage): Promise<PublishResult>;

  /**
   * List all topics a connection is subscribed to.
   */
  list(clientId: string): Promise<string[]>;
}

export interface PublishResult {
  matched: number; // Number of subscribers that received message
  capability: "exact" | "prefix" | "regex"; // Matching mode used
}
```

**Example: Swapping Adapters**

Development (no setup needed):

```typescript
import { withPubSub } from "@ws-kit/pubsub";
import { memoryPubSub } from "@ws-kit/memory";

const router = createRouter().plugin(withPubSub({ adapter: memoryPubSub() }));
```

Production (Redis):

```typescript
import { withPubSub } from "@ws-kit/pubsub";
import { redisPubSub } from "@ws-kit/redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const router = createRouter().plugin(
  withPubSub({ adapter: redisPubSub(redis) }),
);
```

Cloudflare Workers (Durable Objects):

```typescript
import { withPubSub } from "@ws-kit/pubsub";
import { cloudflarePubSub } from "@ws-kit/cloudflare";

const router = createRouter().plugin(
  withPubSub({ adapter: cloudflarePubSub(env.DURABLE_OBJECTS) }),
);
```

### Rate Limiter Adapters

**Middleware**: `rateLimit()` (via `@ws-kit/rate-limit`)

**Adapters**:

| Adapter        | Location             | Use Case                    | Guarantees                                      |
| -------------- | -------------------- | --------------------------- | ----------------------------------------------- |
| **Memory**     | `@ws-kit/memory`     | Dev, testing, single-server | ✅ Per-key mutex; ❌ no distribution            |
| **Redis**      | `@ws-kit/redis`      | Multi-pod production        | ✅ Lua script atomicity; ❌ external dependency |
| **Cloudflare** | `@ws-kit/cloudflare` | Cloudflare Workers          | ✅ Sharded DOs; ❌ complexity                   |

**Interface** (`@ws-kit/rate-limit`):

```typescript
export interface RateLimiterAdapter {
  /**
   * Atomically attempt to consume tokens from a rate limit bucket.
   * @param key - Rate limit key (e.g., "user:123:SendMessage")
   * @param tokens - Number of tokens to consume
   * @returns Decision: allowed + remaining, or denied + retryAfterMs
   */
  consume(
    key: string,
    tokens: number,
  ): Promise<{
    ok: boolean;
    retryAfterMs?: number; // When tokens will be available
  }>;

  /**
   * Reset the bucket (clear all tokens).
   */
  reset(key: string): Promise<void>;
}
```

**Example: Swapping Adapters**

Development (no setup needed):

```typescript
import { rateLimit } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

const router = createRouter().use(
  rateLimit({
    limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 10 }),
  }),
);
```

Production (Redis):

```typescript
import { rateLimit } from "@ws-kit/rate-limit";
import { redisRateLimiter } from "@ws-kit/redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const router = createRouter().use(
  rateLimit({
    limiter: redisRateLimiter(redis, { capacity: 1000, tokensPerSecond: 50 }),
    key: (ctx) => `user:${ctx.ws.data.userId}`,
  }),
);
```

### Custom Adapters

Implement any interface to create custom adapters for proprietary backends.

**Example: Kafka-based Pub/Sub**

```typescript
import { PubSubAdapter, PublishResult } from "@ws-kit/core";

export function kafkaPubSub(producer: KafkaProducer): PubSubAdapter {
  const subscriptions = new Map<string, Set<string>>();

  return {
    subscribe: async (clientId, topic) => {
      if (!subscriptions.has(topic)) {
        subscriptions.set(topic, new Set());
      }
      subscriptions.get(topic)!.add(clientId);
    },

    unsubscribe: async (clientId, topic) => {
      subscriptions.get(topic)?.delete(clientId);
    },

    publish: async (topic, message): Promise<PublishResult> => {
      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
      const subscribers = subscriptions.get(topic) ?? new Set();
      return {
        matched: subscribers.size,
        capability: "exact",
      };
    },

    list: async (clientId) => {
      const topics: string[] = [];
      for (const [topic, clients] of subscriptions.entries()) {
        if (clients.has(clientId)) {
          topics.push(topic);
        }
      }
      return topics;
    },
  };
}

// Usage
const router = createRouter().plugin(
  withPubSub({ adapter: kafkaPubSub(kafkaProducer) }),
);
```

### Benefits of Feature Adapters

- ✅ **Zero-config development**: Memory adapters work out-of-the-box
- ✅ **Production-ready**: Swap single line of code for scalable backends
- ✅ **Testing**: No external services needed for unit tests
- ✅ **Extensibility**: Custom adapters for any backend
- ✅ **Type safety**: Adapters implement well-defined interfaces
- ✅ **Clear ownership**: Plugin defines API; adapter implements backend

See [ADR-031: Plugin-Adapter Architecture](../adr/031-plugin-adapter-architecture.md) for complete design rationale.

## Future Considerations

- **Redis Pub/Sub**: Additional adapter for distributed Redis-backed subscriptions
- **Node.js Adapter**: Support for Node.js runtime (currently Bun/Deno/Cloudflare only)
- **Subscription Persistence**: Optional durable subscriptions across reconnects
- **Kafka Adapters**: Community-maintained adapters for Kafka-based pub/sub
- **AWS SNS/SQS Adapters**: AWS service integrations
