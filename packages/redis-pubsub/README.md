# @ws-kit/redis-pubsub

Optional Redis PubSub adapter for distributed deployments (post-launch).

## Purpose

`@ws-kit/redis-pubsub` enables cross-process broadcasting for multi-instance deployments (Bun clusters, Node.js clusters, etc.) by plugging a Redis-based `PubSub` implementation into the core router.

## What This Package Provides

- **`createRedisPubSub()`**: Factory returning a `PubSub` implementation using Redis
- **Cross-process broadcasting**: Enables `router.publish()` to reach all server instances
- **Connection pooling**: Automatic client management and reconnection
- **Channel namespacing**: Helpers for multi-tenancy
- **Works with any platform**: Bun, Cloudflare (via fallback), Node.js, Deno, etc.

## When to Use

- ✅ Multiple Bun instances behind a load balancer
- ✅ Node.js cluster deployments
- ✅ Any deployment requiring cross-process messaging
- ✅ Stateless server scaling with shared broadcast channel

## When NOT Needed

- ❌ Single Bun process (use default `MemoryPubSub` or `BunPubSub`)
- ❌ Cloudflare DO (use `DurablePubSub` with `federate()`)
- ❌ Single-server deployments (use `MemoryPubSub`)

## Integration Pattern

```typescript
import { WebSocketRouter } from "@ws-kit/core";
import { createBunAdapter } from "@ws-kit/bun";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import { zodValidator } from "@ws-kit/zod";

const router = new WebSocketRouter({
  platform: createBunAdapter(),
  validator: zodValidator(),
  pubsub: createRedisPubSub({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  }),
});

// router.publish() now reaches all server instances
router.onMessage(BroadcastSchema, async (ctx) => {
  await router.publish("notifications", ctx.payload);
});
```

## Dependencies

- `@ws-kit/core` (required)
- `redis` (peer) — Redis client library for your environment

## Design Philosophy

Optional add-on that plugs into the core router's PubSub interface. Core works without it; enables scaling beyond single-server.

## Implementation Status

Phase 8 (post-launch): Complete Redis PubSub adapter with connection pooling and resilience.
