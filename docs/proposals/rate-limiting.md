# Feature Proposal: Built-In Rate Limiting (Adapter-First Design)

**Status**: ✅ Implemented
**Date**: 2025-11-01
**Concern**: "No built-in message throttling (application responsibility via middleware)"
**Focus**: **Multi-backend portability with correct distributed semantics** (Bun, Cloudflare Workers/DO, edge runtimes)
**Architecture**: [ADR-021: Adapter-First Architecture](../adr/021-adapter-first-architecture.md)

---

## Implementation Status

**This proposal has been fully implemented.** All components described below are production-ready:

- ✅ `RateLimiter` interface in `@ws-kit/core/src/types.ts`
- ✅ `rateLimit()` middleware in `@ws-kit/middleware`
- ✅ Memory adapter in `@ws-kit/memory`
- ✅ Redis adapter in `@ws-kit/redis`
- ✅ Cloudflare Durable Objects adapter in `@ws-kit/cloudflare`
- ✅ Comprehensive tests and contract validation
- ✅ Full integration with router error handling

**Key implementation details:**

- `RateLimiter` interface includes `getPolicy()` method (required for middleware to report capacity)
- Middleware executes at step 6 (post-validation) rather than step 3 (pre-validation) due to architectural constraints
- IP fallback for unauthenticated users not available at middleware layer; use custom key functions or router-level integration
- All adapters pass the same atomicity and fairness contract tests

**Quick start:**

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUserPerType,
});

router.use(limiter);
```

See [docs/guides/rate-limiting.md](/guides/rate-limiting) for detailed usage examples.

---

## Overview

This proposal demonstrates **[ADR-021: Adapter-First Architecture](../adr/021-adapter-first-architecture.md)** in practice. Rate limiting is the first feature to use the adapter pattern, establishing a template for future stateful features (deduplication, presence, sessions).

The adapter-first doctrine:

1. Core defines the interface (contract)
2. Middleware consumes the interface (policy-agnostic)
3. Apps choose adapters (storage, runtime-specific)
4. All adapters pass the same test suite (correctness guarantees)

## Executive Summary

Rate limiting in distributed systems requires **atomicity, server-authoritative time, and integration with error semantics**. The adapter-first approach provides correctness guarantees across runtimes while keeping the core router lean.

**Revised recommendation**: Define `RateLimiter` adapter interface (atomic `consume()` operation) in `@ws-kit/core` and build middleware around it. This ensures:

- ✅ **Correctness**: Atomic token mutations prevent race conditions across pods/isolates
- ✅ **Portability**: Memory (Bun/Node), Redis (multi-pod), Durable Objects (Workers)
- ✅ **Security**: Server-authoritative time (`ctx.receivedAt`), never client timestamps
- ✅ **UX**: Standard error envelope (`RESOURCE_EXHAUSTED` + `retryAfterMs`)
- ✅ **Observability**: Metrics hooks for Prometheus/OTLP integration

**Delivery approach**:

1. Define `RateLimiter` interface in `@ws-kit/core` (atomic semantics)
2. Create `@ws-kit/middleware` with `rateLimit()` middleware
3. Implement adapters (`@ws-kit/adapters`): memory, redis (with Lua), durableObjects (with sharding)
4. Contract tests validate all adapters under concurrency

---

## Current Capabilities (Already Shipped)

Rate limiting **is possible today** without any changes:

### Global Rate Limiting (All Messages)

```typescript
const rateLimiter = new Map<string, number[]>();

router.use((ctx, next) => {
  const userId = ctx.data?.userId || "anon";
  const now = Date.now();
  const timestamps = rateLimiter.get(userId) ?? [];
  const recentCount = timestamps.filter((t) => now - t < 1000).length;

  if (recentCount >= 10) {
    ctx.error(
      "RESOURCE_EXHAUSTED",
      "Max 10 messages/sec",
      { limit: 10, current: recentCount },
      { retryable: true, retryAfterMs: 100 },
    );
    return;
  }

  timestamps.push(now);
  rateLimiter.set(userId, timestamps);
  return next();
});
```

### Per-Route Rate Limiting

```typescript
router.use(SendMessage, (ctx, next) => {
  // Apply only to SendMessage, not to other operations
  // Can have stricter limits for expensive operations
  return next();
});
```

### Per-Connection State Tracking

```typescript
type AppData = { userId?: string; messageCount?: number };

router.use((ctx, next) => {
  ctx.assignData({
    messageCount: (ctx.data.messageCount ?? 0) + 1,
  });

  if (ctx.data.messageCount > 1000) {
    ctx.error("RESOURCE_EXHAUSTED", "Connection limit reached");
    return;
  }

  return next();
});
```

### Cleanup on Connection Close

```typescript
router.onClose((ctx) => {
  rateLimiter.delete(ctx.data?.userId);
});
```

---

## The Distributed Correctness Problem

Naive implementations of token bucket rate limiting **fail in distributed systems** because they assume atomic memory access. This section identifies the correctness gaps and the adapter solution.

### Why Simple KVStore Fails

The naive algorithm performs a read-modify-write sequence:

```typescript
// ❌ INCORRECT: Race condition window
const bucket = await store.get(key);         // 1. Read
const tokens = bucket.tokens + refill(...);  // 2. Compute
if (tokens < 1) return LIMIT;               // 3. Check
bucket.tokens = tokens - 1;                  // 4. Spend
await store.set(key, bucket);                // 5. Write
```

**The problem**: Between steps 3 and 5, another request from a different pod/isolate can see the same state and also pass the check. Both requests spend the same token.

**Example (two pods, cap=10, one token remaining)**:

```
Pod A: bucket.tokens = 1
Pod B: bucket.tokens = 1  ← Both see 1 token

Pod A: 1 >= 1 ✓ pass, spend → tokens = 0
Pod B: 1 >= 1 ✓ pass, spend → tokens = 0

Result: Both requests allowed; bucket is negative ❌
```

This **races in**:

- **Cloudflare Workers** (isolated contexts, DO eventual consistency)
- **Multi-pod Node.js** (separate memory spaces)
- **Bun with async I/O** (between await and write)

### The Solution: Atomic Consumption Interface

Define a single public interface that adapters implement atomically:

```typescript
export type Policy = {
  /** Bucket capacity (positive integer). Maximum tokens available. */
  capacity: number; // Must be ≥ 1, integer

  /** Refill rate in tokens per second (positive integer).
   * Token bucket uses integer arithmetic:
   * - At each consume(), elapsed seconds × tokensPerSecond tokens are added (floored)
   * - Supports rates ≥ 1 token/sec natively
   * - For sub-1 rates (e.g., 0.1 tok/sec), scale both values: tokensPerSecond: 1, capacity: 10 (represents 0.1×100)
   * - Float values are accepted but accumulated as integers via Math.floor()
   */
  tokensPerSecond: number; // Must be > 0, integer

  /** Optional prefix for key namespacing. Adapters prepend this to all rate limit keys to isolate multiple policies. */
  prefix?: string;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      remaining: number;
      retryAfterMs: number | null; // - number: ms until next token (if retryable)
      // - null: operation impossible under policy (cost > capacity)
    };

