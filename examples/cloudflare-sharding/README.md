# Cloudflare Durable Objects Sharding

Production-ready example of scaling pub/sub across multiple Durable Object instances by sharding subscriptions based on scope (room/channel).

## Problem

Cloudflare Durable Objects have a 100-connection limit per instance. Without sharding, you can only support 100 concurrent subscribers per room. Beyond that, you hit the limit and new connections fail.

## Solution

Shard rooms across multiple DO instances using **stable hashing** of the room name:

```
room:general → hash → DO instance #2
room:random  → hash → DO instance #5
room:gaming  → hash → DO instance #8
```

Same room always routes to the same DO instance, ensuring all subscribers for a room are in one place. Add more DO instances without code changes.

## Architecture

This example uses the **`getShardedStub()`** helper from `@ws-kit/cloudflare-do/sharding` for clean, production-ready sharding:

- **`router.ts`** — Worker entry point that routes incoming requests to sharded DO instances
- **`server.ts`** — Durable Object class that handles WebSocket connections and pub/sub for a shard
- **`wrangler.toml`** — Configuration for Durable Object binding and deployment

## Quick Start

1. **Install dependencies**:

   ```bash
   bun install
   ```

2. **Configure `wrangler.toml`**:
   - Set your Cloudflare `account_id`
   - Adjust `durable_objects.bindings` if deploying to a different service

3. **Deploy**:

   ```bash
   wrangler deploy
   ```

4. **Connect a client**:

   ```typescript
   import { z, wsClient, message } from "@ws-kit/client/zod";

   const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
   const RoomUpdate = message("ROOM_UPDATE", {
     roomId: z.string(),
     text: z.string(),
     userId: z.string(),
   });

   const client = wsClient("wss://api.example.com");

   client.on("connected", () => {
     // Connect to a room (routed to sharded DO)
     client.send(JoinRoom, { roomId: "general" });
   });

   client.on(RoomUpdate, (payload) => {
     console.log(`[${payload.roomId}] ${payload.userId}: ${payload.text}`);
   });
   ```

## Key Pattern

The `getShardedStub()` helper computes a stable shard ID and routes the request:

```typescript
// router.ts (Worker entry point)
import { getShardedStub } from "@ws-kit/cloudflare-do/sharding";

const roomId = new URL(req.url).searchParams.get("room") ?? "general";

// Same room always routes to the same DO instance
const stub = getShardedStub(env, `room:${roomId}`, 10);

// Forward HTTP upgrade to the sharded DO
return stub.fetch(req);
```

## Configuration

1. **Shard count** (`10` in the example): Number of DO instances to distribute rooms across
2. **Durable Object binding** in `wrangler.toml`:
   ```toml
   [[durable_objects.bindings]]
   name = "ROUTER"
   class_name = "WebSocketRouter"
   ```
3. **Deploy**: Cloudflare auto-creates DO instances as needed

## Benefits

- ✅ **Linear scaling**: Add DO instances to handle more rooms/connections
- ✅ **No cross-instance coordination**: Each room lives on one DO (broadcasts are free via BroadcastChannel)
- ✅ **Stable routing**: Same room always routes to same DO (deterministic hash)
- ✅ **Type-safe**: Full TypeScript inference from schema to handler
- ✅ **Production-ready**: Minimal, clean code using WS-Kit helpers

## Trade-offs & Considerations

- **Uneven distribution**: If rooms have very different subscriber counts, some shards may reach 100 connections before others
- **Fixed shard count**: Changing shard count remaps all existing scopes (requires migration period for persistent apps)
- **Per-shard isolation**: Broadcasts only reach subscribers on the same DO; cross-shard federation requires explicit `federate()` calls (see `@ws-kit/cloudflare-do`)

## Files

- **`router.ts`** — Worker entry point that routes requests to sharded DO instances using `getShardedStub()`
- **`server.ts`** — Durable Object class (`WebSocketRouter`) that handles WebSocket connections and pub/sub
- **`wrangler.toml`** — Cloudflare Worker configuration with Durable Object binding
