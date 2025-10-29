# @ws-kit/cloudflare-do

Cloudflare Durable Objects platform adapter for WS-Kit with per-instance pub/sub and explicit multi-DO federation.

## Purpose

`@ws-kit/cloudflare-do` provides the platform-specific integration layer for WS-Kit on Cloudflare Durable Objects, enabling:

- Per-instance WebSocket broadcasting via BroadcastChannel
- State management integration with durable storage
- Explicit cross-DO federation via RPC for multi-shard coordination
- Type-safe handler composition with core router
- Zero-copy message broadcasting within a DO instance

## What This Package Provides

- **`createDurableObjectHandler()`**: Factory returning fetch handler for DO integration
- **`DurablePubSub`**: BroadcastChannel-based pub/sub for per-instance messaging
- **`federate()` helpers**: Explicit multi-DO coordination functions
- **Sharding helpers**: `scopeToDoName()`, `getShardedDoId()`, `getShardedStub()` for stable scope-to-shard routing
- **UUID v7 client IDs**: Time-ordered unique identifiers per connection
- **Resource tracking**: Automatic `resourceId` and `connectedAt` metadata
- **Connection limits**: Per-DO instance connection quota enforcement

## Platform Advantages Leveraged

- **Per-Instance Isolation**: Each DO instance is isolated; broadcasts don't cross shards automatically
- **Durable Storage**: Direct access to persistent key-value storage via `DurableObjectState`
- **BroadcastChannel**: Low-latency in-memory messaging to all connections within a DO
- **Cost Optimization**: Broadcasts are free; only pays for fetch calls
- **Automatic Failover**: Cloudflare automatically restarts failed DO instances
- **Strong Isolation**: Per-resource instances prevent cross-tenant leaks

## Installation

```bash
bun add @ws-kit/core @ws-kit/cloudflare-do
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
- `@cloudflare/workers-types` (peer) — TypeScript types for Cloudflare Workers (only in TypeScript projects)

## Quick Start

Create a Durable Object handler for your WebSocket router:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";

type AppData = { userId?: string };

const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

const router = createRouter<AppData>();

router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

const handler = createDurableObjectHandler(router);

export default {
  fetch(req: Request, state: DurableObjectState, env: Env) {
    return handler.fetch(req);
  },
};
```

### Advanced Configuration

For custom authentication or options, you can pass them to the handler factory:

```typescript
import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();

const handler = createDurableObjectHandler({ router: router });

export default {
  fetch(req: Request, state: DurableObjectState, env: Env) {
    return handler.fetch(req);
  },
};
```

## ⚠️ Critical: Per-Instance Broadcast Scope

In Cloudflare DO, `router.publish()` broadcasts **ONLY to WebSocket connections within THIS DO instance**, not across shards.

For multi-DO setups, use the `federate()` helper for explicit cross-DO coordination:

```typescript
import { federate } from "@ws-kit/cloudflare-do";

router.on(AnnouncementSchema, async (ctx) => {
  const rooms = ["room:1", "room:2", "room:3"];

  // Explicitly broadcast to multiple shards
  await federate(env.ROOMS, rooms, async (room) => {
    await room.fetch(
      new Request("https://internal/announce", {
        method: "POST",
        body: JSON.stringify({ text: ctx.payload.text }),
      }),
    );
  });
});
```

This design is intentional: each DO is isolated for clarity and cost control.

## API Reference

### `createDurableObjectHandler(options)`

Returns a fetch handler compatible with Durable Object script.

**Options:**

- `router: WebSocketRouter` — Router instance to handle messages
- `authenticate?: (req: Request) => Promise<TData | undefined> | TData | undefined` — Custom auth function
- `context?: unknown` — Custom context passed to handlers
- `maxConnections?: number` — Maximum concurrent connections (default: 1000)

### Connection Data

All connections automatically include:

```typescript
type DurableObjectWebSocketData<T> = {
  clientId: string; // UUID v7 - unique per connection
  resourceId?: string; // Extracted from URL (?room=... or path)
  connectedAt: number; // Timestamp in milliseconds
  // + your custom auth data (T)
};
```