export interface RateLimiter {
  /**
   * Atomically consume tokens from a rate limit bucket.
   *
   * Each adapter owns the clock: uses its trusted time source (Redis TIME, DO clock, Date.now()).
   * For deterministic testing, inject a custom clock into the factory only.
   *
   * Semantics: Operation is atomic per key; no race window across concurrent requests.
   * Adapters must provide correctness guarantees appropriate to their backend:
   * - Memory: per-key FIFO mutex lock
   * - Redis: Lua script with TIME inside (atomic single operation)
   * - Durable Objects: single-threaded per shard with consistent clock
   *
   * Adapters must tolerate non-monotonic clocks (NTP adjustments);
   * clamp negative elapsed time to 0 to avoid invalid states.
   */
  consume(key: string, cost: number): Promise<RateLimitDecision>;

  /**
   * Optional: cleanup resources (connection, timers, etc.).
   * Called on app shutdown.
   */
  dispose?(): void;
}
```

**Why this fixes it**:

- **Single interface**: One public shape (`RateLimiter`) for all backends
- **Factories hide complexity**: Memory, Redis, and Durable Objects adapters are factories that return `RateLimiter` instances
- **Multi-policy is simple**: Call the factory twice with the same client connection to get independent budgets
- **Middleware stays lean**: `rateLimit()` takes a `limiter: RateLimiter`; all adapters conform to that interface

### Time Must Be Server-Authoritative

Rate limiting is a **security decision**: it prevents abuse. The adapter owns the clock and uses its trusted time source. Middleware **never** passes client-supplied time.

**Why**:

- Adapters use server time exclusively: `Date.now()` (memory), `Redis TIME` (Redis), or `Durable Object clock`
- Client cannot bypass via `meta.timestamp` manipulation
- Network skew between pods is acceptable; rate limiting is soft (not cryptographic)

**For deterministic testing**: Inject a clock only into the memory store factory:

```typescript
// ✅ TEST: Inject mock clock into memory store
const fakeTime = { current: Date.now() };
const store = memoryStore({ clock: { now: () => fakeTime.current } });

const limiter = rateLimit({
  store,
  policy: { capacity: 10, tokensPerSecond: 1 },
  key: (ctx) => `user:${ctx.data?.userId}`,
  cost: () => 1,
});

// Simulate time progression in tests
fakeTime.current += 5000; // Refill happens automatically via adapter clock
```

---

## Implementation: Adapter-First Rate Limiting

### Token Bucket Algorithm (Adapter-Implemented)

Token bucket is the industry standard: smooth rate, allows bursts, O(1) per request. **The algorithm is implemented atomically inside each adapter, with policy bound at policy creation time.**

**The algorithm (pseudocode, adapter-internal)**:

```typescript
// Backend.createPolicy() captures policy; each consume call uses it
function consume(key: string, cost: number): RateLimitDecision {
  // Adapter owns time; policy is pre-bound at createPolicy() time
  const now = getAdapterTime(); // Redis TIME, Date.now(), etc.
  const { capacity, tokensPerSecond, prefix } = this.policy;

  // Apply prefix if present (isolate this policy's keys)
  const prefixedKey = prefix ? prefix + key : key;

  // 1. Get current bucket (or initialize)
  let bucket = storage[prefixedKey] ?? { tokens: capacity, lastRefill: now };

  // 2. Refill based on elapsed time
  const elapsed = Math.max(0, (now - bucket.lastRefill) / 1000);
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * tokensPerSecond);
  bucket.lastRefill = now;

  // 3. Check and spend (atomic from here)
  if (bucket.tokens < cost) {
    // Not enough tokens; compute retry time or null if impossible
    const deficit = cost - bucket.tokens;
    const retryAfterMs =
      cost > capacity ? null : Math.ceil((deficit / tokensPerSecond) * 1000);
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs,
    };
  }

  // 4. Deduct and persist
  bucket.tokens -= cost;
  storage[prefixedKey] = bucket; // Persisted atomically per adapter
  return { allowed: true, remaining: Math.floor(bucket.tokens) };
}
```

**Key points**:

- Policy (`capacity`, `tokensPerSecond`, `prefix`) is bound at **`backend.createPolicy()` time** and **immutable per policy instance**
- Each adapter implements atomicity appropriate to its backend:
  - **Memory**: Mutex guard + JS map (per backend)
  - **Redis**: Lua script (single op to Redis; shared connection)
  - **Durable Objects**: Single-threaded per sharded key (shared namespace)
- Middleware calculates `(key, cost)` and calls `store.consume(key, cost)` — no policy parameters
- **Multiple policies per backend**: Create independent budgets from a single backend without duplicating connections

**Integer Arithmetic & Validation:**

All token values (`capacity`, `tokensPerSecond`, `cost`) use **integer semantics**:

- Refill per consume: `tokens += floor(elapsed_seconds × tokensPerSecond)` (integer accumulation)
- Remaining tokens reported: `Math.floor(bucket.tokens)` (always integer)
- Cost must be a positive integer (validated by middleware at runtime)

**Why integers?** Token bucket traditionally operates on discrete units. Integer arithmetic avoids precision drift in distributed systems and simplifies validation.

**Scaling for sub-1 rates:** If you need `0.1 tokens/sec`, scale both capacity and rate by the same factor:

```typescript
// Represents 0.1 tokens/sec with capacity 5
// Refills at 1 tok/sec but divided into 10x finer buckets
const policy = { capacity: 50, tokensPerSecond: 10 }; // Interpret as 5.0 capacity, 1.0 refill
```

**Factory validation:** Each adapter factory validates the policy at creation time and throws if `capacity < 1` or `tokensPerSecond <= 0`. Middleware validates `cost` is a positive integer at runtime.

Example of multi-policy setup:

```typescript
// One Redis connection shared across multiple rate limiters
const redisClient = createClient({ url: process.env.REDIS_URL });

// Each factory call returns independent RateLimiter; all share same connection
const cheap = redisRateLimiter(redisClient, {
  capacity: 200,
  tokensPerSecond: 100,
});
const expensive = redisRateLimiter(redisClient, {
  capacity: 10,
  tokensPerSecond: 2,
});

const cheapLimiter = rateLimit({
  limiter: cheap,
  key,
  cost: () => 1,
});

const expensiveLimiter = rateLimit({
  limiter: expensive,
  key,
  cost: () => 5,
});

router.use(cheapLimiter);
router.use(expensiveLimiter);
```

### Keying Strategy

Three named key functions ship by default; choose based on your app's needs:

**`keyPerUserPerType(ctx)`** — Fairness per operation type (recommended for most cases)

```typescript
/**
 * Tenant + user + type: Fair isolation across message types.
 * Use when message shapes have different costs or when preventing
 * one brusty RPC from starving others is important.
 */
export function keyPerUserPerType(ctx: IngressContext): string {
  const tenant = ctx.data?.tenantId ?? "public";
  const user = ctx.data?.userId ?? "anon";
  return `rl:${tenant}:${user}:${ctx.type}`;
}
```

**`keyPerUser(ctx)`** — Lighter footprint for high-type-count apps

```typescript
/**
 * Tenant + user only: Lighter memory footprint.
 * Use when you have many heterogeneous routes (100+ message types) or memory is tight.
 * Differentiate cost via weight config; all operations share the same user ceiling.
 */
