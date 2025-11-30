# @ws-kit/memory

In-memory adapters for WS-Kit. Provides a zero-dependency pub/sub registry and token-bucket rate limiter for single-instance development and tests (Bun/Node.js).

## When to use

- Local development, unit tests, or single-server deployments
- Exact subscriber counts without external brokers
- Deterministic rate-limit testing via injectable clocks
- ⚠️ Not distributed — no cross-process/state persistence

## What you get

- `memoryPubSub()` — In-memory topic index (`Map<topic, Set<clientId>>`). Implements `publish`, `subscribe`, `unsubscribe`, `getSubscribers`, `listTopics`, `hasTopic`, and `replace` for bulk topic swaps. `excludeSelf` is unsupported (no sender context).
- `memoryRateLimiter(policy, opts?)` — Token-bucket limiter with per-key mutex to prevent double spending. Supports `prefix` isolation, `getPolicy()`, `dispose()`, and optional `clock` injection for deterministic tests.
- Types: `MemoryPubSubAdapter`, `MemoryRateLimiterOptions`, `Clock`.

## Installation

```bash
bun add @ws-kit/memory
```

## Quick start: pub/sub (development)

```typescript
import { createRouter, withZod, message } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/plugins";
import { memoryPubSub } from "@ws-kit/memory";
import { z } from "zod";

const Notify = message("NOTIFY", { text: z.string() });

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub({ adapter: memoryPubSub() })); // exact local fan-out

router.on(Notify, async (ctx) => {
  await ctx.topics.subscribe("room:lobby");
  await ctx.publish("room:lobby", Notify, { text: "Hi!" });
});
```

## Quick start: rate limiting

```typescript
import { createRouter } from "@ws-kit/core";
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { memoryRateLimiter } from "@ws-kit/memory";

const limiter = memoryRateLimiter({
  capacity: 100, // bucket size
  tokensPerSecond: 10, // refill rate
  prefix: "api:", // optional isolation when sharing a backend
});

const router = createRouter().use(
  rateLimit({
    limiter,
    key: keyPerUserPerType,
    cost: () => 1,
  }),
);
```

## Notes

- Pub/sub is process-local only; restart clears subscriptions.
- Rate limiter is process-local; use `@ws-kit/redis` or a Durable Objects adapter for shared limits.
- For deterministic tests, pass `{ clock: { now: () => number } }` to `memoryRateLimiter()`.
