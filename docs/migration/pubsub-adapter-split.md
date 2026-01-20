# Migration Guide: PubSubDriver Split (onRemotePublished Removal)

**Version**: 2.0.0+
**Scope**: Distributed pub/sub deployments (Redis, Cloudflare DO, Kafka)
**Impact**: Breaking change for distributed adapters; local (memory) adapters unaffected

## Overview

This guide explains how to migrate from the old `onRemotePublished` hook to the new explicit `BrokerConsumer` pattern.

### What Changed

**Old Design**:

```typescript
const adapter = redisPubSub(redis);
// onRemotePublished was optional method inside adapter
```

**New Design** (recommended):

```typescript
// Simple: auto-creates subscriber via duplicate()
const redis = createClient({ url: REDIS_URL });
await redis.connect();

const adapter = redisPubSub(redis);
// Plugin calls adapter.start() during init, auto-connects subscriber
```

**Advanced** (explicit subscriber for read replicas, different auth):

```typescript
const pub = createClient({ url: REDIS_URL });
const sub = createClient({ url: REDIS_REPLICA_URL });
await Promise.all([pub.connect(), sub.connect()]);

const adapter = redisPubSub(pub, { subscriber: sub });
```

### Why

The old design blurred adapter responsibilities. The new design provides:

- **Zero-config distributed**: `redisPubSub(redis)` auto-creates subscriber via `duplicate()`
- **Plugin-managed lifecycle**: `router.pubsub.init()` starts broker consumer
- **Single-delivery guarantee**: Plugin skips local delivery when broker handles it
- **Cleaner API**: No manual wiring of `deliverLocally()` callbacks

---

## Migration Path by Deployment Type

### 1. Local-Only (Memory Adapter)

**No changes needed.** Memory adapter is already pure local:

```typescript
import { memoryPubSub } from "@ws-kit/memory";

const adapter = memoryPubSub();
// Use as before—no ingress needed
```

### 2. Redis Deployment

#### Before

```typescript
import { redisPubSub } from "@ws-kit/redis";
import { createClient } from "redis";

const redis = createClient();
const adapter = redisPubSub(redis);

// Hook into onRemotePublished (if implemented)
if (adapter.onRemotePublished) {
  adapter.onRemotePublished(async (envelope) => {
    // Router would call deliverLocally() here
  });
}
```

#### After (Recommended)

```typescript
import { createRouter } from "@ws-kit/core";
import { redisPubSub } from "@ws-kit/redis";
import { withPubSub } from "@ws-kit/pubsub";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Auto-creates subscriber via duplicate() during init()
const adapter = redisPubSub(redis);

const router = createRouter().plugin(withPubSub({ adapter }));

// Plugin handles lifecycle: init() starts broker, shutdown() stops it
await router.pubsub.init();

// Clean up on shutdown
process.on("SIGTERM", async () => {
  await router.pubsub.shutdown();
});
```

### 3. Cloudflare Durable Objects

#### Before

```typescript
import { durableObjectsPubSub } from "@ws-kit/cloudflare";

const adapter = durableObjectsPubSub(env.DO_NAMESPACE);

if (adapter.onRemotePublished) {
  adapter.onRemotePublished(async (envelope) => {
    // Called when messages arrived from DO
  });
}
```

#### After

```typescript
import {
  durableObjectsPubSub,
  durableObjectsConsumer,
} from "@ws-kit/cloudflare";

const adapter = durableObjectsPubSub(env.DO_NAMESPACE);
const ingress = durableObjectsConsumer();

// Wire ingress to router
const stop = ingress.start(async (envelope) => {
  await deliverLocally(adapter, envelope);
});

// In your Durable Object's fetch handler:
export class TopicDO {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST" && request.url.endsWith("/publish")) {
      const envelope = await request.json();
      // Call the ingress handler
      await ingressHandler(envelope);
      return new Response("OK");
    }
    return new Response("Not found", { status: 404 });
  }
}
```

---

## Integration with Router

The plugin now handles all delivery automatically. Users call `ctx.publish()` and the plugin:

1. Builds a `PublishEnvelope` with topic, type, payload, and metadata
2. Calls `adapter.publish(envelope)` to send to the broker
3. If adapter has `start()` (distributed mode), broker delivers to all instances
4. If adapter is local-only, plugin delivers directly via `getSubscribers()`

```typescript
// User code - simple and clean
router.on(ChatMessage, async (ctx) => {
  await ctx.publish("room:123", BroadcastMessage, {
    text: ctx.payload.text,
    from: ctx.data.userId,
  });
});
```

No manual `getLocalSubscribers()` loops or frame encoding needed.

---

## `PublishResult` Return Type

Both old and new designs return a result object, but with different structure:

### New: Discriminated Union

```typescript
// Success case
{
  ok: true;
  capability: "exact" | "estimate" | "unknown";
  matchedLocal: number;
  details?: Record<string, unknown>;
}

// Failure case
{
  ok: false;
  error: PublishError;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Use type guards for safe handling:

```typescript
import { isPublishSuccess, isPublishError } from "@ws-kit/core/pubsub";

