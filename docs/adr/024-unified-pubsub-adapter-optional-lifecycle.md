# ADR-024: Unified PubSubAdapter with Optional Lifecycle

**Date**: 2025-11-11
**Status**: Accepted
**Replaces**: ADR-023 (split driver/consumer design)
**Related**: docs/specs/pubsub.md, docs/specs/adapters.md, packages/adapters/src/compose.ts

## Context

ADR-023 split pub/sub concerns into two separate interfaces: `PubSubDriver` (local subscription + fan-out) and `BrokerConsumer` (broker ingestion). This design has clear separation of concerns but introduced friction in practice:

### Pain Points

1. **DX Tax for Adapter Authors**: Distributed adapters must export two disjoint pieces, and the router must conditionally wire them:

   ```typescript
   // Current (split) design
   const driver = redisPubSub(redis);
   const consumer = redisConsumer(redis);
   // Router must remember to attach consumer; easy to forget
   router.plugin(withPubSub(driver)); // Wait, where's the consumer?
   ```

2. **Router Complexity**: The plugin must conditionally check for and initialize consumers, adding wiring logic to the router layer.

3. **Test Friction**: Unit tests must juggle two interfaces, or invent a harness to compose them.

4. **Memory Adapter Overfitting**: Memory adapters are forced to export an unused `BrokerConsumer` interface, even though they have no ingress.

5. **User-Facing Complexity**: Applications must understand the split to use advanced features (e.g., multi-broker scenarios).

## Decision

**Unify the public interface while preserving internal modularity:**

1. **Single Public Interface: `PubSubAdapter`**
   - Combines all required methods from `PubSubDriver` (subscription index + local fan-out)
   - Adds optional `start?(onRemote)` method for distributed ingress
   - Memory adapters omit `start()` entirely (zero boilerplate)
   - Router calls `adapter.start?(...)` if present, no conditional wiring needed

2. **Internal Composition Helpers** (for adapter authors):
   - `withBroker(driver, consumer?)` — Compose a unified adapter from split pieces
   - `combineBrokers(...consumers)` — Merge multiple broker consumers for advanced use cases
   - These are optional; adapters can inline their implementation if preferred

3. **Keep `PubSubDriver` and `BrokerConsumer` as Internal Types**
   - Not removed; still useful for internal adapter composition
   - Not exported in public API (or exported only via `@ws-kit/adapters/compose`)
   - Adapter authors use these for implementation only

## Design Rationale

### Unified Surface, Optional Lifecycle

**Why this balances purity and pragmatism:**

- Simple adapters (memory): implement core methods, omit `start()`. Zero boilerplate.
- Distributed adapters (Redis, Kafka, DO): implement core methods + `start()`. Same surface.
- Router calls `adapter.start?.(...) ` unconditionally. No conditional wiring in user code.
- Plugin owns lifecycle. If adapter has ingress, plugin initializes it. If not, nothing happens.

### Preserves Modularity Internally

**Why the split still matters internally:**

- `PubSubDriver` and `BrokerConsumer` can evolve independently
- Adapters that need multi-broker ingestion use `combineBrokers()`
- Tests can unit-test driver (local semantics) and consumer (ingress) separately
- Advanced users can still compose custom adapters using helpers

### Better DX Without Sacrificing Power

**For adapter authors:**

```typescript
// Simple: memory has no ingress
export function memoryPubSub(): PubSubAdapter {
  return withBroker(createMemoryDriver());
}

// Distributed: include consumer
export function redisPubSub(redis: RedisClient): PubSubAdapter {
  return withBroker(createRedisDriver(redis), createRedisConsumer(redis));
}

// Advanced: multi-broker
export function hybridPubSub(redis, kafka): PubSubAdapter {
  return withBroker(
    createRedisDriver(redis),
    combineBrokers(createRedisConsumer(redis), createKafkaConsumer(kafka)),
  );
}
```

**For applications:**

```typescript
// Just pick an adapter, plug it in. Router handles the rest.
const router = createRouter<AppData>().plugin(withPubSub(memoryPubSub()));

router.on(Message, (ctx) => {
  await ctx.publish("topic", schema, payload);
});
```

### Eliminates Conditional Wiring

The router plugin doesn't need to know about consumers:

```typescript
// Old (ADR-023): router must check for both driver and consumer
const startFn = adapter.start?.(onRemote);

// New (ADR-024): same check, but it's internal to the adapter
// If consumer exists, it's built into the adapter.start() method.
```

## Implementation

### Core Interface (packages/core/src/capabilities/pubsub/adapter.ts)

```typescript
export interface PubSubAdapter {
  // Required: subscription index + local fan-out
  publish(
    envelope: PublishEnvelope,
    opts?: PublishOptions,
  ): Promise<PublishResult>;
  subscribe(clientId: string, topic: string): Promise<void>;
  unsubscribe(clientId: string, topic: string): Promise<void>;
  getSubscribers(topic: string): AsyncIterable<string>;

  // Optional: convenience methods
  listTopics?(): Promise<readonly string[]>;
  hasTopic?(topic: string): Promise<boolean>;
  replace?(
    clientId: string,
    topics: Iterable<string>,
  ): Promise<{ added: number; removed: number; total: number }>;

  // Optional: distributed ingress lifecycle
  start?(
    onRemote: (envelope: PublishEnvelope) => void | Promise<void>,
  ): void | (() => void) | Promise<() => void>;

  // Optional: cleanup
  close?(): Promise<void>;
}
```

### Composition Helpers (packages/adapters/src/compose.ts)

