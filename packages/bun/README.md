# @ws-kit/bun

Bun platform adapter for WS-Kit, leveraging Bun's native high-performance WebSocket features.

## Purpose

`@ws-kit/bun` provides the platform-specific integration layer for WS-Kit on Bun, enabling:

- Direct use of Bun's native `server.publish()` for zero-copy broadcasting
- Seamless integration with `Bun.serve()`
- Type-safe WebSocket message routing with `@ws-kit/core`
- Pluggable validator adapters (Zod, Valibot, or custom)

## What This Package Provides

- **`createBunPubSub(server)`**: Factory returning a `PubSubAdapter` for use with `withPubSub()` plugin
- **`BunPubSub`**: Native implementation leveraging Bun's `server.publish()` for zero-copy broadcasting
- **`createBunHandler(router)`**: Factory returning `{ fetch, websocket }` for `Bun.serve()` integration
- **UUID v7 client ID generation**: Time-ordered unique identifiers for every connection
- **Authentication support**: Custom auth functions during WebSocket upgrade
- **Connection metadata**: Automatic `clientId` and `connectedAt` tracking via `ctx.data`

## Platform Advantages Leveraged

- **Native PubSub**: Uses Bun's event-loop integrated broadcasting (no third-party message queue needed)
- **Zero-copy**: Messages broadcast without serialization overhead
- **Auto-cleanup**: Subscriptions cleaned up on connection close via Bun's garbage collection
- **Automatic backpressure**: Respects WebSocket write buffer limits
- **Optimal performance**: Direct integration with Bun's optimized WebSocket implementation

## Installation

```bash
bun add @ws-kit/core @ws-kit/bun
```

Install with a validator adapter (optional but recommended):

```bash
bun add zod @ws-kit/zod
# OR
bun add valibot @ws-kit/valibot
```

## Dependencies

- `@ws-kit/core` (required) — Core router and types
- `uuid` (required) — For UUID v7 client ID generation
- `@types/bun` (peer) — TypeScript types for Bun (only in TypeScript projects)

## Quick Start

### Basic Example

```typescript
import { serve } from "@ws-kit/bun";
import { z, createRouter, message } from "@ws-kit/zod";

// Define message schemas
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

// Create router
const router = createRouter();

// Register handlers
router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: ctx.payload.text });
});

// Serve with authentication
serve(router, {
  port: 3000,
  authenticate(req) {
    // Optional: verify auth token and return user data
    const token = req.headers.get("authorization");
    return token ? { userId: "user_123" } : undefined;
  },
});
```

### With Pub/Sub Plugin

For broadcasting to multiple subscribers:

```typescript
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { createBunPubSub } from "@ws-kit/bun";

const server = Bun.serve({
  port: 3000,
  fetch() {
    return new Response("WebSocket only");
  },
  websocket: {},
});

const router = createRouter().plugin(
  withPubSub({ adapter: createBunPubSub(server) }),
);

router.on(MessageSchema, async (ctx) => {
  // Broadcast to all subscribers
  await router.publish("notifications", ResponseSchema, { text: "Hello" });
});
```

### Low-Level API (Advanced)

For more control over server configuration:

```typescript
import { createBunHandler } from "@ws-kit/bun";
import { z, createRouter, message } from "@ws-kit/zod";

// Define and register handlers
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

const router = createRouter();
router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: ctx.payload.text });
});

// Create handlers
const { fetch, websocket } = createBunHandler(router, {
  authenticate: async (req) => {
    // Verify tokens, sessions, etc.
    return {};
  },
});

// Start server
Bun.serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      return fetch(req, server);
    }
    return new Response("Not Found", { status: 404 });
  },
  websocket,
});
```

## API Reference

### `createBunPubSub(server)`

Create a Pub/Sub adapter for use with the `withPubSub()` plugin.

```typescript
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { createBunPubSub } from "@ws-kit/bun";

const server = Bun.serve({ fetch: ..., websocket: ... });
const adapter = createBunPubSub(server);
const router = createRouter()
  .plugin(withPubSub({ adapter }));
```

**Note:** Bun's pub/sub is process-scoped. For multi-instance clusters, use `@ws-kit/redis`.

### `createBunHandler(router, options?)`

Returns `{ fetch, websocket }` handlers for `Bun.serve()`.

**Options:**

- `authenticate?: (req: Request) => Promise<TData> | TData` — Custom auth function called during upgrade
- `clientIdHeader?: string` — Header name for returning client ID (default: `"x-client-id"`)
- `context?: unknown` — Custom context passed to handlers

