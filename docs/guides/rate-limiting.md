# Rate Limiting Guide

Protect your WebSocket server from abuse and control resource usage with atomic, distributed rate limiting. WS-Kit's adapter-first approach lets you seamlessly switch between single-instance and multi-pod deployments without changing your application code.

## Concepts

### Token Bucket Algorithm

Rate limiting uses the **token bucket** algorithm:

1. **Bucket**: Each rate limit key (user, message type, etc.) has a bucket
2. **Tokens**: The bucket contains tokens (initial = capacity)
3. **Consumption**: Each message consumes 1 or more tokens
4. **Refill**: Tokens are added over time at a constant rate (`tokensPerSecond`)
5. **Limit**: If insufficient tokens, the request is blocked and backoff time is computed

**Example**: Capacity=10, tokensPerSecond=1

- Initial: 10 tokens available
- After 1 second: 1 new token added (max 10)
- Each request consumes 1 token
- When empty, clients must wait ~1 second per token

### Atomicity Guarantees

Rate limiting is **atomic per adapter**, ensuring no double-spending:

- **Memory**: Per-key FIFO mutex (single-instance safe)
- **Redis**: Lua script (multi-pod safe)
- **Durable Objects**: Single-threaded per shard (Cloudflare safe)

### Server-Authoritative Time

Always uses server time (never client time):

- Memory adapter: `Date.now()`
- Redis adapter: `redis.call('TIME')`
- Durable Objects: Server clock

This prevents clients from bypassing limits via clock manipulation.

## Quick Start

### Single-Instance (Development)

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

const router = createRouter();

// Apply rate limiting to all messages
const limiter = rateLimit({
  limiter: memoryRateLimiter({
    capacity: 200, // Max 200 tokens per bucket
    tokensPerSecond: 100, // Add 100 tokens every second
  }),
  key: keyPerUserPerType, // Per-user per-message-type buckets
});

router.use(limiter);

serve(router, { port: 3000 });
```

### Multi-Pod (Production with Redis)

```typescript
import { createClient } from "redis";
import { rateLimit } from "@ws-kit/rate-limit";
import { redisRateLimiter } from "@ws-kit/redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const limiter = rateLimit({
  limiter: redisRateLimiter(redisClient, {
    capacity: 200,
    tokensPerSecond: 100,
  }),
  key: keyPerUserPerType,
});

router.use(limiter);
```

When rate limited, clients receive `RESOURCE_EXHAUSTED` error with `retryAfterMs` backoff hint.

## Adapters

### Memory Adapter

**Use when**: Single-instance deployment (dev, single Bun server, Node.js)

```typescript
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = memoryRateLimiter({
  capacity: 10,
  tokensPerSecond: 1,
});
```

**Features**:

- Zero external dependencies
- Per-key FIFO mutex ensures atomicity
- Optional clock injection for testing

**Limitations**:

- In-memory only (not shared across processes)
- No automatic cleanup (use for single-instance apps or external sweepers)

**Testing with injected clock**:

```typescript
const fakeTime = { current: Date.now() };

const limiter = memoryRateLimiter(
  { capacity: 10, tokensPerSecond: 1 },
  { clock: { now: () => fakeTime.current } },
);

// Advance time for deterministic testing
fakeTime.current += 5000; // Move forward 5 seconds
const result = await limiter.consume("user:1", 1);
// Bucket refilled 5 tokens, request succeeds
```

### Redis Adapter

**Use when**: Multi-pod deployment or shared state across servers

```typescript
import { createClient } from "redis";
import { redisRateLimiter } from "@ws-kit/redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const limiter = redisRateLimiter(client, {
  capacity: 200,
  tokensPerSecond: 100,
});
```

**Features**:

- Distributed: Works across multiple servers/pods
- Lua script ensures atomicity (single Redis operation)
- Automatic TTL: Keys expire after 2x refill window
- Connection pooling: Reuse single Redis connection

**Multiple policies with shared connection**:

```typescript
const cheap = redisRateLimiter(client, {
  capacity: 200,
  tokensPerSecond: 100,
  prefix: "cheap:", // Separate key namespace
});