### `federate()` Helpers

**`federate(namespace, shardIds, action)`** - Basic federation

```typescript
await federate(env.ROOMS, ["room:1", "room:2"], async (room) => {
  await room.fetch(
    new Request("https://internal/announce", {
      method: "POST",
      body: JSON.stringify({ event: "ANNOUNCEMENT" }),
    }),
  );
});
```

**`federateWithErrors(namespace, shardIds, action)`** - With error details

```typescript
const results = await federateWithErrors(env.ROOMS, roomIds, async (room) => {
  return await room.fetch(new Request("https://internal/sync"));
});
```

**`federateWithFilter(namespace, shardIds, filter, action)`** - Conditional federation

```typescript
// Only notify US regions
await federateWithFilter(
  env.ROOMS,
  allRoomIds,
  (id) => id.startsWith("us:"),
  async (room) => {
    await room.fetch("https://internal/us-announcement");
  },
);
```

### Sharding Helpers

When using Cloudflare Durable Objects with pub/sub, each DO instance is limited to 100 concurrent connections. Use sharding helpers to distribute subscriptions across multiple DO instances by computing a stable shard from the scope name.

**`scopeToDoName(scope, shards, prefix)`** - Compute shard name from scope

```typescript
import { scopeToDoName } from "@ws-kit/cloudflare-do";

// Same scope always routes to same shard
scopeToDoName("room:general", 10); // → "ws-router-2"
scopeToDoName("room:general", 10); // → "ws-router-2" (consistent)
scopeToDoName("room:random", 10); // → "ws-router-7"
```

**`getShardedDoId(env, scope, shards, prefix)`** - Get DO ID for a scope

```typescript
import { getShardedDoId } from "@ws-kit/cloudflare-do";

const doId = getShardedDoId(env, `room:${roomId}`, 10);
const stub = env.ROUTER.get(doId);
```

**`getShardedStub(env, scope, shards, prefix)`** - Get DO stub ready for fetch

```typescript
import { getShardedStub } from "@ws-kit/cloudflare-do";

export default {
  async fetch(req: Request, env: Env) {
    const roomId = new URL(req.url).searchParams.get("room") ?? "general";
    const stub = getShardedStub(env, `room:${roomId}`, 10);
    return stub.fetch(req); // Routes to sharded DO
  },
};
```

**Benefits:**

- ✅ **Linear scaling**: Add more DO instances to handle more concurrent connections
- ✅ **Stable routing**: Same scope always routes to same DO instance
- ✅ **No cross-shard coordination**: Each scope's subscribers live on one DO
- ✅ **Deterministic**: Same shard map every time (no crypto, stable hash)

**Important**: Changing the shard count will remap existing scopes. Plan accordingly and consider a migration period if using persistent storage.

## Examples

### Chat Application

```typescript
const router = createRouter();

const members = new Set<string>();

router.on(JoinRoom, async (ctx) => {
  members.add(ctx.ws.data.clientId);
  await router.publish("room:updates", {
    type: "ROOM:LIST",
    users: Array.from(members),
  });
});

router.on(SendMessage, async (ctx) => {
  await router.publish("room:messages", {
    type: "ROOM:MESSAGE",
    user: ctx.ws.data.clientId,
    text: ctx.payload.text,
  });
});
```

### Game Server with State

```typescript
router.on(GameActionSchema, async (ctx) => {
  // Save state
  await state.storage.put(`action:${Date.now()}`, ctx.payload);

  // Broadcast to all players in this game
  await router.publish("game:state", ctx.payload);
});
```

## TypeScript Support

Full TypeScript support with generic `TData` type parameter for custom connection data and type inference from message schemas.

## Related Packages

- [`@ws-kit/core`](../core/README.md) — Core router and types
- [`@ws-kit/zod`](../zod/README.md) — Zod validator adapter
- [`@ws-kit/valibot`](../valibot/README.md) — Valibot validator adapter
- [`@ws-kit/client`](../client/README.md) — Browser/Node.js client
- [`@ws-kit/bun`](../bun/README.md) — Bun platform adapter

## License

MIT