```typescript
const { fetch, websocket } = createBunHandler(router, {
  authenticate: async (req) => {
    const token = req.headers.get("authorization");
    const user = await validateToken(token);
    return { userId: user.id, role: user.role };
  },
});
```

### Connection Data

All connections automatically include:

```typescript
type BunWebSocketData<T> = {
  clientId: string; // UUID v7 - unique per connection
  connectedAt: number; // Timestamp in milliseconds
  // + your custom auth data (T)
};
```

Access in handlers:

```typescript
router.on(SomeSchema, (ctx) => {
  const { clientId, connectedAt } = ctx.data;
  // Use clientId for logging, userId for auth, etc.
});
```

### Broadcasting

```typescript
// Define schemas
const JoinRoom = message("JOIN_ROOM", { room: z.string() });
const RoomUpdate = message("ROOM_UPDATE", { text: z.string() });

router.on(JoinRoom, async (ctx) => {
  const { room } = ctx.payload;

  // Subscribe to room channel
  await ctx.topics.subscribe(`room:${room}`);
});

// Broadcast to all subscribers on a channel
await router.publish("room:123", RoomUpdate, { text: "Hello everyone!" });
```

Messages published to a channel are received by all connections subscribed to that channel.

## PubSub Scope & Scaling

### Single Bun Instance

In Bun, `router.publish(topic)` broadcasts to **all WebSocket connections in the current process** subscribed to that topic.

```typescript
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { createBunPubSub } from "@ws-kit/bun";

const server = Bun.serve({
  fetch() {
    return new Response("");
  },
  websocket: {},
});

const router = createRouter().plugin(
  withPubSub({ adapter: createBunPubSub(server) }),
);

// This broadcasts to connections in THIS process only
const NotificationMessage = message("NOTIFICATION", { message: z.string() });
await router.publish("notifications", NotificationMessage, {
  message: "Hello",
});
```

### Multi-Instance Cluster (Load Balanced)

For deployments with multiple Bun processes behind a load balancer, use `@ws-kit/redis`:

```typescript
import { createClient } from "redis";
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { redisPubSub } from "@ws-kit/redis";
import { serve } from "@ws-kit/bun";

const redis = createClient();
await redis.connect();

const router = createRouter().plugin(
  withPubSub({ adapter: redisPubSub(redis) }),
);

// Now publishes across ALL instances
const NotificationMessage = message("NOTIFICATION", { message: z.string() });
await router.publish("notifications", NotificationMessage, {
  message: "Hello",
});

serve(router, { port: 3000 });
```

## Connection Lifecycle

### Open Hook

Called when a WebSocket connection is established:

```typescript
router.onOpen(async (ctx) => {
  const { clientId } = ctx.data;
  console.log(`[${clientId}] Connected`);

  // Subscribe to channels
  await ctx.topics.subscribe("notifications");

  // Send welcome message
  ctx.send(WelcomeMessage, { greeting: "Welcome!" });
});
```

### Authentication Hook

Called on the first message to authenticate the connection:

```typescript
router.onAuth(async (ctx) => {
  const token = ctx.data.token; // From custom auth
  if (!token) return false; // Close connection

  // Verify token...
  return true; // Allow further messages
});
```

### Message Handler

Called for each message matching a schema:

```typescript
router.on(LoginSchema, async (ctx) => {
  // ctx.payload has type-safe data
  // ctx.data has connection metadata
  // ctx.send() to reply with messages

  const { username, password } = ctx.payload;
  const user = await verifyLogin(username, password);

  if (user) {
    ctx.send(LoginSuccessMessage, { token: user.token });
  } else {
    // Use ctx.error() for error responses (not ctx.send() with error message)
    ctx.error("INVALID_ARGUMENT", "Invalid username or password");
  }
});
```

### Close Hook

Called when the connection closes:

```typescript
router.onClose(async (ctx) => {
  const { clientId, userId } = ctx.data;
  console.log(`[${clientId}] Disconnected (${ctx.code}: ${ctx.reason})`);

  // Clean up: remove from rooms, notify others, etc.
});
```

### Error Hook

Called when an error occurs:

```typescript
router.onError((error, ctx) => {
  console.error(`[${ctx?.data.clientId}] Error:`, error.message);
});
```

## Examples

### Chat Application with Pub/Sub

