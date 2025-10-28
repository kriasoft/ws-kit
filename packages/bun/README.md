# @ws-kit/bun

Bun.serve platform adapter leveraging Bun's native high-performance WebSocket features.

## Purpose

`@ws-kit/bun` provides the platform-specific integration layer for Bun, enabling direct use of Bun's `server.publish()` for zero-copy broadcasting and seamless integration with `Bun.serve()`.

## What This Package Provides

- **`createBunAdapter()`**: Factory returning a `PlatformAdapter` for use with `WebSocketRouter`
- **`BunPubSub`**: Native implementation leveraging Bun's `server.publish()` for zero-copy broadcasting
- **`createBunHandler()`**: Factory returning `{ fetch, websocket }` for `Bun.serve()` integration
- **Backpressure handling**: Automatic write buffer management
- **Compression support**: Native Bun compression support

## Platform Advantages Leveraged

- **Native PubSub**: Uses Bun's event-loop integrated broadcasting (no third-party message queue needed)
- **Zero-copy**: Messages broadcast without serialization overhead
- **Auto-cleanup**: Subscriptions cleaned up on connection close via Bun's garbage collection
- **Backpressure handling**: Respects WebSocket write buffer limits automatically

## Dependencies

- `@ws-kit/core` (required)
- `@types/bun` (peer) — only needed in Bun projects

## PubSub Scope

In Bun, `router.publish(channel, message)` broadcasts to **all listeners on that channel within the current Bun process**.

For multi-process deployments (load-balanced cluster), use `@ws-kit/redis-pubsub` for cross-process broadcasting.

## Integration Pattern

```typescript
import { createBunAdapter } from "@ws-kit/bun";
import { createBunHandler } from "@ws-kit/bun";
import { WebSocketRouter } from "@ws-kit/core";
import { zodValidator } from "@ws-kit/zod";

const router = new WebSocketRouter({
  platform: createBunAdapter(),
  validator: zodValidator(),
});

const { fetch, websocket } = createBunHandler(router);

Bun.serve({
  fetch,
  websocket,
});
```

## Implementation Status

Phase 3 (coming soon): Complete Bun adapter implementation.
