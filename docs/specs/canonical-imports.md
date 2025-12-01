# Canonical Imports Reference

Quick lookup for where to import each plugin, adapter, and utility from. See [ADR-032](../adr/032-canonical-imports-design.md) for the complete design and rationale.

---

## TL;DR: Import Sources

| Feature                   | Canonical Source                   | Notes                                                                       |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| **Validators + Helpers**  | `@ws-kit/zod` or `@ws-kit/valibot` | Choose ONE; both export `z/v`, `message`, `createRouter`, `withZod/Valibot` |
| **Core Plugins**          | `@ws-kit/plugins`                  | `withMessaging()`, `withRpc()`                                              |
| **Pub/Sub Plugin**        | `@ws-kit/pubsub`                   | `withPubSub()`, `usePubSub()`                                               |
| **Rate-Limit Middleware** | `@ws-kit/rate-limit`               | `rateLimit()`, `keyPerUser()`, `keyPerUserPerType()`                        |
| **Middleware**            | `@ws-kit/middleware` (future)      | `useAuth()`, `useLogging()`                                                 |
| **Memory Adapters**       | `@ws-kit/memory`                   | `memoryPubSub()`, `memoryRateLimiter()`                                     |
| **Redis Adapters**        | `@ws-kit/redis`                    | `redisPubSub()`, `redisRateLimiter()`                                       |
| **Cloudflare Adapters**   | `@ws-kit/cloudflare`               | `DurablePubSub`, `createDurableObjectHandler()`                             |
| **Bun Platform**          | `@ws-kit/bun`                      | `serve()`                                                                   |
| **Client (Typed)**        | `@ws-kit/client/zod` or `/valibot` | Full type inference                                                         |
| **Client (Generic)**      | `@ws-kit/client`                   | For custom validators                                                       |

---

## Common Patterns

### Minimal App (Validation Only)

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

const router = createRouter().plugin(withZod());

router.on(message("PING", { text: z.string() }), (ctx) => {
  ctx.send(message("PONG"), { reply: ctx.payload.text });
});

serve(router, { port: 3000 });
```

### With Pub/Sub (Development)

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { memoryPubSub } from "@ws-kit/memory"; // Development
import { serve } from "@ws-kit/bun";

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub({ adapter: memoryPubSub() }));

// Subscribe and publish...
serve(router, { port: 3000 });
```

### With Pub/Sub (Production)

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { redisPubSub } from "@ws-kit/redis"; // Production
import { serve } from "@ws-kit/bun";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub({ adapter: redisPubSub(redis) }));

serve(router, { port: 3000 });
```

### With Rate Limiting

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { redisRateLimiter } from "@ws-kit/redis";
import { serve } from "@ws-kit/bun";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const router = createRouter()
  .plugin(withZod())
  .use(
    rateLimit({
      limiter: redisRateLimiter(redis, { capacity: 1000, tokensPerSecond: 50 }),
      key: keyPerUserPerType,
    }),
  );

serve(router, { port: 3000 });
```

### Full App (Validation + Messaging + RPC + Pub/Sub + Rate-Limit)

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { withMessaging, withRpc } from "@ws-kit/plugins";
import { withPubSub } from "@ws-kit/pubsub";
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { redisPubSub, redisRateLimiter } from "@ws-kit/redis";
import { serve } from "@ws-kit/bun";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    roles?: string[];
  }
}

const router = createRouter()
  .plugin(withZod())
  .plugin(withMessaging())
  .plugin(withRpc())
  .plugin(withPubSub({ adapter: redisPubSub(redis) }))
  .use(
    rateLimit({
      limiter: redisRateLimiter(redis, { capacity: 1000, tokensPerSecond: 50 }),
      key: keyPerUserPerType,
    }),
  );

serve(router, { port: 3000 });
```

### With Middleware (Future)

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { useAuth, useLogging } from "@ws-kit/middleware";
import { serve } from "@ws-kit/bun";

const router = createRouter()
  .plugin(withZod())
  .use(useAuth({ secret: process.env.JWT_SECRET }))
  .use(useLogging({ level: "debug" }));

serve(router, { port: 3000 });
```

### Client-Side (Typed)

```typescript
import { wsClient } from "@ws-kit/client/zod"; // or /valibot
import { PingMessage, PongMessage } from "./schema.js";

const client = await wsClient("ws://localhost:3000");

// Type-safe send
await client.send(PingMessage, { text: "Hello" });

// Type-safe request (RPC)
const response = await client.request(PingMessage, { text: "Hello" });
console.log(response); // Typed as PongMessage
```

---

## What Gets Re-exported?

### From `@ws-kit/zod` (also same in `@ws-kit/valibot`)

```typescript
// Canonical sources, re-exported for convenience:
export { createRouter } from "@ws-kit/core";
export { withMessaging, withRpc } from "@ws-kit/plugins";
export { withPubSub } from "@ws-kit/pubsub";
export { rateLimit, keyPerUser, keyPerUserPerType } from "@ws-kit/rate-limit";
export { memoryPubSub, memoryRateLimiter } from "@ws-kit/memory";
export { z, message, withZod } from "./internal"; // Validator-specific
```

**This means these imports are equivalent:**

```typescript
// Option A: Canonical sources
import { withMessaging } from "@ws-kit/plugins";
import { withPubSub } from "@ws-kit/pubsub";

// Option B: Via validator (convenience)
import { withMessaging, withPubSub } from "@ws-kit/zod";

// Both work, both import from same source. Use whichever is clearer in your code.
```

### NOT Re-exported

These are **only** available from canonical sources:

```typescript
// MUST use canonical source:
import { useAuth } from "@ws-kit/middleware"; // ✓
import { usePubSub } from "@ws-kit/pubsub"; // ✓
import { redisPubSub } from "@ws-kit/redis"; // ✓
import { DurablePubSub } from "@ws-kit/cloudflare"; // ✓

// These DON'T work (not re-exported from validators):
// import { useAuth } from "@ws-kit/zod";           // ✗
// import { redisPubSub } from "@ws-kit/zod";       // ✗
```

---

## Decision: Canonical vs Convenience

### Use Canonical When:

- **Documentation**: Always show canonical imports in specs
- **Teaching**: Learning examples use canonical sources
- **Clarity**: Explicit about package ownership
- **Future**: New features have clear import sources

### Use Convenience When:

- **Consistency**: Everything from your validator package
- **Fewer imports**: All core stuff from one place
- **Refactoring**: Easier to switch validators if you re-export from them

### Real Talk

Both are valid. Canonical is more explicit; convenience is more cohesive. Pick one style for your project and stick with it. Don't mix both in the same codebase.

---

## Future Expansion

As new plugins are added, each gets its own package:

```typescript
// Current
import { withPubSub } from "@ws-kit/pubsub";
import { rateLimit } from "@ws-kit/rate-limit";

// Future
import { withTelemetry } from "@ws-kit/telemetry";
import { withCompression } from "@ws-kit/compression";
import { withCaching } from "@ws-kit/caching";
import { withObservability } from "@ws-kit/observability";

// All imported from their feature packages
// All re-exported from @ws-kit/zod and @ws-kit/valibot
```

---

## See Also

- [ADR-032](../adr/032-canonical-imports-design.md) - Complete design and rationale
- [docs/specs/plugins.md](./plugins.md) - Plugin system reference
- [docs/specs/adapters.md](./adapters.md) - Adapter documentation
- [CLAUDE.md](../../CLAUDE.md) - Quick start guide