export function keyPerUser(ctx: IngressContext): string {
  const tenant = ctx.data?.tenantId ?? "public";
  const user = ctx.data?.userId ?? "anon";
  return `rl:${tenant}:${user}`;
}
```

**Memory Impact & Eviction:**

> `keyPerUserPerType` creates a bucket for each (tenant, user, type) tuple, multiplying key cardinality by active message type count.
>
> **When to keep it (recommended)**: Fairness is worth the cost in most cases. A typical app has 5–30 active message types; even with 10k users, that's ~150k buckets in Redis—acceptable and worth the isolation guarantee that prevents one bursty operation from starving others.
>
> **When to switch to `keyPerUser`**: If your app has 100+ distinct message types (forwarding heterogeneous RPCs across microservices) or monitoring shows key cardinality exceeding your backend's comfort zone, switch to per-user keying and use `cost(ctx)` to weight operations within a shared budget.
>
> **Automatic cleanup**: Redis (via `PEXPIRE` TTL) and Durable Objects (mark-and-sweep) automatically evict idle buckets after ~24h, capping unbounded growth. Memory and in-process stores do not evict; use external cleanup if needed or scope to single-deployment apps.

**Cost function as tuning, not isolation:**

The `cost()` function (optional; defaults to `1`) lets you weight operations within a _single policy_—e.g., "Compute costs 5 tokens, others cost 1" under the same capacity/refill budget. It is **not a substitute for per-type isolation**. If you need completely independent fairness budgets (cheap queries should not starve expensive reports), use separate `rateLimit()` instances with different policies. The per-type key default (`keyPerUserPerType`) ensures that even with `cost: () => 1`, one operation type cannot starve others—a fairness guarantee that `keyPerUser` + variable cost cannot provide.

**Custom key examples** (documented in guides, not exported; all use safe IngressContext fields):

- **Per-connection**: `(ctx) => rl:conn:${ctx.id}:${ctx.type}` — strict fairness, doesn't stop distributed attacks
- **Per-IP** (behind trusted load balancer): `(ctx) => rl:ip:${ctx.ip}:${ctx.type}` — breaks without proper `CF-Connecting-IP` / `X-Forwarded-For`

### Usage: Works Everywhere

**Single-policy (Bun/Node.js/Dev):**

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
  key: keyPerUserPerType,
  cost: (ctx) => 1,
});

router.use(limiter);
```

**Multi-policy (Cheap vs. Expensive, Bun/Node.js):**

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

// Two independent rate limiters, each with its own budget
const cheap = memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 });
const expensive = memoryRateLimiter({ capacity: 10, tokensPerSecond: 2 });

const cheapLimiter = rateLimit({
  limiter: cheap,
  key: keyPerUserPerType,
  cost: (ctx) => 1,
});

const expensiveLimiter = rateLimit({
  limiter: expensive,
  key: keyPerUserPerType,
  cost: (ctx) => (ctx.type.includes("Compute") ? 5 : 1),
});

router.use(cheapLimiter);
router.use(expensiveLimiter);
```

**Multi-pod (Redis with Shared Connection):**

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { redisRateLimiter } from "@ws-kit/redis";
import { createClient } from "redis";

// Single Redis connection
const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const limiter = rateLimit({
  limiter: redisRateLimiter(redisClient, {
    capacity: 200,
    tokensPerSecond: 100,
  }),
  key: keyPerUserPerType,
  cost: (ctx) => 1,
});

router.use(limiter);
```

**Cloudflare Workers (Durable Objects):**

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { durableObjectRateLimiter } from "@ws-kit/cloudflare";

const limiter = rateLimit({
  limiter: durableObjectRateLimiter(env.RATE_LIMITER, {
    capacity: 200,
    tokensPerSecond: 100,
  }),
  key: keyPerUserPerType,
  cost: (ctx) => 1,
});

router.use(limiter);
```

**Tests (Deterministic Clock):**

```typescript
const fakeTime = { current: Date.now() };

// Memory rate limiter with injected clock for deterministic testing
const limiter = memoryRateLimiter(
  { capacity: 10, tokensPerSecond: 1 },
  { clock: { now: () => fakeTime.current } },
);

// Simulate time progression and check rate limiting
for (let i = 0; i < 15; i++) {
  fakeTime.current += 100; // Advance by 100ms
  const result = await limiter.consume("user:1", 1);
  if (i < 10) {
    expect(result.allowed).toBe(true);
  } else {
    expect(result.allowed).toBe(false); // Blocked after 10 messages
    expect(result.retryAfterMs).toBeGreaterThan(0);
  }
}
```

### Key Design Points

**1. Multi-dimensional keying (prefer user/tenant over IP):**

All examples use safe IngressContext fields (no payload access):

```typescript
// Safe: User + tenant + route (recommended)
key: (ctx) => {
  const tenantId = ctx.data?.tenantId ?? "public";
  const userId = ctx.data?.userId ?? "anon";
  const route = ctx.type;
  return `rt:${tenantId}:${userId}:${route}`;
};

// Risky: IP-based (see "Trust Proxy" section below)
key: (ctx) => `rt:${ctx.ip}:${ctx.type}`;
```

**2. Cost function (message count is simplest):**

The cost function receives only **safe, pre-validated fields** (IngressContext). It runs _before_ schema validation, so `ctx.payload` is not available. This prevents brittle code that depends on unvalidated data.

**Cost Contract**: `cost` must be a **positive integer** (e.g., `1`, `5`, `10`). Middleware validates this at runtime; non-integers or non-positive values are rejected with `INVALID_ARGUMENT`.

```typescript
// Runtime validation (middleware checks this)
const cost = opts.cost?.(ctx) ?? 1;
if (!Number.isInteger(cost) || cost <= 0) {
  ctx.error("INVALID_ARGUMENT", "Rate limit cost must be a positive integer");
  return;
}
```

**Cost examples:**

```typescript
cost: (ctx) => {
  // Option A (recommended): 1 token per message
  return 1;

  // Option B: Weighted by operation cost
  // Expensive operations (compute) consume more tokens
  return ctx.type === "Compute" ? 10 : 1;

  // Option C: Different tiers (use cost, not fractional discounts)
  // Differentiate via separate limiters or scaled policy for premium users
  const tier = ctx.data?.tier ?? "free";
  return { free: 2, basic: 1, pro: 1 }[tier];

  // ❌ Not allowed: non-integer
  // return ctx.data?.isPremium ? 0.5 : 1;  // ERROR: 0.5 is not an integer

  // ❌ Not allowed: payload not validated yet
  // return ctx.payload?.items?.length ?? 1;  // ERROR: ctx.payload undefined
};
```

**Why IngressContext, not full Ctx?** Rate limiting runs _before_ schema validation. To prevent accidental dependencies on unvalidated payload, only parsed fields are available:

- ✅ `ctx.type` — message type (extracted from frame)
- ✅ `ctx.data` — app connection state (from authenticate)
- ✅ `ctx.meta.receivedAt` — server timestamp
- ✅ `ctx.id`, `ctx.ip` — connection metadata
- ❌ `ctx.payload` — not schema-validated (would be brittle)

**Handling premium users**: For differing per-user costs, use separate rate limit middleware with different policies:

```typescript
// Free tier: stricter limit
const freeLimiter = rateLimit({
  store: backend.createPolicy({
    capacity: 100,
    tokensPerSecond: 10,
    prefix: "free:",
  }),
  key: (ctx) => `user:${ctx.data?.userId}`,
  cost: () => 1,
});

// Premium tier: generous limit
const premiumLimiter = rateLimit({
  store: backend.createPolicy({
    capacity: 1000,
    tokensPerSecond: 100,
    prefix: "premium:",
  }),
  key: (ctx) => `user:${ctx.data?.userId}`,
  cost: () => 1,
});

