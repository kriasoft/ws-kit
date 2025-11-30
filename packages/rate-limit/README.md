# @ws-kit/rate-limit

Token-bucket rate limiting for WS-Kit with pluggable backends and ready-to-use key functions.

## Installation

```bash
npm install @ws-kit/rate-limit @ws-kit/memory @ws-kit/core
```

## Quick start

```typescript
import { createRouter } from "@ws-kit/core";
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = memoryRateLimiter({ capacity: 100, tokensPerSecond: 10 });

const router = createRouter().use(
  rateLimit({
    limiter,
    key: keyPerUserPerType, // rl:tenant:user:type
    cost: () => 1,
  }),
);
```

## Adapters

- **Memory (`@ws-kit/memory`)** — Single-process dev/test. Zero dependencies. Optional `prefix` to isolate policies sharing a backend.
- **Redis (`@ws-kit/redis`)** — Distributed, atomic via Lua and server clock. Use when running multiple pods/servers.
- **Durable Objects** — See Cloudflare adapter for serverless deployments.

## Keys and cost

- `keyPerUserPerType` (default): per-user, per-message-type fairness.
- `perUserKey`: single bucket per user (lighter memory).
- Custom: `key: (ctx) => "rl:tenant:user:type"`; include tenant/user/type as needed.
- `cost`: weight expensive operations (`return ctx.type === "Compute" ? 10 : 1`).
- Anonymous users: built-in keys fall back to `"anon"`, so guests share one bucket; use a custom key with IP/session when you need per-guest isolation.

## Policy shape

```typescript
interface Policy {
  capacity: number; // max tokens
  tokensPerSecond: number; // refill rate
  prefix?: string; // optional key namespace
}
```

## Decisions

`consume()` returns `{ allowed: boolean; remaining: number; retryAfterMs: number | null; }`. `retryAfterMs` is `null` when cost exceeds capacity.

## Tips

- Memory adapter is not shared across processes; pick Redis/DO for multi-instance limits.
- Inject a clock into `memoryRateLimiter()` for deterministic tests.
- Keep keys stable and short; prefix when sharing a backend across multiple policies.
