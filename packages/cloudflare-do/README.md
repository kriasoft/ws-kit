# @ws-kit/cloudflare-do

Cloudflare Durable Objects platform adapter.

## Purpose

`@ws-kit/cloudflare-do` enables ws-kit routers to work seamlessly with Cloudflare Durable Objects, leveraging DO's state durability and BroadcastChannel for efficient per-instance messaging.

## What This Package Provides

- **`createDurableObjectHandler()`**: Factory returning DO fetch handler
- **`DurablePubSub`**: Per-DO-instance broadcasting via `BroadcastChannel`
- **`federate()`**: Helper for explicit multi-DO coordination via HTTP RPC
- **State integration**: Access to `DurableObjectState` and persistent storage
- **Cost optimization**: Leverages Durable Objects' free broadcasting and cost model

## Platform Advantages Leveraged

- **State durability**: Each DO instance maintains persistent state
- **BroadcastChannel**: Low-latency in-memory messaging within a DO instance
- **Automatic coordination**: DOs inherently coordinate without distributed consensus
- **Cost optimization**: Broadcasts are free; only pays for fetch/RPC calls
- **Strong isolation**: Per-tenant isolation preventing cross-shard leaks
- **Automatic failover**: Cloudflare restarts failed instances

## ⚠️ Critical: Per-Instance Broadcast Scope

In Cloudflare DO, `router.publish()` broadcasts **ONLY to WebSocket connections within THIS DO instance**, not across shards.

For multi-DO setups (e.g., sharded chat rooms), use the `federate()` helper to explicitly broadcast across shard sets:

```typescript
import { federate } from "@ws-kit/cloudflare-do";

router.onMessage(AnnouncementSchema, async (ctx) => {
  const rooms = ["room:1", "room:2", "room:3"];

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

## Architecture Pattern

Designed for **per-resource DO instances** (one DO per chat room, game session, etc.), not multi-room broadcast from a single DO.

## Dependencies

- `@ws-kit/core` (required)
- `wrangler` (peer dev) — for local testing with `wrangler dev`

## Implementation Status

Phase 6 (coming soon): Complete Durable Objects adapter with state management and federation.