const expensive = redisRateLimiter(client, {
  capacity: 10,
  tokensPerSecond: 2,
  prefix: "expensive:",
});

// Both share the same Redis connection, no overhead
```

**Custom TTL**:

```typescript
const limiter = redisRateLimiter(
  client,
  { capacity: 10, tokensPerSecond: 1 },
  { ttlMs: 120_000 }, // 2 minutes (default auto-calculated)
);
```

### Cloudflare Durable Objects Adapter

**Use when**: Cloudflare Workers with persistent coordination needs

```typescript
import { durableObjectRateLimiter } from "@ws-kit/cloudflare";

const limiter = durableObjectRateLimiter(env.RATE_LIMITER, {
  capacity: 200,
  tokensPerSecond: 100,
});
```

**Features**:

- Single-threaded per shard (atomic by design)
- Sharded across 128 DOs by default (configurable)
- Mark-and-sweep cleanup (hourly, 24h TTL)

**Custom shard count**:

```typescript
const limiter = durableObjectRateLimiter(
  env.RATE_LIMITER,
  { capacity: 200, tokensPerSecond: 100 },
  { shards: 256 }, // Use 256 shards instead of default 128
);
```

## Key Functions

Rate limit keys determine the isolation boundary. Choose based on your fairness model.

### keyPerUserPerType (Recommended)

One bucket per (tenant, user, message type). Prevents one operation from starving others.

```typescript
import { keyPerUserPerType } from "@ws-kit/rate-limit";

const limiter = rateLimit({
  limiter,
  key: keyPerUserPerType,
});

// Key format: "rl:{tenantId}:{userId}:{type}"
// Examples:
//   "rl:public:user_123:SEND_MESSAGE"
//   "rl:acme:user_456:COMPUTE"
```

**When to use**:

- Most applications
- Fair isolation across message types
- Typical cardinality: 5-30 types × 10k users = 150k buckets (acceptable)

### keyPerUser (Lighter Footprint)

One bucket per (tenant, user). Use cost() to weight operations.

```typescript
import { keyPerUser } from "@ws-kit/rate-limit";

const limiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUser,
  cost: (ctx) => (ctx.type === "ExpensiveOp" ? 10 : 1),
});

// Key format: "rl:{tenantId}:{userId}"
// All message types share the same budget
```

**When to use**:

- High-type-count apps (100+ distinct message types)
- Memory-constrained deployments
- Acceptable to weight operations within shared budget

### Custom Key Functions

Define custom logic for other isolation strategies:

```typescript
const limiter = rateLimit({
  limiter,
  key: (ctx) => {
    const userId = ctx.data?.userId;
    const tier = ctx.data?.tier ?? "free";
    return `rl:${tier}:${userId}:${ctx.type}`;
  },
});

// Separate buckets per tier, allowing per-tier rate limits
```

**Safe context fields for key functions**:

- `ctx.type` — Message type
- `ctx.id` — Connection ID
- `ctx.ip` — Client IP (empty at middleware layer; use router integration)
- `ctx.data` — Connection data from authenticate()
- `ctx.meta.receivedAt` — Server timestamp

**Unsafe fields** (not available before schema validation):

- `ctx.payload` — Not schema-validated yet

## Cost Functions

Control token cost per message. Must return a positive integer.

### Default Cost (1 Token per Message)

```typescript
const limiter = rateLimit({
  limiter,
  key: keyPerUserPerType,
  // cost defaults to 1
});
```

### Weighted by Operation Type

```typescript
const limiter = rateLimit({
  limiter,
  key: keyPerUserPerType,
  cost: (ctx) => {
    if (ctx.type === "Compute") return 10; // Expensive
    if (ctx.type === "Query") return 1; // Cheap
    return 2; // Default
  },
});
```

### Weighted by User Tier

Use separate limiters for separate tiers instead of variable cost:

```typescript
// Free tier: stricter limit
const freeLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
  key: keyPerUserPerType,
});

// Premium tier: generous limit
const premiumLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 1000, tokensPerSecond: 500 }),
  key: keyPerUserPerType,
});

