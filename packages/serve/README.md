# @ws-kit/serve

Multi-runtime server adapter for ws-kit routers. Deploy the same type-safe WebSocket router to Bun, Cloudflare Workers/Durable Objects, Deno, and Node.js.

## Quick Start

Use **platform-specific entrypoints** for production (recommended):

```ts
import { serve } from "@ws-kit/serve/bun";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();

router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: "pong" });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    return { userId: "123" };
  },
});
```

For Cloudflare Durable Objects:

```ts
import { serve } from "@ws-kit/serve/cloudflare-do";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();

export default {
  fetch(req: Request) {
    return serve(router, {
      authenticate(req) {
        return { userId: "123" };
      },
    }).fetch(req);
  },
};
```

## Platform-Specific Entrypoints (Recommended)

Platform-specific imports provide zero detection overhead, optimal tree-shaking, and type-safe options:

```ts
// Bun
import { serve } from "@ws-kit/serve/bun";

// Cloudflare Durable Objects
import { serve } from "@ws-kit/serve/cloudflare-do";

// Deno
import { serve } from "@ws-kit/serve/deno";
```

**Benefits:**

- **Zero detection** — No runtime probing, deterministic
- **Type-safe options** — Platform-specific options available
- **Better errors** — Clear, platform-specific error messages
- **Optimal bundling** — Tree-shake away unused runtimes

## Advanced: Generic Runtime Selection

For tests, multi-target deployments, or tooling, use the generic entry with explicit runtime:

```ts
import { serve } from "@ws-kit/serve";

serve(router, {
  port: 3000,
  runtime: "bun", // Explicit: "bun" | "cloudflare-do" | "deno"
});

// Or set WSKIT_RUNTIME environment variable
// WSKIT_RUNTIME=bun node server.js
```

**Use cases:**

- Integration tests running the same router under multiple runtimes
- Monorepo tooling that auto-targets different platforms
- Development servers with `--runtime` CLI flag

⚠️ Not recommended for production. See [Advanced: Multi-Runtime Harness](../../docs/guides/advanced-multi-runtime.md) for details.

## Installation

```bash
bun add @ws-kit/serve @ws-kit/zod
```

Then choose how you serve your router:

```ts
// Platform-specific (recommended)
import { serve } from "@ws-kit/serve/bun";

// Or generic with explicit runtime
import { serve } from "@ws-kit/serve";
serve(router, { runtime: "bun", port: 3000 });
```

## Subpath Exports

- **`@ws-kit/serve`** — Generic serve with runtime detection
- **`@ws-kit/serve/bun`** — Bun-specific (zero detection)
- **`@ws-kit/serve/cloudflare-do`** — Cloudflare Durable Objects (zero detection)
- **`@ws-kit/serve/deno`** — Deno runtime (zero detection)
- **`@ws-kit/serve/test`** — Test helpers (bypass detection for multi-runtime tests)

## API Reference

See the [main README](../../README.md#serving-your-router) and [ADR-006](../../docs/adr/006-multi-runtime-serve-with-explicit-selection.md) for complete API documentation.

## Production Recommendations

1. **Use platform-specific entrypoints** for production deployments
2. **Avoid generic `serve()` with runtime detection** in production code
3. **If using environment variables**, set `WSKIT_RUNTIME` explicitly in CI/CD
4. **Keep import paths explicit** — Never rely on auto-detection

See [Advanced: Multi-Runtime Harness](../../docs/guides/advanced-multi-runtime.md) for when the generic approach is appropriate.
