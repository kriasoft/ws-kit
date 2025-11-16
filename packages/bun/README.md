# @ws-kit/bun

Bun platform adapter for WS-Kit, leveraging Bun's native high-performance WebSocket features.

## Purpose

`@ws-kit/bun` provides the platform-specific integration layer for WS-Kit on Bun, enabling:

- Direct use of Bun's native `server.publish()` for zero-copy broadcasting
- Seamless integration with `Bun.serve()`
- Type-safe WebSocket message routing with `@ws-kit/core`
- Pluggable validator adapters (Zod, Valibot, or custom)

## What This Package Provides

- **`bunPubSub(server)`**: Factory returning a `PubSubAdapter` for use with `withPubSub()` plugin
- **`createBunHandler(router)`**: Factory returning `{ fetch, websocket }` for `Bun.serve()` integration
- **Native UUID client ID generation**: Using Bun's built-in `crypto.randomUUID()` for unique connection identifiers
- **Authentication support**: Auth gating during WebSocket upgrade (return undefined to reject)
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
    // Verify auth token and return user data
    // Returning undefined rejects the connection with 401
    const token = req.headers.get("authorization");
    if (!token) return undefined; // Reject
    return { userId: "user_123" }; // Accept
  },
});
```

### With Pub/Sub Plugin

For broadcasting to multiple subscribers:

```typescript
import { serve } from "@ws-kit/bun";
import { createRouter, message } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { z } from "zod";

const NotificationMessage = message("NOTIFICATION", {
  text: z.string(),
});

const router = createRouter().plugin(withPubSub());

router.on(NotificationMessage, async (ctx) => {
  // Broadcast to all subscribers on the topic
  await ctx.publish("notifications", NotificationMessage, {
    text: "Hello everyone!",
  });
});

serve(router, { port: 3000 });
```

**Note**: `serve()` automatically initializes the Bun Pub/Sub adapter. For `createBunHandler()`, you must manually configure the adapter (see low-level API section below).

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

### `bunPubSub(server)`

Create a Pub/Sub adapter for use with the `withPubSub()` plugin.

```typescript
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { bunPubSub } from "@ws-kit/bun";

const server = Bun.serve({ fetch: ..., websocket: ... });
const adapter = bunPubSub(server);
const router = createRouter()
  .plugin(withPubSub({ adapter }));
```

**Note:** Bun's pub/sub is process-scoped. For multi-instance clusters, use `@ws-kit/redis`.

### `createBunHandler(router, options?)`

Returns `{ fetch, websocket }` handlers for `Bun.serve()`.

**Options:**

- `authenticate?: (req: Request) => Promise<TData | undefined> | TData | undefined` — Custom auth function called during upgrade. Return `undefined` to reject with configured status (default 401), or an object to merge into connection data and accept.
- `authRejection?: { status?: number; message?: string }` — Customize rejection response when authenticate returns undefined (default: `{ status: 401, message: "Unauthorized" }`)
- `clientIdHeader?: string` — Header name for returning client ID (default: `"x-client-id"`)
- `onError?: (error: Error, evt: BunErrorEvent) => void` — Called when errors occur (sync-only, for logging/telemetry)
- `onUpgrade?: (req: Request) => void` — Called before upgrade attempt
- `onOpen?: (ctx: BunConnectionContext) => void` — Called after connection established (sync-only)
- `onClose?: (ctx: BunConnectionContext) => void` — Called after connection closed (sync-only)

```typescript
const { fetch, websocket } = createBunHandler(router, {
  authenticate: async (req) => {
    const token = req.headers.get("authorization");
    if (!token) return undefined; // Reject with 401
    const user = await validateToken(token);
    return { userId: user.id, role: user.role };
  },
  authRejection: { status: 403, message: "Forbidden" }, // Custom rejection
  onError: (error, ctx) => {
    console.error(`[ws ${ctx.type}] ${error.message}`, {
      clientId: ctx.clientId,
      phase: ctx.type,
    });
  },
  onOpen: ({ data }) => {
    console.log(`Connection opened: ${data.clientId}`);
  },
  onClose: ({ data }) => {
    console.log(`Connection closed: ${data.clientId}`);
  },
});
```

### Connection Data

All connections automatically include:

```typescript
type BunConnectionData<TContext> = {
  clientId: string; // UUID v7 - unique per connection
  connectedAt: number; // Timestamp in milliseconds
  // + your custom auth data (TContext)
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
import { bunPubSub } from "@ws-kit/bun";

const server = Bun.serve({
  fetch() {
    return new Response("");
  },
  websocket: {},
});

const router = createRouter().plugin(
  withPubSub({ adapter: bunPubSub(server) }),
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

Connections go through phases: authenticate → upgrade → open → message(s) → close. Sync-only hooks fire at each phase for observability:

```typescript
const { fetch, websocket } = createBunHandler(router, {
  authenticate: async (req) => {
    // Verify auth; return undefined to reject, object to accept
    const token = req.headers.get("authorization");
    return token ? { userId: "user_123" } : undefined;
  },
  onOpen: ({ data }) => {
    console.log(`Connected: ${data.clientId}`);
  },
  onClose: ({ data }) => {
    console.log(`Disconnected: ${data.clientId}`);
  },
  onError: (error, evt) => {
    console.error(`Error in ${evt.type}:`, error.message);
  },
});
```

**Handlers** receive validated messages with full connection context:

```typescript
router.on(LoginMessage, (ctx) => {
  const { username, password } = ctx.payload; // From schema
  const { userId, clientId } = ctx.data; // From auth or defaults
  // Handle login...
});
```

## Examples

### Chat Application with Pub/Sub

```typescript
import { createBunHandler } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { bunPubSub } from "@ws-kit/bun";
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
  withPubSub({ adapter: bunPubSub(server) }),
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

## Performance

Bun's native WebSocket implementation provides excellent performance characteristics:

- **Zero-copy broadcasting** — Uses Bun's `server.publish()` for efficient message distribution
- **Automatic backpressure** — WebSocket write buffer limits are respected
- **In-memory pub/sub** — Fast topic subscriptions without external dependencies
- **Connection limits** — Determined by OS and Bun runtime (typically 10,000+ concurrent connections)

For exact performance benchmarks, see [Bun's WebSocket documentation](https://bun.sh/docs/api/websockets).

## Key Concepts

### Connection Data

All connection state lives in `ctx.data` (see ADR-033 for details). Automatic fields are always available; custom fields come from the `authenticate` hook:

```typescript
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    roles?: string[];
  }
}