// Apply conditionally based on tier
router.use((ctx, next) => {
  if (ctx.data?.isPremium) {
    return premiumLimiter(ctx, next);
  }
  return freeLimiter(ctx, next);
});
```

**3. Observability via Router Hook:**

Rate limit violations are reported via the **`onLimitExceeded` router hook** (same place as payload size limits). This keeps all limit observability in one canonical location. The hook receives a `LimitExceededInfo` object with `type` discriminator (`"payload"` or `"rate"`).

```typescript
// Observability: metrics, logging, alerts
serve(router, {
  port: 3000,
  authenticate(req) {
    /* ... */
  },

  onLimitExceeded(info) {
    if (info.type === "payload") {
      // Existing: payload size violation
      metrics.increment("limits.payload_exceeded", {
        observed: info.observed,
        limit: info.limit,
      });
    } else if (info.type === "rate") {
      // NEW: Rate limit violation
      console.warn("rate_limited", {
        clientId: info.clientId,
        observed: info.observed, // Attempted cost
        limit: info.limit, // Capacity
        retryAfterMs: info.retryAfterMs,
      });
      metrics.increment("limits.rate_exceeded", {
        retryAfterMs: info.retryAfterMs,
      });
    }
  },
});

// Middleware is lean: store, key, cost
const limiter = rateLimit({
  store: memoryStore({ policy: { capacity: 200, tokensPerSecond: 100 } }),
  key: defaultKey,
  cost: (ctx) => 1,
});

router.use(limiter);
```

**Hook Contract**: The `onLimitExceeded` hook is called exactly once per rate-limited request, **fire-and-forget** (not awaited). It receives a `LimitExceededInfo` object with:

- `type: "rate"` (discriminator)
- `observed`: attempted cost
- `limit`: policy capacity
- `retryAfterMs`: Present only when operation is blocked (allowed=false). Two possible values:
  - `number` — Retry after this many milliseconds (operation blocked, retryable)
  - `null` — Operation impossible under current policy (cost > capacity); non-retryable; client should not retry

**4. Router Requirement: Forward Computed retryAfterMs**

When middleware throws a `_limitExceeded` error with a computed `retryAfterMs` value (from the rate limiter or other sources), **the router must propagate that value directly into the error envelope**. This ensures the client receives the exact backoff hint computed by the rate limit algorithm, not a generic fallback.

**Contract**:

- Middleware computes `retryAfterMs` via `store.consume()` and includes it in `_limitExceeded` error metadata
- Router extracts `info.retryAfterMs` and forwards it in the `RESOURCE_EXHAUSTED` error envelope
- For operations where `cost > capacity`, `retryAfterMs === null` signals non-retryable (client should not retry)

**Example**:

```typescript
// Middleware throws with computed backoff
const error = new Error("Rate limit exceeded");
(error as any)._limitExceeded = {
  type: "rate",
  observed: cost,
  limit: capacity,
  retryAfterMs: 1250, // Computed by token bucket
};
throw error;

// Router catches and forwards
ctx.error(
  "RESOURCE_EXHAUSTED",
  "Rate limit exceeded",
  {},
  {
    retryable: true,
    retryAfterMs: 1250, // ← Forwarded as-is from middleware
  },
);
```

**5. Error Flow (Reuses Existing Limits Pipeline):**

Rate limiting errors are synthesized as `_limitExceeded` errors—the same mechanism payload size limits use. This ensures rate limits integrate seamlessly with the router's existing behavior gates (`send/close/custom`).

**Middleware creates the error:**

```typescript
// Middleware flow (simplified):
1. const cost = costFunction(ctx)
2. const decision = await store.consume(key, cost)
   ↓
3. if (!decision.allowed) {
     // Synthesize same _limitExceeded error payload limits use
     const error = new Error(
       decision.retryAfterMs === null
         ? "Operation cost exceeds rate limit capacity"
         : "Rate limit exceeded"
     );

     // Attach limit metadata (same contract as payload limits)
     (error as unknown as Record<string, unknown>)._limitExceeded = {
       type: "rate",
       observed: cost,  // Attempted cost (tracked separately)
       limit: policy.capacity,
       retryAfterMs: decision.retryAfterMs,
     };

     throw error;  // Router's catch block handles everything
   }
   ↓
4. await next() // Continue to handler
```

**Router's catch block handles:**

1. Extracts `_limitExceeded` metadata (including `type` discriminator: `"payload"` or `"rate"`)
2. **Forwards `retryAfterMs` from middleware into the error envelope** (if present in metadata)
3. Calls `onLimitExceeded` hook (fire-and-forget, **not awaited**—same as payload limits)
4. Selects error code based on retry semantics:
   - **`retryAfterMs === null`**: Send `FAILED_PRECONDITION` (non-retryable; cost > capacity)
   - **`retryAfterMs` is a number** (includes `0`): Send `RESOURCE_EXHAUSTED` with `retryable: true`
5. Uses configured behavior gate (`limits.onExceeded`):
   - `"send"` → Send the error code selected above
   - `"close"` → Close connection with configured code (default 1013 "Try Again Later")
   - `"custom"` → Let app handle in `onLimitExceeded` hook, send nothing

**Key guarantees**:

- Reuses router's existing limits pipeline; no parallel flows
- **Computed `retryAfterMs` from middleware is propagated directly** into the error envelope (not replaced with defaults)
- Hook is called **exactly once** per rate-limited request (fire-and-forget, not awaited)
- Error code selection is deterministic: `null` → `FAILED_PRECONDITION`, number → `RESOURCE_EXHAUSTED`
- Behavior gates apply uniformly: `send/close/custom` control all limits (payload, rate, etc.)
- Handler is **never invoked** for rate-limited requests (middleware throws early)

**5. Trust Proxy (IP-based limits only when necessary):**

Rate limiting by IP **behind a load balancer or CDN is broken**. All users appear as one IP.

```typescript
// ❌ WRONG: Behind load balancer
key: (ctx) => `rt:${ctx.ip}`; // All traffic → same limit

// ✅ CORRECT: Use authenticated user ID
key: (ctx) => `rt:${ctx.data?.userId ?? "anon"}`;

// ✅ CORRECT: If IP-based is required, read trusted header
// (Requires load balancer or CDN to set correctly)
const trustedClientIp = (ctx) => {
  // On Cloudflare: CF-Connecting-IP is set by Cloudflare
  // On AWS ALB: X-Forwarded-For (first IP, if trusted)
  // Otherwise: ctx.ip
  return ctx.request.headers.get("CF-Connecting-IP") ?? ctx.ip;
};

key: (ctx) => `rt:${trustedClientIp(ctx)}`;
```

**5. Key cardinality & TTL (prevent unbounded growth):**

```typescript
// ❌ UNBOUNDED: Unique key per message
key: (ctx) => `rt:${Date.now()}:${ctx.id}`;

// ✅ BOUNDED: Aggregate to user/tenant
key: (ctx) => `rt:${ctx.data?.userId}`;

// Redis adapter auto-calculates TTL: 2x refill window (minimum 1 minute)
// Example: capacity=10, tokensPerSecond=1 → TTL = max(20 * 1000, 60_000) = 60s
const limiter = redisRateLimiter(redisClient, {
  capacity: 10,
  tokensPerSecond: 1,
});

// Or override:
const limiter = redisRateLimiter(
  redisClient,
  { capacity: 10, tokensPerSecond: 1 },
  { ttlMs: 120_000 }, // 2 minutes
);
```

**6. Cost > capacity (impossible operations):**

When `cost > capacity`, the operation can **never** succeed. The adapter signals this by returning `retryAfterMs: null`:

```typescript
// Adapter returns retryAfterMs = null to signal "impossible under current policy"
const result = await store.consume("user:1", 15); // cost=15, capacity=10
// result = { allowed: false, remaining: 10, retryAfterMs: null }

