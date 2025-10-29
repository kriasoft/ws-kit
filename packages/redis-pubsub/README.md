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
npm install @ws-kit/core @ws-kit/redis-pubsub redis
```

Both `@ws-kit/redis-pubsub` and `redis` are required:

- `@ws-kit/core` - Core router and types
- `@ws-kit/redis-pubsub` - This adapter
- `redis` - Redis client (v4.6.0+)

## Quick Start

### Basic Setup

```typescript
import { WebSocketRouter } from "@ws-kit/core";
import { createBunAdapter } from "@ws-kit/bun";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import { zodValidator } from "@ws-kit/zod";
import { z } from "zod";

// Create router with Redis PubSub for multi-instance broadcasting
const router = new WebSocketRouter({
  platform: createBunAdapter(),
  validator: zodValidator(),
  pubsub: createRedisPubSub({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  }),
});

// Define message schemas
const { messageSchema } = createMessageSchema(z);
const ChatMessage = messageSchema("CHAT", {
  userId: z.string(),
  text: z.string(),
});

// Register handler
router.on(ChatMessage, async (ctx) => {
  // This broadcasts to all instances
  await router.publish("chat:general", {
    userId: ctx.payload.userId,
    text: ctx.payload.text,
  });
});
```

### With Configuration Options

```typescript
const pubsub = createRedisPubSub({
  // Connection options
  url: "redis://localhost:6379", // or use host/port/password
  host: "localhost",
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  tls: true, // For production

  // Namespace for multi-tenancy
  namespace: "myapp:prod", // Channels prefixed as "myapp:prod:*"

  // Lifecycle hooks
  onConnect: () => console.log("Connected to Redis"),
  onError: (err) => console.error("Redis error:", err),
  onDisconnect: () => console.log("Disconnected from Redis"),

  // Reconnection behavior
  maxReconnectDelay: 30000, // Max delay between reconnect attempts

  // Custom message handling
  serializeMessage: (msg) => {
    return JSON.stringify(msg); // Default behavior
  },
  deserializeMessage: (msg) => {
    return JSON.parse(msg); // Default behavior
  },
});
```

### Using a Pre-configured Client

```typescript
import { createClient } from "redis";

// Create and configure your own Redis client
const redisClient = createClient({
  url: "redis://localhost:6379",
  socket: { reconnectStrategy: () => null }, // Custom reconnection
});

await redisClient.connect();

// Pass to RedisPubSub
const pubsub = createRedisPubSub({
  client: redisClient,
  namespace: "myapp",
});
```

## API Reference

### `createRedisPubSub(options?)`

Factory function to create a Redis-backed PubSub adapter.

**Parameters:**

```typescript
interface RedisPubSubOptions {
  // Connection parameters
  url?: string; // Redis URL (e.g., "redis://localhost:6379")
  host?: string; // Default: "localhost"
  port?: number; // Default: 6379
  password?: string; // Redis password
  db?: number; // Redis database (default: 0)
  tls?: boolean; // Enable TLS (default: false)

  // Client management
  client?: Redis; // Pre-configured Redis client (ignores other options)

  // Namespace for multi-tenancy
  namespace?: string; // Channel prefix (default: "ws")

  // Lifecycle callbacks
  onConnect?: () => void; // Called on successful connection
  onError?: (error: Error) => void; // Called on any error
  onDisconnect?: () => void; // Called when connection is lost

  // Reconnection
  maxReconnectDelay?: number; // Max milliseconds between reconnects (default: 30000)

  // Custom serialization
  serializeMessage?: (msg: unknown) => string;
  deserializeMessage?: (msg: string) => unknown;
}
```

**Returns:** A `PubSub` instance implementing the core router interface.

### `RedisPubSub` Class

Implements the `PubSub` interface from `@ws-kit/core`.

```typescript
class RedisPubSub implements PubSub {
  // Publish a message to a channel (broadcasts to all subscribers)
  async publish(channel: string, message: unknown): Promise<void>;

  // Subscribe to a channel
  subscribe(channel: string, handler: (message: unknown) => void): void;

  // Unsubscribe from a channel
  unsubscribe(channel: string, handler: (message: unknown) => void): void;

  // Check if connected to Redis
  isConnected(): boolean;

  // Cleanup and close connections
  async destroy(): Promise<void>;
}
```

## Real-World Examples

### Multi-Instance Chat Application

```typescript
import { WebSocketRouter } from "@ws-kit/core";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import { z } from "zod";

const pubsub = createRedisPubSub({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  namespace: "chat:app",
});

const router = new WebSocketRouter({ pubsub });

const { messageSchema } = createMessageSchema(z);
const JoinRoom = messageSchema("JOIN", { roomId: z.string() });
const SendMessage = messageSchema("SEND", {
  roomId: z.string(),
  text: z.string(),
});

// Track room memberships
const roomMembers = new Map<string, Set<string>>();

router.on(JoinRoom, async (ctx) => {
  const roomId = ctx.payload.roomId;
  const clientId = ctx.ws.clientId;

  if (!roomMembers.has(roomId)) {
    roomMembers.set(roomId, new Set());
  }
  roomMembers.get(roomId)!.add(clientId);

  // Broadcast to all instances and all connections in this room
  await router.publish(`room:${roomId}:join`, {
    userId: clientId,
  });
});

router.on(SendMessage, async (ctx) => {
  const roomId = ctx.payload.roomId;

  // Broadcast to all instances
  await router.publish(`room:${roomId}:message`, {
    userId: ctx.ws.clientId,
    text: ctx.payload.text,
    timestamp: Date.now(),
  });
});
```

### Multi-Tenant Application

```typescript
const pubsub = createRedisPubSub({
  url: process.env.REDIS_URL,
  // Each tenant gets isolated channels
  namespace: `tenant:${process.env.TENANT_ID}`,
});

