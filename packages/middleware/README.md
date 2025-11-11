# @ws-kit/middleware

Middleware for WS-Kit WebSocket applications: rate limiting, and more.

## Overview

This package provides middleware for WebSocket applications built with WS-Kit. Rate limiting uses the **adapter pattern** to work across runtimes (Bun, Node.js, Cloudflare Workers) and backends (memory, Redis, Durable Objects).

## Features

- **Rate Limiting** — Token bucket rate limiting with pluggable adapters (memory, Redis, Durable Objects)
- **Atomic Operations** — No race conditions across concurrent requests or distributed deployments
- **Swappable Backends** — Change rate limiter storage without changing middleware code
- **Type-Safe** — Full TypeScript inference from context to decisions
- **Multi-Deployment** — Works in single-instance, multi-pod, and serverless environments

## Installation

```bash
npm install @ws-kit/middleware @ws-kit/core
```

## Quick Start: Rate Limiting

### Basic Setup (Single Instance)

```typescript
import { createRouter, message, z } from "@ws-kit/zod";
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/memory";
import { serve } from "@ws-kit/bun";

const router = createRouter();

// Create a memory-based rate limiter
const limiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUserPerType, // Fair per-user per-message-type isolation
  cost: () => 1, // 1 token per message
});

// Apply the middleware
router.use(limiter);

// Define your routes
const SendMessage = message("SEND_MESSAGE", {
  text: z.string(),
});

router.on(SendMessage, (ctx) => {
  // This handler only runs if rate limit passes
  ctx.publish("chat", SendMessage, { text: ctx.payload.text });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    return { userId: "user-123" };
  },
});
```

### Multi-Pod Deployment (Redis)

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { redisRateLimiter } from "@ws-kit/redis";
import { createClient } from "redis";

// Single Redis connection shared by all rate limiters
const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const limiter = rateLimit({
  limiter: redisRateLimiter(redisClient, {
    capacity: 200,
    tokensPerSecond: 100,
  }),
  key: keyPerUserPerType,
  cost: () => 1,
});

router.use(limiter);
```

### Cloudflare Workers (Durable Objects)

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { durableObjectRateLimiter } from "@ws-kit/cloudflare";

const limiter = rateLimit({
  limiter: durableObjectRateLimiter(env.RATE_LIMITER, {
    capacity: 200,
    tokensPerSecond: 100,
  }),
  key: keyPerUserPerType,
  cost: () => 1,
});

router.use(limiter);
```

## API Reference

### `rateLimit(options)`

Creates rate limit middleware for the router.

**Options:**

- `limiter` — RateLimiter instance (required). Adapter implementation (memory, redis, or durable objects)
- `key` — Key function to extract rate limit bucket (optional, default: `keyPerUserOrIpPerType`)
- `cost` — Cost function returning positive integer tokens (optional, default: `1`)

**Returns:** Middleware function

```typescript
type RateLimitOptions = {
  limiter: RateLimiter;
  key?: (ctx: IngressContext) => string;
  cost?: (ctx: IngressContext) => number;
};
```

### Key Functions

Three key functions ship by default:

#### `keyPerUserPerType(ctx)`

Fairness per operation type. Creates a rate limit bucket for each (tenant, user, message type) tuple.

**Use when:** You want to prevent one bursty operation from starving others.

```typescript
rateLimit({
  limiter,
  key: keyPerUserPerType, // Recommended for most cases
  cost: () => 1,
});
```

#### `perUserKey(ctx)`

Lighter memory footprint. Creates a bucket per (tenant, user).

**Use when:** You have 100+ message types (high cardinality) or memory is constrained.

```typescript
rateLimit({
  limiter,
  key: perUserKey,
  cost: (ctx) => (ctx.type === "Compute" ? 5 : 1), // Weight operations
});
```

#### `keyPerUserOrIpPerType(ctx)`

IP-based fallback for unauthenticated traffic. Creates a bucket per (tenant, user or IP, message type).

**Note:** IP is not available at middleware layer; defaults to "anon" for all unauthenticated traffic.

**Use when:** You expect mixed authenticated/unauthenticated traffic.

```typescript
rateLimit({
  limiter,
  key: keyPerUserOrIpPerType, // Default
  cost: () => 1,
});
```

### Cost Functions

The cost function determines how many tokens each message consumes.

**Requirements:**

- Must return a **positive integer** (validated at runtime)
- Must be deterministic (same message always costs same)
- Receives only `IngressContext` (payload not validated yet)

**Examples:**

```typescript
// 1 token per message (default)
cost: () => 1;

// Weight by operation cost
cost: (ctx) => {
  if (ctx.type === "Compute") return 10;
  if (ctx.type === "Database") return 5;
  return 1;
};

// Different limits per tier
cost: (ctx) => {
  const tier = ctx.ws.data?.tier ?? "free";
  return { free: 2, basic: 1, pro: 1 }[tier];
};
```

## Common Patterns

### Single Policy (All Messages Share Budget)

```typescript
const limiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUserPerType,
  cost: () => 1,
});

router.use(limiter);
```

### Multiple Policies (Independent Budgets)

```typescript
// Cheap operations
const cheap = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUserPerType,
  cost: () => 1,
});

// Expensive operations
const expensive = rateLimit({
  limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 2 }),
  key: keyPerUserPerType,
  cost: (ctx) => (ctx.type === "Compute" ? 5 : 1),
});

router.use(cheap);
router.use(expensive);
```