```typescript
import { createBunHandler } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { createBunPubSub } from "@ws-kit/bun";
import { z, message } from "@ws-kit/zod";

declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    room?: string;
  }
}

// Message schemas
const JoinRoomMessage = message("ROOM:JOIN", { room: z.string() });
const SendMessageMessage = message("ROOM:MESSAGE", { text: z.string() });
const UserListMessage = message("ROOM:LIST", {
  users: z.array(z.string()),
});
const BroadcastMessage = message("ROOM:BROADCAST", {
  user: z.string(),
  text: z.string(),
});

const server = Bun.serve({
  fetch() {
    return new Response("");
  },
  websocket: {},
});

// Router with pub/sub
const router = createRouter().plugin(
  withPubSub({ adapter: createBunPubSub(server) }),
);

// Track rooms
const rooms = new Map<string, Set<string>>();

router.on(JoinRoomMessage, async (ctx) => {
  const { room } = ctx.payload;
  const { clientId } = ctx.data;

  // Update connection data
  ctx.assignData({ room });

  // Subscribe to room
  await ctx.topics.subscribe(`room:${room}`);

  // Track membership
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room)!.add(clientId);

  // Broadcast user list using schema
  const users = Array.from(rooms.get(room)!);
  await router.publish(`room:${room}`, UserListMessage, { users });
});

router.on(SendMessageMessage, async (ctx) => {
  const { text } = ctx.payload;
  const { clientId, room } = ctx.data;

  // Broadcast to all in room using schema
  await router.publish(`room:${room}`, BroadcastMessage, {
    user: clientId,
    text,
  });
});

router.onClose((ctx) => {
  const { clientId, room } = ctx.data;

  if (room && rooms.has(room)) {
    rooms.get(room)!.delete(clientId);
  }
});

const { fetch, websocket } = createBunHandler(router);

Bun.serve({
  fetch(req) {
    if (new URL(req.url).pathname === "/ws") {
      return fetch(req, server);
    }
    return new Response("Not Found", { status: 404 });
  },
  websocket,
});
```

## Performance Characteristics

- **Broadcasts**: ~100,000 msg/sec per instance (depends on payload size)
- **Connections**: Supports 100,000+ concurrent connections per Bun process
- **Latency**: <1ms broadcast latency within a process
- **Backpressure**: Automatic write buffer management

Benchmarks based on typical payloads (~1KB JSON). Actual performance depends on hardware, payload size, and network conditions.

## Key Concepts

### Connection Data (`ctx.data`)

Per ADR-033, all connection state lives in `ctx.data`. This is the canonical source of truth:

```typescript
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    userName?: string;
    roles?: string[];
  }
}

router.on(SomeMessage, (ctx) => {
  // Read from ctx.data
  console.log(`User: ${ctx.data.userId}`);

  // Update with ctx.assignData()
  ctx.assignData({ roles: ["admin"] });

  // Never try to access ws.data (it's opaque transport)
});
```

### Opaque Transport (`ctx.ws`)

The WebSocket is treated as opaque transport—only for send/close/readyState:

```typescript
router.on(SomeMessage, (ctx) => {
  // ✓ Correct: use ctx.ws for transport
  ctx.ws.send(data);
  ctx.ws.close(1000);
  const state = ctx.ws.readyState;

  // ✗ Wrong: don't access platform-specific fields
  // (ctx.ws as any).data  ← Use ctx.data instead
});
```

## TypeScript Support

Full TypeScript support with:

- Generic `TData` type parameter for custom connection data
- Type inference from message schemas (with Zod or Valibot)
- Strict handler typing to prevent runtime errors

```typescript
type CustomData = { userId: string; role: "admin" | "user" };

const router = createRouter<CustomData>({
  platform: createBunAdapter(),
});

// Handler context has typed ctx.data
router.on(SomeSchema, (ctx) => {
  const role = ctx.data.role; // "admin" | "user"
});
```

## Troubleshooting

### "Upgrade failed"

Ensure your fetch handler returns the result of `fetch(req, server)` from `createBunHandler()`.

### Messages not broadcasting

Check that:

1. Sender is subscribed: `await ctx.topics.subscribe("channel")`
2. Receiver is subscribed to the same channel
3. For multi-instance: use `@ws-kit/redis`

### Memory leaks

Ensure `router.onClose()` cleans up resources (unsubscribe, remove from rooms, etc.).

## Related Packages

- [`@ws-kit/core`](../core/README.md) — Core router and types
- [`@ws-kit/zod`](../zod/README.md) — Zod validator adapter
- [`@ws-kit/valibot`](../valibot/README.md) — Valibot validator adapter
- [`@ws-kit/redis`](../redis/README.md) — Redis rate limiter and pub/sub
- [`@ws-kit/memory`](../memory/README.md) — In-memory pub/sub
- [`@ws-kit/client`](../client/README.md) — Browser/Node.js client

## License

MIT
