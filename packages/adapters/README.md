# @ws-kit/adapters

Adapter implementations for WS-Kit: rate limiters for single-instance, multi-pod, and serverless deployments.

## Overview

This package provides rate limiter adapters with identical interfaces but different implementations. Choose the adapter that matches your deployment model.

| Adapter             | Use Case             | Concurrency           | Atomicity  |
| ------------------- | -------------------- | --------------------- | ---------- |
| **Memory**          | Dev, single instance | Mutex per key         | Guaranteed |
| **Redis**           | Multi-pod production | Lua script            | Guaranteed |
| **Durable Objects** | Cloudflare Workers   | Single-threaded shard | Guaranteed |

All adapters pass the same contract test suite to ensure correctness.

## Installation

```bash
npm install @ws-kit/adapters @ws-kit/core
```

### Adapters (Optional Dependencies)

Each adapter requires its runtime dependencies:

```bash
# Memory adapter (no extra dependencies)
npm install @ws-kit/adapters

# Redis adapter
npm install redis

# Cloudflare Durable Objects adapter
npm install --save-dev wrangler  # For types
```

## Rate Limiter Adapters

### Memory Adapter

Zero-dependency, in-process rate limiter using token bucket algorithm.

**Best for:** Development, single-instance deployments, testing.

```typescript
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

const limiter = memoryRateLimiter({
  capacity: 100, // Max tokens available
  tokensPerSecond: 10, // Refill rate
});

// Atomically consume tokens
const decision = await limiter.consume("user:123", 1);
if (decision.allowed) {
  // Process message
} else {
  // Backoff hint
  console.log(`Retry after ${decision.retryAfterMs}ms`);
}
```

#### Clock Injection (Testing)

```typescript
const fakeTime = { current: Date.now() };

const limiter = memoryRateLimiter(
  { capacity: 10, tokensPerSecond: 1 },
  { clock: { now: () => fakeTime.current } },
);

// Consume tokens
await limiter.consume("user:1", 5);

// Time travel
fakeTime.current += 3000; // 3 seconds pass

// Tokens refilled
const result = await limiter.consume("user:1", 3);
expect(result.allowed).toBe(true);
```

### Redis Adapter

Distributed rate limiter using Redis Lua scripts for atomicity.

**Best for:** Multi-pod production deployments, shared state across instances.

```typescript
import { redisRateLimiter } from "@ws-kit/adapters/redis";
import { createClient } from "redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const limiter = redisRateLimiter(redisClient, {
  capacity: 100,
  tokensPerSecond: 10,
});

// Same interface as memory adapter
const decision = await limiter.consume("user:123", 1);
```

**Features:**

- Single Lua script for atomicity (no race conditions)
- Automatic TTL management (PEXPIRE) for stale bucket cleanup
- Shared Redis connection for multiple limiters (memory-efficient)
- Integer arithmetic for precision (no floating-point drift)

**Multi-Policy (Different Budgets for Different Operations):**

```typescript
const redisClient = createClient({ url: process.env.REDIS_URL });

// Both limiters share same connection
const cheap = redisRateLimiter(redisClient, {
  capacity: 200,
  tokensPerSecond: 100,
  prefix: "cheap:", // Namespace to prevent key collisions
});

const expensive = redisRateLimiter(redisClient, {
  capacity: 10,
  tokensPerSecond: 2,
  prefix: "expensive:",
});

// Independent rate limits for different operations
router.use(rateLimit({ limiter: cheap, cost: () => 1 }));
router.use(rateLimit({ limiter: expensive, cost: () => 5 }));
```

### Durable Objects Adapter

Sharded rate limiter using Cloudflare Durable Objects.

**Best for:** Cloudflare Workers, serverless edge computing, geographically distributed deployments.

```typescript
import { durableObjectRateLimiter } from "@ws-kit/adapters/cloudflare-do";

const limiter = durableObjectRateLimiter(env.RATE_LIMITER, {
  capacity: 100,
  tokensPerSecond: 10,
  shards: 128, // Distribute across 128 DOs (optional, default)
});

const decision = await limiter.consume("user:123", 1);
```

**Features:**

- Sharding (FNV-1a hash) for load distribution
- Persistent storage via Durable Object state
- Automatic cleanup via mark-and-sweep (24h TTL)
- Single-threaded per shard guarantees atomicity