// Route-specific middleware selection
router.use((ctx, next) => {
  if (ctx.data?.isPremium) {
    return premiumLimiter(ctx, next);
  }
  return freeLimiter(ctx, next);
});
```

### Validation (Runtime Checks)

Cost must be a positive integer. Non-integers or non-positive values are rejected:

```typescript
// ✅ Valid: positive integers
cost: (ctx) => 1;
cost: (ctx) => (ctx.type === "Expensive" ? 5 : 1);

// ❌ Invalid: rejected with INVALID_ARGUMENT error
cost: (ctx) => 0.5; // Non-integer
cost: (ctx) => 0; // Zero
cost: (ctx) => -1; // Negative
cost: (ctx) => Math.random(); // Unpredictable
```

## Multiple Policies

Run independent limiters with different policies on the same connection.

### Different Budgets for Different Operations

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

// Cheap operations: generous limit
const cheapLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUserPerType,
  cost: (ctx) => 1,
});

// Expensive operations: strict limit
const expensiveLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 2 }),
  key: keyPerUserPerType,
  cost: (ctx) => 5,
});

router.use(cheapLimiter);
router.use(expensiveLimiter);
```

When rate limited by either policy, clients get `RESOURCE_EXHAUSTED` with appropriate `retryAfterMs`.

### Multi-Pod with Shared Connection

```typescript
import { redisRateLimiter } from "@ws-kit/redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

// Multiple limiters from same client (zero overhead)
const fast = redisRateLimiter(redisClient, {
  capacity: 500,
  tokensPerSecond: 250,
  prefix: "fast:",
});

const slow = redisRateLimiter(redisClient, {
  capacity: 10,
  tokensPerSecond: 1,
  prefix: "slow:",
});

router.use(rateLimit({ limiter: fast, key: keyPerUserPerType }));
router.use(rateLimit({ limiter: slow, key: keyPerUserPerType }));
```

## Testing

### Deterministic Testing (Memory Adapter)

Use clock injection for time-travel testing without real delays:

```typescript
import { test } from "bun:test";
import { memoryRateLimiter } from "@ws-kit/memory";

test("rate limit refill", async () => {
  const fakeTime = { current: Date.now() };

  const limiter = memoryRateLimiter(
    { capacity: 10, tokensPerSecond: 1 },
    { clock: { now: () => fakeTime.current } },
  );

  // Exhaust tokens
  for (let i = 0; i < 10; i++) {
    const result = await limiter.consume("user:1", 1);
    expect(result.allowed).toBe(true);
  }

  // 11th request fails
  let result = await limiter.consume("user:1", 1);
  expect(result.allowed).toBe(false);
  expect(result.retryAfterMs).toBeGreaterThan(0);

  // Advance time by 5 seconds
  fakeTime.current += 5000;

  // 5 new tokens added, request succeeds
  result = await limiter.consume("user:1", 1);
  expect(result.allowed).toBe(true);
  expect(result.remaining).toBe(4);
});
```

### Integration Testing

Use real middleware with test utilities:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

test("rate limit integration", async () => {
  const SendMsg = message("SEND", { text: z.string() });
  const router = createRouter<{ userId: string }>();

  const limiter = rateLimit({
    limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
    key: keyPerUserPerType,
  });

  router.use(limiter);

  router.on(SendMsg, (ctx) => {
    ctx.send(SendMsg, { text: "ok" });
  });

  // Create mock connection
  const mockContext = {
    type: "SEND",
    ws: { data: { userId: "user:1" } },
    // ... other context fields
  };

  // First 2 messages succeed
  await limiter(mockContext, () => Promise.resolve());
  await limiter(mockContext, () => Promise.resolve());

  // 3rd message fails (rate limited)
  await expect(limiter(mockContext, () => Promise.resolve())).rejects.toThrow(
    "Rate limit exceeded",
  );
});
```

## Common Patterns

### Per-Route Rate Limiting

Apply different limits to specific message types:

```typescript
const globalLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 }),
  key: keyPerUserPerType,
});

const strictLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 }),
  key: keyPerUserPerType,
});

router.use(globalLimiter);

