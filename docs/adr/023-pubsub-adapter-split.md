# ADR-023: Split PubSubDriver and BrokerConsumer for Clean Responsibility Separation

**Date**: 2025-01-XX
**Status**: Accepted
**Replaces**: ADR-022 (integration details)
**Related**: docs/specs/pubsub.md, docs/specs/adapters.md

## Context

The previous pub/sub adapter design included an optional `onRemotePublished` hook within the `PubSubDriver` interface. This created ambiguity about adapter responsibilities:

- Adapters were documented as "local subscription index + local fan-out only"
- Yet the interface included broker ingress wiring (`onRemotePublished`)
- This blurred the line between adapter concerns (subscription tracking) and platform concerns (broker consumption)

Distributed deployments (Redis, Cloudflare DO, Kafka) need to:

1. Maintain a local subscription index
2. Publish to a broker
3. Consume broker messages and invoke router callbacks

The combined `onRemotePublished` hook didn't clearly separate these concerns, making it hard to test, compose, or understand each layer's responsibility.

## Decision

**Split the pub/sub layer into two explicit interfaces:**

1. **`PubSubDriver`** — Pure local responsibility:
   - Maintains subscription index
   - Tracks per-client topic subscriptions
   - Broadcasts router-materialized messages to matching local subscribers
   - Returns local subscriber stats (capability + matchedLocal count)
   - **Never** consumes broker messages or calls back into router

2. **`BrokerConsumer`** — Pure inbound responsibility:
   - Consumes messages from broker (Redis SUBSCRIBE, Kafka, Cloudflare DO callbacks, etc.)
   - Invokes router/platform callback with `PublishEnvelope`
   - Returns teardown function for cleanup
   - **Never** maintains subscription state or delivers WebSocket frames

## Design Rationale

### Single Responsibility

Each interface has one clear job:

- **PubSubDriver**: "Where are my local subscribers for this topic?"
- **BrokerConsumer**: "Tell me when messages arrive from the broker"

Testing and mocking become straightforward—mock each concern independently.

### Composability

Distributed adapters export both utilities, but they're loosely coupled:

```typescript
const adapter = redisPubSub(redis); // Local index + egress
const ingress = redisConsumer(redis); // Broker ingress only

// Router/platform wires them together
ingress.start((envelope) => deliverLocally(adapter, envelope));
```

Advanced deployments can:

- Use multiple broker sources (Redis + Kafka)
- Apply custom filtering/transformation between ingress and delivery
- Mock either piece independently for testing
- Scale subscription index separately from broker consumption

### Backward Compatibility

Memory adapter needs no changes—it's purely local, has no ingress:

```typescript
const adapter = memoryPubSub(); // Local only, no ingress needed
```

### Router Integration

Router's responsibility is clear:

1. Validate schema and build `PublishEnvelope`
2. Call `adapter.publish(envelope)` → returns local stats
3. Iterate `adapter.getLocalSubscribers(topic)` and deliver to WebSockets
4. (Separately) Initialize `ingress.start(handler)` to wire broker → local delivery

This keeps the router's role orthogonal to adapter concerns.

## Implementation

### Types (core/pubsub)

```typescript
/**
 * Pub/Sub adapter: subscription index + local fan-out only.
 * Never consumes broker messages or calls back into router.
 */
export interface PubSubDriver {
  publish(
    envelope: PublishEnvelope,
    opts?: PublishOptions,
  ): Promise<PublishResult>;
  subscribe(clientId: string, topic: string): Promise<void>;
  unsubscribe(clientId: string, topic: string): Promise<void>;
  getLocalSubscribers(topic: string): AsyncIterable<string>;
  listTopics?(): Promise<readonly string[]>;
  hasTopic?(topic: string): Promise<boolean>;
  close?(): Promise<void>;
}

/**
 * Broker ingress: message consumption only.
 * Decoupled from subscription indexing and delivery.
 */
export interface BrokerConsumer {
  start(
    onMessage: (envelope: PublishEnvelope) => void | Promise<void>,
  ): () => void;
}
```

### Memory Adapter (unchanged)

```typescript
const adapter = memoryPubSub(); // No ingress; local-only
// Works as-is
```

### Redis Adapter + Ingress

```typescript
// Adapter: local index + Redis egress
const adapter = redisPubSub(redis, { channelPrefix: "ws:" });

// Ingress: Redis inbound
const ingress = redisConsumer(redis, { channelPrefix: "ws:" });

// Wire together (platform/router responsibility)
ingress.start((envelope) => deliverLocally(adapter, envelope));
```

### Cloudflare DO Adapter + Ingress

```typescript
// Adapter: local index + DO egress
const adapter = durableObjectsPubSub(env.DO_NAMESPACE);

// Ingress: DO callback handler
const ingress = durableObjectsConsumer();

// Router/DO calls ingress when messages arrive
ingress.start((envelope) => deliverLocally(adapter, envelope));

// In your DO's fetch() handler:
if (request.method === "POST" && request.url.endsWith("/publish")) {
  const envelope = await request.json();
  await ingressHandler(envelope);
}
```

## Consequences

### Benefits

- **Clarity**: Each layer has one job, clearly documented
- **Testability**: Mock adapter and ingress independently
- **Composability**: Multiple brokers, selective fan-in, custom filters
- **Flexibility**: Apps choose how to wire ingress (HTTP callback, alarms, queues, etc.)

### Drawbacks

- **One extra import** for distributed setups (adapter + ingress)
- **Router integration changes** needed (from monolithic adapter to split design)
- **Slight boilerplate** for wiring ingress (mitigated by examples)

### Migration Path

1. Define `BrokerConsumer` interface (✓ completed)
2. Remove `BrokerConsumer` from `PubSubDriver` (✓ completed)
3. Create Redis adapter + ingress (✓ completed)
4. Create Cloudflare DO adapter + ingress (✓ completed)
5. Update router to use new adapter interface (pending)
6. Deprecate old `BrokerConsumer` hook (deferred)
7. Update documentation and examples (pending)

## Related Standards

- **publish()**: Returns `PublishResult` discriminated union with capability level
- **getLocalSubscribers()**: Lazy `AsyncIterable<string>` for backpressure support
- **matchedLocal**: Always present on success (0 if no subscribers)
- **capability**: "exact" (memory), "estimate" (distributed with lower-bound), "unknown" (can't count)