// Middleware detects null and sends a non-retryable error
// (Router handles mapping retryAfterMs to error code)
```

---

## Granularity Options

Rate limiting can apply at multiple levels:

| Level                | Key                | Example                                                     | Pros                                | Cons                                   |
| -------------------- | ------------------ | ----------------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| **Global**           | Server-wide        | Max 100k msgs/sec across all users                          | Simple; prevents server overload    | Unfair to legitimate users             |
| **Per-User**         | `userId`           | Max 100 msgs/sec per authenticated user                     | Fair, prevents abuse                | Requires auth; doesn't limit anonymous |
| **Per-IP**           | Request IP         | Max 50 msgs/sec per IP                                      | Works for anonymous; prevents spam  | Breaks behind load balancer; VPN users |
| **Per-Connection**   | `clientId` / `ws`  | Max 1k msgs per WebSocket connection                        | Precise per-client fairness         | Doesn't stop distributed attacks       |
| **Per-Message-Type** | `ctx.type`         | 100 `/sec for `SendMessage`, 10/sec for expensive `Compute` | Granular resource allocation        | Complex configuration                  |
| **Per-Handler**      | Route-specific     | Different limits per message handler                        | Maximum flexibility                 | Scattered logic across codebase        |
| **Per-Room/Channel** | Topic subscription | Max 50 messages/sec per chat room                           | Real-world use cases (gaming, chat) | Needs application state                |

---

## Ingress Pipeline Ordering

Rate limiting runs **after minimal parsing** (to know `ctx.type` for keying) but **before allocating server state**. This prevents attackers from wasting server memory on garbage:

```
1. Payload size check
   └─ If exceeded → send ERROR immediately

2. Minimal frame parse (cheap; only extract ctx.type)
   └─ If unparseable → send PARSE_ERROR

3. Rate limiter (this proposal)
   └─ If rate limited → send RESOURCE_EXHAUSTED + retryAfterMs

4. RPC in-flight quota (if applicable)
   └─ If exceeded → send ERROR

5. Schema validation
   └─ If invalid → send VALIDATION_ERROR

6. Middleware + handlers
   └─ If auth fails → send AUTH_ERROR
```

**Why this order:**

- Size check first (O(1), zero cost)
- Rate limit early, before allocating RPC state or running validation; prevents token waste and saves memory
- Allow keying by `ctx.type` with minimal overhead
- Standard error codes ensure client backoff behavior is predictable

---

## Adapter Implementations

The `RateLimiter.consume()` method is implemented atomically in each adapter.

### Memory Adapter (Bun, Node.js, Dev)

Per-key mutex ensures atomicity. Acceptable for dev and single-instance deployments (not for distributed systems).
**Zero-timer by design**: No background cleanup; integrates with app lifecycle or external sweepers.

```typescript
// In @ws-kit/memory
export function memoryRateLimiter(
  policy: Policy,
  opts?: { clock?: { now(): number } },
): RateLimiter {
  const clock = opts?.clock ?? { now: () => Date.now() };
  const { capacity, tokensPerSecond } = policy;
  const buckets = new Map<string, TokenBucket>();
  const mutexes = new Map<string, Mutex>();

  function getMutex(key: string): Mutex {
    if (!mutexes.has(key)) {
      mutexes.set(key, new Mutex());
    }
    return mutexes.get(key)!;
  }

  return {
    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      const mutex = getMutex(key);

      return mutex.lock(async () => {
        const now = clock.now();
        const bucket = buckets.get(key) ?? {
          tokens: capacity,
          lastRefill: now,
        };

        const elapsed = Math.max(0, (now - bucket.lastRefill) / 1000);
        bucket.tokens = Math.min(
          capacity,
          bucket.tokens + elapsed * tokensPerSecond,
        );
        bucket.lastRefill = now;

        if (bucket.tokens < cost) {
          const retryAfterMs =
            cost > capacity
              ? null
              : Math.ceil(((cost - bucket.tokens) / tokensPerSecond) * 1000);
          return {
            allowed: false,
            remaining: Math.floor(bucket.tokens),
            retryAfterMs,
          };
        }

        bucket.tokens -= cost;
        buckets.set(key, bucket);
        return { allowed: true, remaining: Math.floor(bucket.tokens) };
      });
    },

    dispose() {
      buckets.clear();
      mutexes.clear();
    },
  };
}

// Simple FIFO async mutex
class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve) => {
      const run = async () => {
        this.locked = true;
        try {
          resolve(await fn());
        } finally {
          this.locked = false;
          const next = this.queue.shift();
          if (next) next();
        }
      };

      if (this.locked) {
        this.queue.push(run);
      } else {
        run();
      }
    });
  }
}
```

### Redis Adapter (Multi-pod)

Uses integer arithmetic for simplicity. Lua script is preloaded via `EVALSHA` for efficiency. All tokens are integers; remainings are always integers clamped via `math.floor()`.

**TTL and Write Amplification Strategy:**

The adapter calls `PEXPIRE` on every `consume()` operation. This is a deliberate trade-off:

- **Cost**: One extra Redis command per request (~1-2ms latency, negligible in practice)
- **Benefit**: Automatic eviction of stale buckets (no background cleanup required)
- **Rationale**: TTL refresh is cheap and simpler than separate mark-and-sweep or async eviction logic

Default TTL is `max(2 * capacity / tokensPerSecond * 1000, 60_000)` milliseconds:

- For `capacity=10, tokensPerSecond=1`: TTL = 20s (enough for bucket to fully refill twice)
- For `capacity=100, tokensPerSecond=10`: TTL = 20s
- For `capacity=1, tokensPerSecond=10`: TTL = 60s (minimum; respects high-rate policies)

Idle keys expire automatically; active keys stay fresh. No manual cleanup required.