// Apply stricter limit to expensive operation
router.on(ExpensiveOp, (ctx, next) => {
  // This runs after global limit, applying additional restriction
  // Can use middleware composition for selective application
  return next();
});
```

### Tiered Rate Limits

Different limits per subscription tier:

```typescript
const freeLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 20, tokensPerSecond: 5 }),
  key: keyPerUserPerType,
});

const premoLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUserPerType,
});

const proLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 2000, tokensPerSecond: 1000 }),
  key: keyPerUserPerType,
});

router.use((ctx, next) => {
  const tier = ctx.data?.tier ?? "free";

  if (tier === "pro") {
    return proLimiter(ctx, next);
  } else if (tier === "premo") {
    return premiumLimiter(ctx, next);
  }
  return freeLimiter(ctx, next);
});
```

### Metrics and Observability

```typescript
serve(router, {
  port: 3000,
  onLimitExceeded(info) {
    if (info.type === "rate") {
      metrics.increment("rate_limit.exceeded", {
        client_id: info.clientId,
        cost: info.observed,
        capacity: info.limit,
        retryable: info.retryAfterMs !== null,
      });

      logger.warn("Rate limit exceeded", {
        clientId: info.clientId,
        observed: info.observed,
        limit: info.limit,
        retryAfterMs: info.retryAfterMs,
      });
    }
  },
});
```

## Troubleshooting

### "Rate limit exceeded" errors in tests

**Problem**: Tests are failing with rate limit errors unexpectedly.

**Solution**: Use clock injection with memory adapter for deterministic testing:

```typescript
const fakeTime = { current: Date.now() };
const limiter = memoryRateLimiter(policy, {
  clock: { now: () => fakeTime.current },
});

// Advance time as needed
fakeTime.current += 1000; // Add 1 second
```

### IP-based rate limiting not working

**Problem**: All unauthenticated users share "anon" bucket regardless of IP.

**Reason**: IP is not available at middleware layer (runs post-validation). The proposal specifies step 3 (pre-validation) for IP access.

**Solution Options**:

1. Use authentication (recommended) — Rate limit by user ID
2. Use custom key function with other identifiers (connection ID, session)
3. Wait for router-level rate limiting integration (future)

```typescript
// Workaround: Use connection ID per-type
key: (ctx) => `rl:${ctx.id}:${ctx.type}`;
// Note: This is per-connection, not per-IP (won't prevent distributed attacks)
```

### Redis key growth unbounded

**Problem**: Rate limit keys in Redis keep growing.

**Solution**: Redis adapter automatically sets TTL (2x refill window, minimum 60s). Idle keys expire automatically:

```typescript
const limiter = redisRateLimiter(client, {
  capacity: 10,
  tokensPerSecond: 1,
  // TTL auto-calculated: max(2*10/1*1000, 60000) = 60000ms = 60s
});

// Custom TTL if needed
const limiter = redisRateLimiter(
  client,
  { capacity: 10, tokensPerSecond: 1 },
  { ttlMs: 120_000 }, // 2 minutes
);
```

### Cost > capacity always fails

**Problem**: Operations with cost > capacity always return `retryAfterMs: null` (non-retryable).

**Reason**: This is by design. If cost exceeds capacity, the operation can never succeed, even with infinite time.

**Solution**: Increase capacity or decrease cost:

```typescript
// Before (impossible):
// limiter: { capacity: 5, tokensPerSecond: 1 }
// cost: (ctx) => ctx.type === "Expensive" ? 10 : 1
// ❌ Expensive operations never succeed

// After (possible):
// limiter: { capacity: 20, tokensPerSecond: 10 }
// cost: (ctx) => ctx.type === "Expensive" ? 10 : 1
// ✅ Expensive operations succeed once per 2 seconds on average
```

### Inconsistent limits across pods

**Problem**: Each pod has separate memory limits; users see different limits.

**Solution**: Use Redis adapter for distributed coordination:

```typescript
// ❌ Wrong: Each pod has separate limits
const limiter = memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 });

// ✅ Correct: Shared across all pods via Redis
const limiter = redisRateLimiter(redisClient, {
  capacity: 100,
  tokensPerSecond: 50,
});
```