const result = await adapter.publish(envelope);

if (isPublishSuccess(result)) {
  console.log(`Delivered to ${result.matchedLocal} local subscribers`);
} else {
  if (result.retryable) {
    // Retry with backoff
  } else {
    // Permanent error; log and move on
  }
}
```

---

## Testing Distributed Adapters

Test distributed pub/sub using the test harness with a mock adapter:

```typescript
import { describe, test, expect } from "bun:test";
import { createRouter } from "@ws-kit/core";
import { createTestRouter } from "@ws-kit/core/testing";
import { withPubSub } from "@ws-kit/pubsub";
import type { PubSubAdapter } from "@ws-kit/core/pubsub";

describe("Distributed pub/sub", () => {
  test("delivers via broker (single delivery)", async () => {
    // Simulate a distributed adapter with start() method
    let onRemote: ((envelope: any) => void) | null = null;
    const subscriptions = new Map<string, Set<string>>();

    const adapter: PubSubAdapter = {
      async publish(envelope) {
        // Echo back via broker (simulates Redis pub/sub round-trip)
        if (onRemote) setTimeout(() => onRemote!(envelope), 0);
        return { ok: true, capability: "unknown" };
      },
      async subscribe(clientId, topic) {
        const clients = subscriptions.get(topic) ?? new Set();
        clients.add(clientId);
        subscriptions.set(topic, clients);
      },
      async unsubscribe(clientId, topic) {
        subscriptions.get(topic)?.delete(clientId);
      },
      async *getSubscribers(topic) {
        for (const id of subscriptions.get(topic) ?? []) yield id;
      },
      start(callback) {
        onRemote = callback;
        return () => {
          onRemote = null;
        };
      },
    };

    const tr = createTestRouter({
      create: () => createRouter().plugin(withPubSub({ adapter })),
    });

    // Subscribe and publish
    const conn = await tr.connect();
    // ... test message delivery
    await tr.close();
  });
});
```

---

## Error Handling

### Old Behavior

`onRemotePublished` would be called directly; errors thrown in handler would propagate.

### New Behavior

Ingress invokes handler; errors are caught and logged:

```typescript
ingress.start((envelope) => {
  try {
    // Router/platform delivery
    deliverLocally(adapter, envelope);
  } catch (err) {
    // Log and continue processing other messages
    console.error("Delivery failed:", err);
  }
});
```

If you need custom error handling, wrap the handler:

```typescript
ingress.start(async (envelope) => {
  try {
    await deliverLocally(adapter, envelope);
  } catch (err) {
    // Custom retry, dead-letter queue, etc.
    await handleDeliveryError(err, envelope);
  }
});
```

---

## Comparison Table

| Aspect             | Old (onRemotePublished) | New (BrokerConsumer)          |
| ------------------ | ----------------------- | ----------------------------- |
| **Location**       | Inside adapter          | Separate interface            |
| **Responsibility** | Adapter + ingress mixed | Pure ingress only             |
| **Testability**    | Harder to mock          | Easy to mock independently    |
| **Composability**  | Single source           | Multiple sources supported    |
| **API**            | Hook pattern            | Interface + `start()`         |
| **Lifecycle**      | Implicit in adapter     | Explicit `start()` / teardown |

---

## FAQ

**Q: Do I need to change anything for memory adapter?**

A: No. Memory adapter is unchanged—it's local-only and has no ingress.

**Q: Can I use multiple brokers?**

A: For most use cases, use a single adapter (e.g., `redisPubSub(redis)`). Multi-broker scenarios are advanced and require custom adapter composition—contact the maintainers if you have this requirement.

**Q: What if my adapter doesn't implement optional methods?**

A: They're optional. Check before calling:

```typescript
if (adapter.listTopics) {
  const topics = await adapter.listTopics();
}
```

**Q: How do I migrate from manual `redisConsumer` wiring?**

A: Use the unified adapter with auto-subscriber:

```typescript
// Before (manual wiring - deprecated)
const adapter = redisPubSub(redis);
const ingress = redisConsumer(redis);
ingress.start(deliverLocally);

// After (auto-subscriber - recommended)
const redis = createClient({ url: REDIS_URL });
await redis.connect();
const adapter = redisPubSub(redis); // Auto-creates subscriber via duplicate()
const router = createRouter().plugin(withPubSub({ adapter }));
await router.pubsub.init(); // Plugin starts broker consumer
```

---

## Deprecation Timeline

- **v2.0.0**: Introduce `BrokerConsumer`; keep `onRemotePublished` as deprecated
- **v2.2.0**: Remove `onRemotePublished` from type definitions
- **v3.0.0**: Remove all old adapter interfaces

Check release notes for your version's status.

---

## Support

For questions or issues, see:

- [ADR-023](../adr/023-pubsub-adapter-split.md) — Design rationale
- [docs/specs/adapters.md](../specs/adapters.md) — Adapter specification
- [examples/](../../examples/) — Working examples with all adapter types
