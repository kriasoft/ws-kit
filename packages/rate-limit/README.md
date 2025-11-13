# @ws-kit/rate-limit

Rate limiter interface and middleware for WS-Kit. Provides token bucket rate limiting with pluggable adapters and key functions for fair resource allocation.

## Features

- **Adapter-based architecture**: Use memory, Redis, or Durable Objects adapters
- **Token bucket algorithm**: Atomic token consumption with precise rate control
- **Key functions**: Built-in strategies for per-user, per-type, and per-IP rate limiting
- **Type-safe**: Full TypeScript support with generics
- **Middleware integration**: Seamless integration with WS-Kit router

## Installation

```bash
npm install @ws-kit/rate-limit @ws-kit/memory @ws-kit/core
```

## Quick Start

```typescript
import { createRouter } from "@ws-kit/core";
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

const router = createRouter();

// Create a rate limiter instance
const limiter = memoryRateLimiter({
  capacity: 100,
  tokensPerSecond: 10,
});

// Add rate limit middleware
router.use(
  rateLimit({
    limiter,
    key: keyPerUserPerType, // Per-user per-message-type isolation
    cost: (ctx) => 1, // Each message costs 1 token
  }),
);
```

## Adapters

### Memory (Single Instance)

```typescript
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = memoryRateLimiter({
  capacity: 100,
  tokensPerSecond: 10,
});
```

### Redis (Distributed)

```typescript
import { createClient } from "redis";
import { redisRateLimiter } from "@ws-kit/redis";

const client = createClient({ url: "redis://localhost:6379" });
await client.connect();

const limiter = redisRateLimiter(client, {
  capacity: 100,
  tokensPerSecond: 10,
});
```

## Key Functions

### `keyPerUserPerType` (Default)

Per-user per-message-type rate limiting. Prevents one message type from starving others and ensures fair user isolation.

```typescript
rateLimit({
  limiter,
  key: keyPerUserPerType, // rl:tenant:user:type
});
```

### `perUserKey`

Per-user rate limiting (lighter footprint). All message types share the same budget.

```typescript
rateLimit({
  limiter,
  key: perUserKey, // rl:tenant:user
  cost: (ctx) => {
    // Use cost to weight expensive operations
    return ctx.type === "Compute" ? 10 : 1;
  },
});
```

### `keyPerUserOrIpPerType`

Per-user with IP fallback for unauthenticated traffic.

```typescript
rateLimit({
  limiter,
  key: keyPerUserOrIpPerType, // rl:tenant:user|ip:type
});
```

### Custom Key Function

```typescript
rateLimit({
  limiter,
  key: (ctx) => {
    const org = ctx.ws.data.organizationId ?? "public";
    const user = ctx.ws.data.userId ?? "anon";
    return `rl:${org}:${user}:${ctx.type}`;
  },
});
```

## Cost Functions

Control token cost per operation for weighted rate limiting:

```typescript
rateLimit({
  limiter,
  cost: (ctx) => {
    // Expensive compute operations cost more
    if (ctx.type === "Compute") return 10;
    if (ctx.type === "Search") return 3;
    return 1; // Default cost
  },
});
```

## Policy Configuration

```typescript
interface Policy {
  // Bucket capacity (max tokens available)
  capacity: number;

  // Refill rate in tokens per second
  tokensPerSecond: number;

  // Optional key prefix for isolating multiple policies
  prefix?: string;
}
```

## Rate Limit Decision

When a request is rate limited:

```typescript
{
  allowed: false,
  remaining: 0,
  retryAfterMs: 5000, // null if cost > capacity
}
```

## Types

- `RateLimiter` — Adapter interface for consume/getPolicy/dispose
- `RateLimitDecision` — Result of consume operation
- `Policy` — Rate limit configuration
- `RateLimitOptions` — Middleware options
- `RateLimitContext` — Suggested WebSocket data structure

## See Also

- [@ws-kit/memory](../memory) — In-memory adapter
- [@ws-kit/redis](../redis) — Redis adapter
- [@ws-kit/middleware](../middleware) — Other middleware patterns