```typescript
// In @ws-kit/redis
export function redisRateLimiter(
  client: RedisClient,
  policy: Policy,
  opts?: { ttlMs?: number },
): RateLimiter {
  const { capacity, tokensPerSecond } = policy;
  // Default TTL: 2x the refill window (time to fully refill from empty), minimum 1 minute.
  // This balances cleanup of stale buckets with correctness: keys live long enough
  // for long-idle users to refill, then are evicted.
  const keyTtlMs =
    opts?.ttlMs ?? Math.max(((2 * capacity) / tokensPerSecond) * 1000, 60_000);
  let scriptSha: string;
  let scriptLoadingPromise: Promise<string> | null = null;

  const luaScript = `
    local key = KEYS[1]
    local cost = tonumber(ARGV[1])        -- cost in tokens (integer; validated by middleware)
    local capacity = tonumber(ARGV[2])    -- capacity in tokens (positive integer; validated at factory)
    local refillTps = tonumber(ARGV[3])   -- refill rate in tokens/sec (positive integer; validated at factory)
    local ttlMs = tonumber(ARGV[4])       -- key expiry in milliseconds

    -- Get server time atomically (inside Lua)
    local timeResult = redis.call('TIME')
    local nowMs = tonumber(timeResult[1]) * 1000 + math.floor(tonumber(timeResult[2]) / 1000)

    -- Fetch current bucket (integers: tokens in fixed units, milliseconds for clock)
    local vals = redis.call('HMGET', key, 'tokens', 'last_ms')
    local tokens = tonumber(vals[1])
    local last_ms = tonumber(vals[2])

    -- Initialize if missing
    if not tokens then
      tokens = capacity
      last_ms = nowMs
    end

    -- Refill based on elapsed time using integer arithmetic:
    -- refill = floor(elapsed_seconds * tokensPerSecond)
    -- This ensures sub-1 token/sec rates are supported by scaling both capacity and rate.
    -- For example: { capacity: 50, tokensPerSecond: 10 } == 5.0 cap, 1.0 refill.
    local elapsed_sec = math.max(0, (nowMs - last_ms) / 1000)
    if elapsed_sec > 0 then
      local refill = math.floor(elapsed_sec * refillTps)  -- Integer accumulation only
      tokens = math.min(capacity, tokens + refill)
      last_ms = nowMs
    end

    -- Check if cost can be satisfied
    if cost > tokens then
      -- Blocked: compute retry time in milliseconds
      -- If cost > capacity, return -1 (impossible under current policy; non-retryable)
      local retry_ms
      if cost > capacity then
        retry_ms = -1
      else
        local deficit = cost - tokens
        retry_ms = math.ceil((deficit / refillTps) * 1000)
      end
      redis.call('HMSET', key, 'tokens', tokens, 'last_ms', last_ms)
      redis.call('PEXPIRE', key, ttlMs)
      return { 0, tokens, retry_ms }
    end

    -- Allowed: deduct cost
    tokens = tokens - cost
    redis.call('HMSET', key, 'tokens', tokens, 'last_ms', last_ms)
    redis.call('PEXPIRE', key, ttlMs)
    return { 1, tokens }
  `;

  async function ensureScriptLoaded(): Promise<string> {
    if (scriptSha) return scriptSha;
    if (scriptLoadingPromise) return scriptLoadingPromise;
    scriptLoadingPromise = client.scriptLoad(luaScript);
    scriptSha = await scriptLoadingPromise;
    scriptLoadingPromise = null;
    return scriptSha;
  }

  return {
    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      const sha = await ensureScriptLoaded();

      try {
        const result = await client.evalsha(
          sha,
          1,
          key,
          cost,
          capacity,
          tokensPerSecond,
          keyTtlMs,
        );

        const allowed = result[0] === 1;
        const remaining = result[1];
        const retryResult = result[2];
        const retryAfterMs = allowed
          ? undefined
          : retryResult === -1
            ? null
            : retryResult;

        return {
          allowed,
          remaining,
          ...(retryAfterMs !== undefined && { retryAfterMs }),
        };
      } catch (err: any) {
        // Script not found; reload and retry once
        if (err.message?.includes("NOSCRIPT")) {
          scriptSha = "";
          return this.consume(key, cost);
        }
        throw err;
      }
    },
  };
}
```

### Durable Objects Adapter (Cloudflare Workers)

Shards rate limit keys across multiple DOs to distribute load. Single-threaded DO semantics guarantee atomicity per shard. Each factory call returns a `RateLimiter` instance that communicates with the DO namespace.

#### Cleanup Strategy

Stale bucket cleanup balances iteration cost against storage efficiency. **Tier 1 (v0.2.0)** uses mark-and-sweep: scan all buckets once per hour, delete only those inactive for 24h. This is simple and sufficient for typical use:

| Approach                       | Iteration Bound          | Complexity                        | TTL Accuracy | When to Use                     |
| ------------------------------ | ------------------------ | --------------------------------- | ------------ | ------------------------------- |
| **Mark-and-sweep (Tier 1)**    | O(all buckets) per hour  | Minimal; one scan, skip recent    | Exact (24h)  | Default; low-churn deployments  |
| **Hour segmentation (Future)** | O(buckets/hour)          | Moderate; prepend `hour()` to key | ~24h ±30min  | High-churn; buckets/hour > 100k |
| **External sweeper**           | O(all buckets) on demand | External process; flexible        | Configurable | Multi-shard coordination needed |

**Mark-and-sweep rationale:**

- **Iteration**: Batch processing via cursor pagination prevents long pauses. Even 100k buckets process in small chunks, avoiding blocking the shard.
- **Precision**: `lastRefill` is updated on every `consume()`, so "inactive for 24h" has exact semantics—no drift from clock skew.
- **Simplicity**: No key format changes; no hour boundaries; no risk of off-by-one errors.

**Future optimization (v0.3.0+)**: If telemetry shows `storage.list()` costs exceed acceptable latency, implement hourly segmentation:

```typescript
// Key format: bucket:<hour>:<originalKey>
const hourSegment = Math.floor(Date.now() / 3600000);
const segmentedKey = `${this.bucketPrefix}${hourSegment}:${key}`;

// Cleanup: delete only the previous hour's prefix
const prevHour = hourSegment - 1;
const stalePrefix = `${this.bucketPrefix}${prevHour}:`;
const staleKeys = await this.state.storage.list({ prefix: stalePrefix });
for (const [staleKey] of staleKeys) {
  await this.state.storage.delete(staleKey);
}
```

This bounds iteration to one hour's worth of keys but adds complexity (hour boundary precision, two lookup paths) that is premature for Tier 1.

```typescript
// In @ws-kit/cloudflare

// Fast, deterministic hash for sharding (FNV-1a)
function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export function durableObjectRateLimiter(
  namespace: DurableObjectNamespace,
  policy: Policy,
  opts?: { shards?: number },
): RateLimiter {
  const { capacity, tokensPerSecond } = policy;
  const shardCount = opts?.shards ?? 128;

  const getDoId = (key: string): string => {
    const shard = hashKey(key) % shardCount;
    return `rate-limiter-${shard}`;
  };

  return {
    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      const doId = getDoId(key);
      const stub = namespace.get(namespace.idFromName(doId));

      const response = await stub.fetch("https://internal/consume", {
        method: "POST",
        body: JSON.stringify({
          key,
          cost,
          capacity,
          tokensPerSecond,
        }),
      });

      return await response.json();
    },
  };
}

// Durable Object implementation (runs once, single-threaded per shard)
export class RateLimiterDO implements DurableObject {
  private state: DurableObjectState;
  private bucketPrefix = "bucket:";
  private alarmScheduled = false;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/consume" && request.method === "POST") {
      try {
        const payload = await request.json<{
          key: string;
          cost: number;
          capacity: number;
          tokensPerSecond: number;
        }>();
        const { key, cost, capacity, tokensPerSecond } = payload;
        const now = Date.now();

        // Load bucket
        const storageKey = this.bucketPrefix + key;
        const stored = await this.state.storage.get<TokenBucket>(storageKey);
        const bucket = stored ?? { tokens: capacity, lastRefill: now };

        // Refill based on elapsed time
        const elapsed = Math.max(0, (now - bucket.lastRefill) / 1000);
        bucket.tokens = Math.min(
          capacity,
          bucket.tokens + elapsed * tokensPerSecond,
        );
        bucket.lastRefill = now;

        // Check cost availability
        if (bucket.tokens < cost) {
          // Blocked
          const retryAfterMs =
            cost > capacity
              ? null
              : Math.ceil(((cost - bucket.tokens) / tokensPerSecond) * 1000);
          await this.state.storage.put(storageKey, bucket);
          return Response.json({
            allowed: false,
            remaining: Math.floor(bucket.tokens),
            retryAfterMs,
          });
        }

        // Allowed: deduct cost
        bucket.tokens -= cost;
        await this.state.storage.put(storageKey, bucket);

        // Schedule periodic cleanup (once)
        // See "Cleanup Strategy" section for rationale and future optimizations
        if (!this.alarmScheduled) {
          this.alarmScheduled = true;
          const alarmMs = Date.now() + 3_600_000; // 1 hour
          await this.state.storage.setAlarm(alarmMs);
        }

        return Response.json({
          allowed: true,
          remaining: Math.floor(bucket.tokens),
        });
      } catch (err) {
        return new Response(`Error: ${err}`, { status: 400 });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    // Mark-and-sweep cleanup (Tier 1): scan buckets in batches, delete inactive ones.
    // Cursor-based pagination prevents long pauses on large key sets.
    const now = Date.now();
    const maxAge = 86_400_000; // 24 hours
    const cutoff = now - maxAge;

    let cursor: string | undefined;
    do {
      const batch = await this.state.storage.list({
        prefix: this.bucketPrefix,
        cursor,
        limit: 1000, // Process in 1k-key batches
      });

      for (const [key] of batch) {
        const bucket = await this.state.storage.get<TokenBucket>(key);
        if (bucket && bucket.lastRefill < cutoff) {
          await this.state.storage.delete(key);
        }
      }

      cursor = batch.cursor;
    } while (cursor);

    // Reschedule alarm for next hour
    await this.state.storage.setAlarm(now + 3_600_000);
  }
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}
```