**Setup (wrangler.toml):**

```toml
[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiterDO"

[[migrations]]
tag = "v1"
new_classes = ["RateLimiterDO"]
```

## Rate Limiter Interface

All adapters implement this interface:

```typescript
interface RateLimiter {
  /**
   * Atomically consume tokens from a rate limit bucket.
   */
  consume(key: string, cost: number): Promise<RateLimitDecision>;

  /**
   * Get the policy (capacity and refill rate) for this limiter.
   */
  getPolicy(): Policy;

  /**
   * Optional cleanup (close connections, clear timers, etc).
   */
  dispose?(): void;
}

type Policy = {
  capacity: number; // Max tokens available
  tokensPerSecond: number; // Refill rate
  prefix?: string; // Namespace prefix (optional)
};

type RateLimitDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      remaining: number;
      retryAfterMs: number | null; // null if cost > capacity
    };
```

**Policy Validation:**

All adapters validate policy at creation time:

- `capacity` must be ≥ 1
- `tokensPerSecond` must be > 0

Non-integer values are coerced to integers.

## Testing

### Contract Tests

Every adapter must pass the shared contract test suite. Run tests for a specific adapter:

```bash
bun test packages/adapters/test/memory.test.ts
bun test packages/adapters/test/redis.test.ts
```

The contract test suite (`packages/adapters/test/contract.ts`) validates:

- Basic consume (allowed/blocked)
- Weighted costs
- Cost > capacity (non-retryable)
- Multi-key isolation
- Concurrent requests (atomicity)
- Refill over time
- Prefix isolation
- Disposal behavior

### Using Contract Tests in Custom Adapters

To verify a custom adapter implementation:

```typescript
// custom-adapter.test.ts
import { describeRateLimiterContract } from "@ws-kit/adapters";

const testPolicy = { capacity: 10, tokensPerSecond: 1 };

describeRateLimiterContract("Custom", () => {
  return createMyCustomRateLimiter(testPolicy);
});
```

### Integration Tests

Test with middleware:

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

test("middleware blocks rate-limited requests", async () => {
  const limiter = rateLimit({
    limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
    key: keyPerUserPerType,
    cost: () => 1,
  });

  let handlerCalls = 0;
  router.use(limiter);
  router.on(TestMessage, () => handlerCalls++);

  // First 2 requests allowed
  for (let i = 0; i < 2; i++) {
    await router._core.websocket.message(mockWs, JSON.stringify(...));
  }

  // 3rd request blocked
  await router._core.websocket.message(mockWs, JSON.stringify(...));

  expect(handlerCalls).toBe(2);
});
```

## Implementing Custom Adapters

Create a custom adapter by implementing the `RateLimiter` interface:

```typescript
import type { Policy, RateLimiter, RateLimitDecision } from "@ws-kit/core";