const router = new WebSocketRouter({ pubsub });

// Now all channels are prefixed with "tenant:acme-corp:"
await router.publish("notifications", { ... });
// Actually publishes to: "tenant:acme-corp:notifications"
```

### Error Handling and Monitoring

```typescript
const pubsub = createRedisPubSub({
  url: process.env.REDIS_URL,
  onConnect: () => {
    console.log("[Redis] Connected");
    metrics.redis_connected.set(1);
  },
  onError: (err) => {
    console.error("[Redis] Error:", err.message);
    metrics.redis_errors.inc();
    sentry.captureException(err);
  },
  onDisconnect: () => {
    console.warn("[Redis] Disconnected (will auto-reconnect)");
    metrics.redis_connected.set(0);
  },
});
```

## Message Serialization

By default, messages are serialized as follows:

| Type                         | Serialization            |
| ---------------------------- | ------------------------ |
| `string`                     | Passed through unchanged |
| `object`                     | JSON.stringify           |
| `number`                     | JSON.stringify           |
| `boolean`                    | JSON.stringify           |
| `null`                       | JSON.stringify           |
| `Uint8Array` / `ArrayBuffer` | base64-encoded           |

### Custom Serialization

For application-specific formats (e.g., MessagePack, Protocol Buffers):

```typescript
import * as msgpack from "msgpack-lite";

const pubsub = createRedisPubSub({
  url: "redis://localhost:6379",
  serializeMessage: (msg) => {
    return msgpack.encode(msg).toString("base64");
  },
  deserializeMessage: (msg) => {
    return msgpack.decode(Buffer.from(msg, "base64"));
  },
});
```

## Connection Management

### Automatic Reconnection

The adapter automatically reconnects to Redis using exponential backoff:

- Initial delay: 100ms
- Doubles each attempt: 200ms, 400ms, 800ms, 1.6s, ...
- Capped at `maxReconnectDelay` (default: 30 seconds)

```typescript
const pubsub = createRedisPubSub({
  url: "redis://localhost:6379",
  maxReconnectDelay: 60000, // Cap at 60 seconds
  onDisconnect: () => {
    console.log("Reconnecting...");
  },
});
```

### Graceful Shutdown

Always call `destroy()` when shutting down your server:

```typescript
const pubsub = createRedisPubSub({ url: "redis://localhost:6379" });
const router = new WebSocketRouter({ pubsub });

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await pubsub.destroy();
  process.exit(0);
});
```

## Performance & Scaling

### Characteristics

- **Latency**: ~1-5ms per message (local network)
- **Throughput**: Thousands of messages/second per instance
- **Memory**: ~1KB per subscription
- **Connections**: Single pub/sub connection per RedisPubSub instance

### Recommendations

#### Single Redis Instance

For development and small deployments:

```bash
docker run -d -p 6379:6379 redis:latest
```

#### Redis Cluster

For production high-availability:

```typescript
const pubsub = createRedisPubSub({
  url: "redis-cluster://node1:6379,node2:6379,node3:6379",
});
```

#### Redis Sentinel

For failover without clustering:

```typescript
const pubsub = createRedisPubSub({
  url: "redis-sentinel://sentinel1:26379,sentinel2:26379?sentinels=mymaster",
});
```

## Troubleshooting

### Connection Failures

**Error**: `Error: Failed to connect to Redis`

**Solutions:**

1. Verify Redis is running: `redis-cli ping`
2. Check connection URL: `redis://host:port`
3. Verify credentials: `redis://user:password@host:port`
4. Check network/firewall rules
5. Enable TLS if required: `rediss://host:port` or `tls: true`

### Messages Not Delivered

**Issue**: Publishing works but messages aren't received

**Causes & Solutions:**

1. **Channels don't match**: Ensure subscriber and publisher use same channel name
2. **Namespace mismatch**: All pubsub instances should use same namespace
3. **Connection not ready**: Use `onConnect` callback to wait for ready state

```typescript
const pubsub = createRedisPubSub({
  url: "redis://localhost:6379",
});

// Wait for connection
await new Promise((resolve) => {
  pubsub.onConnect?.();
  // Then publish...
});
```

### High Memory Usage

**Issue**: Memory usage grows over time

**Solutions:**

1. Check for handler memory leaks (avoid closures capturing large objects)
2. Verify subscriptions are properly cleaned up on disconnect
3. Monitor Redis memory: `redis-cli info memory`

### Slow Message Delivery

**Issue**: High latency between publish and delivery

**Causes & Solutions:**

1. Check Redis latency: `redis-cli --latency`
2. Verify network throughput: `iperf3` or similar
3. Consider Redis Cluster for better distribution
4. Use custom serializer for smaller payloads

## Related Packages

- **[@ws-kit/core](https://www.npmjs.com/package/@ws-kit/core)** - Core router and types
- **[@ws-kit/bun](https://www.npmjs.com/package/@ws-kit/bun)** - Bun.serve platform adapter
- **[@ws-kit/zod](https://www.npmjs.com/package/@ws-kit/zod)** - Zod validator
- **[@ws-kit/valibot](https://www.npmjs.com/package/@ws-kit/valibot)** - Valibot validator
- **[@ws-kit/client](https://www.npmjs.com/package/@ws-kit/client)** - Browser/Node.js client
- **[@ws-kit/cloudflare-do](https://www.npmjs.com/package/@ws-kit/cloudflare-do)** - Cloudflare Durable Objects adapter

## License

MIT
