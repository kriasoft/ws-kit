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

**New Design**:

```typescript
const adapter = redisPubSub(redis); // Pure local adapter
const ingress = redisConsumer(redis); // Separate ingress handler
```

### Why

The old design blurred adapter responsibilities. Adapters are now **purely local**:

- Manage subscription index
- Report local subscriber counts
- Broadcast to local subscribers

Ingress is **purely inbound**:

- Consume broker messages
- Invoke router/platform callbacks
- Return cleanup function

This separation makes testing, composition, and understanding easier.

---

## Migration Path by Deployment Type

### 1. Local-Only (Memory Adapter)

**No changes needed.** Memory adapter is already pure local:

```typescript
import { memoryPubSub } from "@ws-kit/adapters/memory";

const adapter = memoryPubSub();
// Use as before—no ingress needed
```

### 2. Redis Deployment

#### Before

```typescript
import { redisPubSub } from "@ws-kit/adapters/redis";
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

#### After

```typescript
import { redisPubSub, redisConsumer } from "@ws-kit/adapters/redis";
import { createClient } from "redis";

const redis = createClient();
const adapter = redisPubSub(redis);
const ingress = redisConsumer(redis);

// Wire ingress to router's delivery function
const stop = ingress.start(async (envelope) => {
  // Platform/router delivers to local subscribers
  await deliverLocally(adapter, envelope);
});

// Clean up on shutdown
process.on("SIGTERM", () => {
  stop();
  adapter.close?.();
});
```

### 3. Cloudflare Durable Objects

#### Before

```typescript
import { durableObjectsPubSub } from "@ws-kit/adapters/cloudflare";

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
} from "@ws-kit/adapters/cloudflare";

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

The router's `ctx.publish()` method should be updated to use the new adapter interface:

### Current Router Code

```typescript
// Old: uses internal MemoryPubSub interface
await this.pubsub.publish(channel, payload, options);
```

### New Router Code

```typescript
// New: uses PubSubDriver interface
const envelope: PublishEnvelope = {
  topic: channel,
  payload,
  type: messageType,
  meta: metadata,
};

const result = await adapter.publish(envelope, {
  partitionKey: options?.partitionKey,
});

if (result.ok) {
  // Deliver locally using getLocalSubscribers
  const frame = encodeFrame(envelope);
  for await (const clientId of adapter.getLocalSubscribers(channel)) {
    if (options?.excludeSelf && clientId === ctx.clientId) continue;
    sessions.get(clientId)?.send(frame);
  }
} else {
  // Handle error: retry, log, etc.
}
```

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

## Testing with Mock Ingress

Test distributed deployments by mocking the ingress:

```typescript
import { describe, test } from "bun:test";
import { redisPubSub, redisConsumer } from "@ws-kit/adapters/redis";

describe("Redis pub/sub", () => {
  test("delivers remote message locally", async () => {
    const redis = createMockRedis();
    const adapter = redisPubSub(redis);
    const ingress = redisConsumer(redis);

    const delivered: PublishEnvelope[] = [];
    ingress.start((envelope) => {
      delivered.push(envelope);
    });

    // Simulate remote publish by invoking ingress directly
    const envelope: PublishEnvelope = {
      topic: "notifications",
      payload: { message: "hello" },
    };

    // Call ingress handler directly (simulating broker delivery)
    const handlers = redis.subscribers.get(`ws:notifications`);
    for (const handler of handlers || []) {
      await handler(JSON.stringify(envelope), `ws:notifications`);
    }

    assert.deepEqual(delivered, [envelope]);
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

**Q: Can I use multiple brokers now?**

A: Yes. You can start multiple ingressses and wire them to the same delivery function:

```typescript
const adapter = redisPubSub(redis);
const redisConsumer = redisConsumer(redis);
const kafkaIngress = kafkaIngress(kafka);

// Both brokers → same local delivery
redisConsumer.start(deliverLocally);
kafkaIngress.start(deliverLocally);
```

**Q: What if my adapter doesn't implement optional methods?**

A: They're optional. Check before calling:

```typescript
if (adapter.listTopics) {
  const topics = await adapter.listTopics();
}
```

**Q: Can I mix old and new adapters?**

A: During transition, yes. Create a wrapper if needed:

```typescript
// Adapter that supports both old onRemotePublished and new BrokerConsumer
const adapter = {
  ...redisPubSub(redis),
  onRemotePublished(handler) {
    // Delegate to new ingress
    return ingress.start(handler);
  },
};
```

This is temporary—deprecate after full migration.

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