export function createMyRateLimiter(policy: Policy): RateLimiter {
  // Validate policy
  if (policy.capacity < 1) throw new Error("capacity must be ≥ 1");
  if (policy.tokensPerSecond <= 0)
    throw new Error("tokensPerSecond must be > 0");

  // Your storage backend
  const buckets = new Map<string, TokenBucket>();

  return {
    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      const now = Date.now();
      const bucket = buckets.get(key) ?? {
        tokens: policy.capacity,
        lastRefill: now,
      };

      // 1. Refill based on elapsed time
      const elapsed = Math.max(0, (now - bucket.lastRefill) / 1000);
      bucket.tokens = Math.min(
        policy.capacity,
        bucket.tokens + elapsed * policy.tokensPerSecond,
      );
      bucket.lastRefill = now;

      // 2. Check cost availability
      if (bucket.tokens < cost) {
        const retryAfterMs =
          cost > policy.capacity
            ? null
            : Math.ceil(
                ((cost - bucket.tokens) / policy.tokensPerSecond) * 1000,
              );
        buckets.set(key, bucket);
        return {
          allowed: false,
          remaining: Math.floor(bucket.tokens),
          retryAfterMs,
        };
      }

      // 3. Deduct and persist
      bucket.tokens -= cost;
      buckets.set(key, bucket);
      return { allowed: true, remaining: Math.floor(bucket.tokens) };
    },

    getPolicy() {
      return policy;
    },

    dispose() {
      buckets.clear();
    },
  };
}
```

**Key Implementation Details:**

1. **Atomicity Guarantee** — The `consume()` operation must be atomic per key:
   - Memory: Use mutex/lock per key
   - Redis: Single Lua script
   - Durable Objects: Single-threaded per shard

2. **Integer Arithmetic** — Token counts use integer semantics:
   - Refill: `floor(elapsed_seconds * tokensPerSecond)`
   - Remaining: `floor(bucket.tokens)`
   - Cost: Validated as positive integer by middleware

3. **Clock Source** — Each adapter owns its time source:
   - Memory: `Date.now()` or injected clock (for testing)
   - Redis: `REDIS TIME` (atomically in Lua)
   - Durable Objects: `Date.now()`

4. **Prefix Isolation** — Optional prefix prevents key collisions:
   - Applied by adapter: `prefixedKey = prefix ? prefix + key : key`
   - Enables multiple rate limiters with independent namespaces

## Performance Characteristics

| Adapter | Latency | Throughput        | Storage           | Notes             |
| ------- | ------- | ----------------- | ----------------- | ----------------- |
| Memory  | <1ms    | Unlimited         | ~200 bytes/bucket | Single-thread JS  |
| Redis   | 2-5ms   | Network-dependent | Network           | Shared connection |
| DO      | 10-50ms | Per shard         | Persistent        | High availability |

## Common Patterns

### Tiered Rate Limiting

```typescript
const free = memoryRateLimiter({ capacity: 100, tokensPerSecond: 10 });
const premium = memoryRateLimiter({ capacity: 1000, tokensPerSecond: 100 });

router.use((ctx, next) => {
  const tier = ctx.ws.data?.tier ?? "free";
  const limiter = tier === "premium" ? premium : free;
  return rateLimit({ limiter, key: perUserKey, cost: () => 1 })(ctx, next);
});
```

### Cost-Based Differentiation

```typescript
const limiter = memoryRateLimiter({ capacity: 100, tokensPerSecond: 10 });

router.use(
  rateLimit({
    limiter,
    key: keyPerUserPerType,
    cost: (ctx) => {
      if (ctx.type === "HEAVY_COMPUTE") return 20;
      if (ctx.type === "DATABASE_QUERY") return 5;
      return 1;
    },
  }),
);
```

### Multi-Instance with Shared Redis

```typescript
const redisClient = createClient({ url: process.env.REDIS_URL });

// Each pod gets independent limiter instances pointing to same Redis
const limiter = redisRateLimiter(redisClient, {
  capacity: 200,
  tokensPerSecond: 100,
});

// All pods share the same rate limit bucket
router.use(rateLimit({ limiter, key: keyPerUserPerType }));
```

## Troubleshooting

### "Rate limit cost must be a positive integer"

Cost function must return integer. Check:

- No floating-point values (0.5, 1.5)
- No zero or negative values
- Deterministic (same input = same output)

```typescript
// ❌ Wrong
cost: (ctx) => (ctx.ws.data?.isPremium ? 0.5 : 1);

// ✅ Correct
cost: () => 1;
```

### "capacity must be ≥ 1"

Policy capacity must be at least 1. Check your configuration:

```typescript
// ❌ Wrong
memoryRateLimiter({ capacity: 0, tokensPerSecond: 1 });

// ✅ Correct
memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 });
```

### "tokensPerSecond must be > 0"

Refill rate must be positive. For sub-1 rates, scale both values:

```typescript
// ❌ Wrong
memoryRateLimiter({ capacity: 10, tokensPerSecond: 0.1 });

// ✅ Correct (represents 0.1 tokens/sec)
memoryRateLimiter({ capacity: 100, tokensPerSecond: 1 });
```

## Architecture

See [ADR-021: Adapter-First Architecture](../../docs/adr/021-adapter-first-architecture.md) for design rationale and future patterns (deduplication, presence, sessions).

## See Also

- [@ws-kit/middleware](../middleware) — Rate limiting middleware
- [@ws-kit/core](../core) — Router and types
- [Rate Limiting Proposal](../../docs/proposals/rate-limiting.md) — Full specification