```typescript
export function withBroker(
  driver: PubSubDriver,
  consumer?: BrokerConsumer,
): PubSubAdapter {
  return Object.freeze({
    publish: driver.publish.bind(driver),
    subscribe: driver.subscribe.bind(driver),
    unsubscribe: driver.unsubscribe.bind(driver),
    getSubscribers: driver.getSubscribers.bind(driver),
    replace: driver.replace?.bind(driver),
    listTopics: driver.listTopics?.bind(driver),
    hasTopic: driver.hasTopic?.bind(driver),
    start: consumer ? consumer.start.bind(consumer) : undefined,
    close: driver.close?.bind(driver),
  });
}

export function combineBrokers(...consumers: BrokerConsumer[]): BrokerConsumer {
  return {
    async start(onRemote) {
      const stops: StopFn[] = [];
      try {
        for (const c of consumers) {
          const stop = await c.start(onRemote);
          stops.push(stop);
        }
      } catch (e) {
        await Promise.allSettled(stops.map((stop) => stop?.()));
        throw e;
      }
      return async () => {
        await Promise.allSettled(stops.map((stop) => stop?.()));
      };
    },
  };
}
```

### Memory Adapter Example

```typescript
export function memoryPubSub(): PubSubAdapter {
  const topics = new Map<string, Set<string>>();
  const clientTopics = new Map<string, Set<string>>();

  return {
    async publish(...): Promise<PublishResult> { ... },
    async subscribe(...): Promise<void> { ... },
    async unsubscribe(...): Promise<void> { ... },
    async *getSubscribers(...): AsyncIterable<string> { ... },
    async listTopics(): Promise<readonly string[]> { ... },
    async hasTopic(...): Promise<boolean> { ... },
    async replace(...): Promise<...> { ... },
    // No start() — memory has no ingress
    // No close() — nothing to clean up
  };
}
```

### Router Plugin (packages/pubsub/src/plugin.ts)

```typescript
export function withPubSub<TConn>(
  adapter: PubSubAdapter,
): Plugin<TConn, { pubsub: true }> {
  return (router: Router<TConn, any>) => {
    // ... publish() and subscriptions helpers ...

    // Initialize distributed ingress if adapter provides it
    if (typeof adapter.start === "function") {
      (router as any).__pubsubStart = async (onRemote) => {
        const result = adapter.start!(onRemote);
        return result instanceof Promise ? await result : result;
      };
    }

    // ... return enhanced router ...
  };
}
```

## Consequences

### Positive

1. **Simpler Public API**: One interface, optional methods. Lean, easy to understand.
2. **Better DX for Adapter Authors**: Export one thing. Let composition helpers handle the rest.
3. **No Wiring Boilerplate**: Router unconditionally calls `start?.()` if present. No conditional logic.
4. **Backward Compatible** (for adapters using `withBroker()`): Existing split driver/consumer code still works internally.
5. **Testability**: `withBroker()` + contract tests work the same; tests don't need to change.
6. **Power for Advanced Use Cases**: `combineBrokers()` enables multi-broker scenarios cleanly.

### Trade-offs

1. **One More Optional Method**: `start?()` is optional, so consumers need to check. Mitigated by using `withBroker()`.
2. **Less Explicit Separation**: The split between driver and consumer is now internal, not enforced by the type system. Mitigated by helper names and docs.
3. **Potential Confusion**: Developers unfamiliar with the history might conflate subscription tracking with ingress. Mitigated by clear docs and examples.

## Alternatives Considered

### Alternative 1: Keep ADR-023 Split Design

**Pros**: Clear separation of concerns, zero ambiguity about responsibilities.
**Cons**: Friction for adapter authors, router wiring complexity, memory adapter overfitting, user-facing split.

**Verdict**: Rejected. The pain points outweigh the benefits. Power users can still use helpers to split.

### Alternative 2: Make `start()` Required

**Pros**: No optional method, simpler contracts.
**Cons**: Memory adapter must export a no-op consumer. Boilerplate for simple cases.

**Verdict**: Rejected. Optional `start()` aligns with Unix philosophy: simple defaults, power for advanced use.

### Alternative 3: Keep Split, Just Add a Factory Wrapper

**Pros**: No API change, wrapper simplifies usage.
**Cons**: Doesn't fix underlying friction. Router still sees two pieces. Bridges not deeply integrated.

**Verdict**: Rejected. Unified interface is cleaner.

## Related

- **docs/specs/pubsub.md** — Updated with unified adapter documentation and examples
- **docs/specs/adapters.md** — Updated with adapter authoring guide (split vs. unified)
- **ADR-023** — Previous split design (still useful reference for design evolution)
- **packages/adapters/src/compose.ts** — Implementation of helpers

## Migration Path

### For Adapter Authors

If using `PubSubDriver` + `BrokerConsumer` (ADR-023):

1. Keep internal split if you prefer (no change needed).
2. Use `withBroker(driver, consumer?)` to return unified `PubSubAdapter`.
3. Export only the adapter factory; hide split details.

```typescript
// Before (exposing split)
export const redisPubSub = () => driver;
export const redisConsumer = () => consumer;

// After (unified)
export const redisPubSub = () => withBroker(driver, consumer);
// Optionally, keep helpers internal or in @ws-kit/adapters/compose
```

### For Applications

No change! Applications already use the unified adapter via `withPubSub()`.

### For Tests

Contract tests remain the same. `createPubSubContractTests()` works with unified `PubSubAdapter`.

## Sign-Off

This design resolves the DX friction of ADR-023 while preserving its benefits (modularity, composability, testability). It aligns with WS-Kit's philosophy: simple defaults, lean APIs, power for advanced users.