router.on(SomeMessage, (ctx) => {
  const { clientId, connectedAt } = ctx.data; // Automatic
  const { userId, roles } = ctx.data; // Custom (from auth)
  ctx.assignData({ roles: ["admin"] }); // Update
});
```

**Automatic fields:**

- `clientId: string` — Unique per connection
- `connectedAt: number` — Timestamp when upgraded

### Opaque Transport

The WebSocket (`ctx.ws`) is used only for low-level transport operations:

```typescript
ctx.ws.send(data); // Low-level send
ctx.ws.close(1000); // Close with code
const state = ctx.ws.readyState; // Check state

// Don't access platform-specific fields; use ctx.data instead
```

## TypeScript Support

Full type inference from schema to handler context. Use module augmentation to define connection data once, shared across all routers:

```typescript
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    role?: "admin" | "user";
  }
}

router.on(SomeSchema, (ctx) => {
  const role = ctx.data.role; // Fully typed: "admin" | "user" | undefined
});
```

## Architecture & Design

### Authentication Gating

Per [ADR-035](../docs/adr/035-bun-adapter-refinement.md), authentication is a critical security boundary:

- **Returning `undefined`** from `authenticate` **rejects** the connection with configured status (default 401)
- **Returning an object** merges it into `ctx.data` and accepts the connection
- **Not providing `authenticate`** accepts connections with only automatic fields (`clientId`, `connectedAt`)

This ensures auth is a true gatekeeper, not a side effect.

### Sync-Only Hooks

Error and lifecycle hooks (`onError`, `onOpen`, `onClose`) are **sync-only** for predictability:

- Cannot await promises (no async footguns)
- Used for observability and logging, not recovery
- For async cleanup or recovery, use plugins instead

## Troubleshooting

### "Upgrade failed"

Ensure your fetch handler returns the result of `fetch(req, server)` from `createBunHandler()`.

### Authentication rejected

If your connection is rejected with 401, verify:

1. `authenticate` is returning an object (not `undefined`) to accept
2. Use `authRejection` option to customize the rejection status/message if needed

```typescript
const { fetch } = createBunHandler(router, {
  authenticate: (req) => {
    // ✓ Correct: return {} to accept with no custom data
    // ✓ Correct: return { userId: "..." } to accept with data
    // ✗ Wrong: returning undefined still rejects
    return undefined; // This rejects
  },
  authRejection: { status: 403, message: "Forbidden" },
});
```

### Messages not broadcasting

Check that:

1. Router has `withPubSub()` plugin registered
2. Sender and receiver are subscribed to the same topic: `await ctx.topics.subscribe("channel")`
3. For multi-instance: use `@ws-kit/redis` instead of Bun's built-in pub/sub

### Memory leaks

Ensure handlers clean up subscriptions:

```typescript
router.on(JoinRoomMessage, async (ctx) => {
  await ctx.topics.subscribe(`room:${room}`);
});

// Clean up on disconnect (via plugin or external tracking)
await ctx.topics.unsubscribe(`room:${room}`);
```

## Related Packages

- [`@ws-kit/core`](../core/README.md) — Core router and types
- [`@ws-kit/zod`](../zod/README.md) — Zod validator adapter
- [`@ws-kit/valibot`](../valibot/README.md) — Valibot validator adapter
- [`@ws-kit/redis`](../redis/README.md) — Redis rate limiter and pub/sub
- [`@ws-kit/memory`](../memory/README.md) — In-memory pub/sub
- [`@ws-kit/client`](../client/README.md) — Browser/Node.js client

## License

MIT