---

## Recommendation: Adapter-First Architecture

Instead of shipping a hardcoded rate limiter, establish **common adapter interfaces** that all stateful utilities build upon. This scales to rate limiting, deduplication, presence, sessions, observability, and more—**without overfitting to one runtime**.

### Package Structure

**Core (no changes):**

```
@ws-kit/core
├── router, contexts, platform adapters, error model
└── NEW: Adapter interfaces (RateLimiter)
```

**Middleware and Adapters:**

```
@ws-kit/middleware
├── rateLimit()        // Token bucket, adapter-based

@ws-kit/adapters
├── memory/                    // In-process, O(1), no IO
├── redis/                     // Multi-pod coordination
└── cloudflare/                // Cloudflare Durable Objects
```

**Future expansions** (same pattern applies):

```
@ws-kit/middleware (extended)
├── deduplicate()              // idempotencyKey + TTL
├── errorRegistry()            // Typed error codes

@ws-kit/observability          // Metrics facade
├── createMetrics()
├── otlpExporter()
└── prometheusExporter()

@ws-kit/patterns
├── createOpLog()              // Delta sync
├── createPresence()           // Multi-connection presence
└── createSessions()           // Session recovery
```

### Core API

```typescript
export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      remaining: number;
      retryAfterMs: number | null;
    };

/**
 * IngressContext: Context available before schema validation runs.
 *
 * Rate limiting and other pre-validation checks use this context. Only includes
 * parsed, trusted fields (connection metadata, app state from authenticate).
 * Prevents accidental access to unvalidated payload, ensuring middleware stays
 * correct even as schema changes.
 */
export type IngressContext<AppData = unknown> = {
  type: string; // Message type
  id: string; // Connection ID
  ip: string; // Client IP
  ws: { data: AppData }; // App connection state (from authenticate)
  meta: { receivedAt: number }; // Server timestamp
};

// Middleware
export function rateLimit(opts: {
  limiter: RateLimiter;
  key?: (ctx: IngressContext) => string; // default: keyPerUserPerType
  cost?: (ctx: IngressContext) => number; // default: 1; must be a positive integer
}): Middleware;

// Key functions
export function keyPerUserPerType(ctx: IngressContext): string; // tenant + user + type (fairness default)
export function keyPerUser(ctx: IngressContext): string; // tenant + user (lighter footprint)

// Factory functions (validate policy at creation time)
export function memoryRateLimiter(
  policy: Policy,
  opts?: { clock?: { now(): number } },
): RateLimiter;
export function redisRateLimiter(
  client: RedisClient,
  policy: Policy,
  opts?: { ttlMs?: number },
): RateLimiter;
export function durableObjectRateLimiter(
  namespace: DurableObjectNamespace,
  policy: Policy,
  opts?: { shards?: number },
): RateLimiter;
```

**Policy validation (at factory creation):**

Each factory validates the policy immediately and throws if invalid:

- `capacity < 1` → throws `Error: Rate limit capacity must be ≥ 1`
- `tokensPerSecond <= 0` → throws `Error: tokensPerSecond must be > 0`
- Non-integer values are accepted (coerced via `Number()`) but must satisfy above constraints

**Default behavior:**

- When `allowed: true` → continue middleware chain
- When `allowed: false` and `retryAfterMs` is a number → send `RESOURCE_EXHAUSTED` with `retryable: true`
- When `allowed: false` and `retryAfterMs === null` → send `FAILED_PRECONDITION` (cost > capacity; non-retryable)

### Contract Tests (Atomicity Validation)

Every adapter must pass the **same test suite** to validate correctness under concurrency:

```typescript
// tests/adapters/rate-limiter.test.ts
const testPolicy = { capacity: 10, tokensPerSecond: 1 };

export function describeRateLimiter(
  name: string,
  createLimiter: () => RateLimiter,
) {
  describe(`RateLimiter: ${name}`, () => {
    test("basic consume: allowed", async () => {
      const limiter = createLimiter();
      const result = await limiter.consume("user:1", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.retryAfterMs).toBeUndefined();
    });

    test("basic consume: blocked", async () => {
      const limiter = createLimiter();
      // Exhaust bucket
      for (let i = 0; i < 10; i++) {
        await limiter.consume("user:1", 1);
      }
      // Next request should be blocked
      const result = await limiter.consume("user:1", 1);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    test("weighted cost", async () => {
      const limiter = createLimiter();
      const result = await limiter.consume("user:1", 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
    });

    test("concurrent requests: no double-spend", async () => {
      const limiter = createLimiter();
      // 15 concurrent requests with capacity=10
      const results = await Promise.all(
        Array.from({ length: 15 }, () => limiter.consume("user:1", 1)),
      );
      const allowed = results.filter((r) => r.allowed).length;
      expect(allowed).toBe(10); // Atomicity guarantee: never more than capacity
    });

    test("cost > capacity: not retryable", async () => {
      const limiter = createLimiter();
      const result = await limiter.consume("user:1", 11);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(null); // Impossible under policy
    });

    test("multi-key isolation", async () => {
      const limiter = createLimiter();
      // Exhaust user:1
      for (let i = 0; i < 10; i++) {
        await limiter.consume("user:1", 1);
      }
      // user:2 should be unaffected
      const result = await limiter.consume("user:2", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });
  });
}

// Run contract tests for all adapters
describeRateLimiter("Memory", () => memoryRateLimiter(testPolicy));
describeRateLimiter("Redis", () => redisRateLimiter(redisClient, testPolicy));
describeRateLimiter("Durable Objects", () =>
  durableObjectRateLimiter(env.RATE_LIMITER, testPolicy),
);
```

### Multi-Policy Tests (Independent Limiters with Shared Connection)

```typescript
// tests/adapters/multi-policy.test.ts

test("independent limiters: policies with different budgets", async () => {
  // Two independent limiters with different capacity/refill
  const cheap = memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 });
  const expensive = memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 });

  // Exhaust cheap limiter
  for (let i = 0; i < 10; i++) {
    const result = await cheap.consume("user:1", 1);
    expect(result.allowed).toBe(true);
  }

  // cheap is exhausted
  const blockedCheap = await cheap.consume("user:1", 1);
  expect(blockedCheap.allowed).toBe(false);

  // But expensive is still fresh (independent limiter)
  const okExpensive = await expensive.consume("user:1", 1);
  expect(okExpensive.allowed).toBe(true);
  expect(okExpensive.remaining).toBe(4);
});

test("redis: multiple limiters share same connection", async () => {
  // Single Redis connection
  const redisClient = createClient({ url: process.env.REDIS_URL });

  // Multiple limiters created from same client still share connection
  const limiter1 = redisRateLimiter(redisClient, {
    capacity: 100,
    tokensPerSecond: 50,
  });
  const limiter2 = redisRateLimiter(redisClient, {
    capacity: 10,
    tokensPerSecond: 2,
  });

  // Both should work without duplicate connections
  const result1 = await limiter1.consume("api:user:1", 1);
  const result2 = await limiter2.consume("report:user:1", 5);

  expect(result1.allowed).toBe(true);
  expect(result2.allowed).toBe(true);
});
```