### Tiered Rate Limiting

```typescript
const freeLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 10 }),
  key: keyPerUserPerType,
  cost: () => 1,
});

const premiumLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 1000, tokensPerSecond: 100 }),
  key: keyPerUserPerType,
  cost: () => 1,
});

router.use((ctx, next) => {
  const isPremium = ctx.ws.data?.isPremium ?? false;
  const limiter = isPremium ? premiumLimiter : freeLimiter;
  return limiter(ctx, next);
});
```

### Observability

```typescript
serve(router, {
  port: 3000,
  onLimitExceeded(info) {
    if (info.type === "rate") {
      metrics.increment("rate_limit_exceeded", {
        limit: info.limit,
        retryAfterMs: info.retryAfterMs,
      });

      if (info.retryAfterMs === null) {
        // Cost > capacity (impossible under policy)
        alerts.warn("Rate limit cost misconfiguration", {
          limit: info.limit,
          cost: info.observed,
        });
      }
    }
  },
});
```

## Migration from Manual Rate Limiting

### Before (Manual)

```typescript
const requestCounts = new Map<string, number>();

router.use((ctx, next) => {
  const userId = ctx.ws.data?.userId ?? "anon";
  const count = requestCounts.get(userId) ?? 0;

  if (count >= 100) {
    ctx.error("RESOURCE_EXHAUSTED", "Rate limit exceeded");
    return;
  }

  requestCounts.set(userId, count + 1);
  return next();
});
```

### After (Adapter-Based)

```typescript
import { rateLimit, perUserKey } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 1 }),
  key: perUserKey,
  cost: () => 1,
});

router.use(limiter);
```

**Benefits:**

- ✅ Atomic token consumption (no race conditions)
- ✅ Distributed support (Redis, Durable Objects)
- ✅ Token refill semantics (burst-friendly)
- ✅ Multi-policy support without code changes
- ✅ Server-authoritative time (no client manipulation)

## Architecture

Rate limiting uses the **adapter-first pattern** to ensure atomicity and portability:

1. **Middleware** — Policy-agnostic; only knows about `RateLimiter` interface
2. **Adapter** — Implements atomic token consumption for specific backend:
   - Memory: Mutex guard + in-process map
   - Redis: Lua script (single atomic operation)
   - Durable Objects: Single-threaded per shard
3. **Factory** — Validates policy at creation time; handles backend-specific config

This separation means:

- Middleware never changes when adding adapters
- All adapters pass the same contract tests
- Backends can be swapped without code changes
- Future features (deduplication, presence) reuse the same pattern

## Current Limitations

- **Execution timing**: Rate limiting runs after schema validation. This means the payload is validated even if the request will be rate limited. For most applications, this is fine; if you need rate limiting before validation, consider implementing it at the router level.

- **IP address not available**: The middleware layer doesn't have access to client IP. The `keyPerUserOrIpPerType` key function falls back to "anon" for unauthenticated traffic. Use `keyPerUserPerType` or `perUserKey` for better isolation of unauthenticated users.

## Future Enhancements

- Move rate limiting to pre-validation pipeline for efficiency
- Additional middleware (deduplication, presence tracking)

## Testing

### Unit Tests

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/memory";

test("should block requests exceeding rate limit", async () => {
  const fakeTime = { current: Date.now() };

  const limiter = memoryRateLimiter(
    { capacity: 10, tokensPerSecond: 1 },
    { clock: { now: () => fakeTime.current } },
  );

  // Consume all tokens
  for (let i = 0; i < 10; i++) {
    const result = await limiter.consume("user:1", 1);
    expect(result.allowed).toBe(true);
  }

  // Next request blocked
  const result = await limiter.consume("user:1", 1);
  expect(result.allowed).toBe(false);
  expect(result.retryAfterMs).toBeGreaterThan(0);

  // Time travel: advance clock
  fakeTime.current += 2000;

  // Tokens refilled
  const refilled = await limiter.consume("user:1", 1);
  expect(refilled.allowed).toBe(true);
});
```

### Integration Tests

See `packages/middleware/test/` for full integration test examples with router.

## Performance

- **Memory overhead:** ~200 bytes per active rate limit bucket
- **Latency:** <1ms for memory adapter, 2-5ms for Redis (network-dependent)
- **Concurrency:** Atomic operations guarantee correctness at scale

See `packages/adapters/test/` for contract test suite and benchmarks.

## Error Handling

When rate limited, the middleware throws a `_limitExceeded` error with metadata:

```typescript
{
  type: "rate",
  observed: 1,           // Tokens attempted
  limit: 10,             // Capacity
  retryAfterMs: 1250,    // Backoff hint (or null if cost > capacity)
}
```

The router handles this error and sends:

- **`RESOURCE_EXHAUSTED`** (retryable) — Client should retry after `retryAfterMs`
- **`FAILED_PRECONDITION`** (non-retryable) — Cost > capacity; client should not retry

## See Also

- [ADR-021: Adapter-First Architecture](../../docs/adr/021-adapter-first-architecture.md) — Design rationale
- [Rate Limiting Proposal](../../docs/proposals/rate-limiting.md) — Full specification
- [@ws-kit/adapters](../adapters) — Adapter implementations
- [@ws-kit/core](../core) — Router and types