### Core Implementation

| Feature                         | Package              | Rationale                                                     |
| ------------------------------- | -------------------- | ------------------------------------------------------------- |
| **Rate Limiter** (token bucket) | `@ws-kit/middleware` | Cross-runtime middleware; adapters stay in `@ws-kit/adapters` |
| **Memory Adapter**              | `@ws-kit/memory`     | Dev, single-instance Bun/Node.js                              |
| **Redis Adapter**               | `@ws-kit/redis`      | Multi-pod production deployments                              |
| **Durable Objects Adapter**     | `@ws-kit/cloudflare` | Cloudflare Workers, sharded                                   |

**Note**: Middleware may re-export adapters for ergonomics (e.g., `@ws-kit/middleware/adapters`), but the canonical source lives in `@ws-kit/adapters`. Consumers opt-in to runtime-specific dependencies intentionally.

**Future enhancements** (following the same adapter pattern):

- Deduplication middleware (`idempotencyKey` + TTL)
- Observability package (Prometheus, OTLP exporters)
- Presence, delta sync, sessions

### Testing Requirements

Every adapter must pass the same **contract test suite** under concurrency:

- **Atomicity**: Concurrent requests never over-spend tokens
- **Fairness**: Cross-key isolation; one user's limit doesn't affect another
- **Numeric stability**: Fixed-point math handles fractional costs correctly
- **Determinism**: Optional clock injection (at store level) enables time-travel testing without affecting production

---

## Backward Compatibility & Migration

**Zero Breaking Changes**: Rate limiting is **opt-in middleware**. Existing applications are completely unaffected.

### What Stays the Same

- Router API: no changes to `router.on()`, `router.rpc()`, `ctx.error()`, etc.
- Payload size limits and heartbeat: independent, not modified
- Error codes: `RESOURCE_EXHAUSTED` and `INVALID_ARGUMENT` already exist (standard)
- `onLimitExceeded` hook: already exists for payload limits; we're extending its `info` parameter

### Migrating From Manual Rate Limiting

If your app currently does manual rate limiting in middleware, the migration is seamless:

**Before (manual):**

```typescript
router.use((ctx, next) => {
  const userId = ctx.data?.userId ?? "anon";
  const count = requestCounts.get(userId) ?? 0;
  if (count >= 10) {
    ctx.error("RESOURCE_EXHAUSTED", "Too many requests");
    return;
  }
  requestCounts.set(userId, count + 1);
  return next();
});
```

**After (with middleware):**

```typescript
import { rateLimit } from "@ws-kit/rate-limit";
import { memoryStore } from "@ws-kit/memory";

const limiter = rateLimit({
  store: memoryStore({ policy: { capacity: 10, tokensPerSecond: 1 } }),
  key: defaultKey,
  cost: () => 1,
});

router.use(limiter); // Same error semantics, atomic guarantees, distributed support
```

**Both send the same error to the client**; the middleware version adds:

- ✅ Atomicity (no race conditions)
- ✅ Distributed support (Redis, Durable Objects)
- ✅ Metrics integration via `onLimitExceeded` hook
- ✅ Token refill semantics (burst-friendly)

## Design Constraints & Boundaries

Adapter implementations stay in `@ws-kit/adapters` (not scattered across the ecosystem) because:

- **Dependency isolation**: Redis, Durable Objects, and other runtime-specific dependencies are centralized; consumers opt-in via targeted imports (`@ws-kit/redis`, `@ws-kit/cloudflare`).
- **Reuse for future features**: Deduplication, presence, delta sync, and sessions will all reuse the same adapter contracts (same pattern as `RateLimiter`). This design avoids redundant implementations.
- **Contract enforcement**: New adapters must implement the published store/pubsub contracts and pass the same atomicity test suite. This ensures correctness across all backends.

---

## Conclusion

Rate limiting in distributed systems requires **correct atomicity semantics, server-authoritative time, and standard error integration**. The adapter-first approach achieves this while maintaining ws-kit's design principles.

### Why This Approach

- **Correctness**: `RateLimiter.consume()` is atomic per key; no race conditions across pods/isolates
- **Portability**: Single middleware, three adapters (Memory, Redis, Durable Objects)
- **Security**: Always uses `ctx.receivedAt`; clients cannot bypass via timestamp manipulation
- **UX**: Integrates with standard error envelope; clients get deterministic `retryAfterMs`
- **Testability**: Contract tests validate all adapters under concurrency; injected clock for determinism
- **Composability**: Follows ws-kit's pattern (validators, platform adapters); not monolithic

### Package Guardrails

To prevent package sprawl and keep maintenance tractable, ws-kit enforces these boundaries:

- **`@ws-kit/middleware`**: Cross-runtime middleware only (rate limiting, deduplication, observability hooks). No runtime-specific logic.
- **`@ws-kit/adapters`**: Implementations of published adapter contracts. Each adapter (memory, redis, cloudflare) is a subdirectory with its own dependencies and test suite.
- **New packages**: Spawn only when a _second_ feature needs them. For example, if deduplication and rate limiting both need state machines, a `@ws-kit/patterns` package makes sense. A single feature always fits in middleware or adapters.

This keeps the ecosystem focused and avoids fractured implementations of the same interface.

### Design in Action

The API supports multiple styles depending on your deployment model:

**Single-policy convenience:**

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryStore } from "@ws-kit/memory";

const limiter = rateLimit({
  store: memoryStore({ policy: { capacity: 200, tokensPerSecond: 100 } }),
  key: keyPerUserPerType,
  cost: (ctx) => 1,
});

router.use(limiter);
```

**Multi-policy (independent budgets, shared backend):**

```typescript
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { createRedisBackend } from "@ws-kit/redis";

const backend = createRedisBackend({ client: redisConnection });

const cheapLimiter = rateLimit({
  store: backend.createPolicy({
    capacity: 200,
    tokensPerSecond: 100,
    prefix: "cheap:",
  }),
  key: keyPerUserPerType,
  cost: (ctx) => 1,
});

const expensiveLimiter = rateLimit({
  store: backend.createPolicy({
    capacity: 10,
    tokensPerSecond: 2,
    prefix: "expensive:",
  }),
  key: keyPerUserPerType,
  cost: (ctx) => 5,
});

router.use(cheapLimiter);
router.use(expensiveLimiter);
```

**Observability integration:**

```typescript
serve(router, {
  port: 3000,
  onLimitExceeded(info) {
    if (info.type === "rate") {
      console.warn("rate_limited", {
        clientId: info.clientId,
        observed: info.observed,
        limit: info.limit,
        retryAfterMs: info.retryAfterMs,
      });
    }
  },
});
```

**Key benefit:** Backend/policy decoupling allows independent budgets (cheap vs. expensive operations) without duplicating Redis connections or Durable Object namespaces. All policies share the same backend atomicity guarantees, and the pattern scales to future features (deduplication, presence, sessions) via the same adapter contracts.
