# Advanced: Multi-Runtime Harness

The generic `serve(router, { runtime })` function with explicit runtime selection is designed for advanced scenarios where you need to deploy the same router code to multiple runtimes or dynamically select the target at startup.

**For most applications**, use [platform-specific entrypoints](../index#platform-specific-entrypoints-recommended) instead. This guide covers the advanced use case.

## When to Use Generic Runtime Selection

Use the generic `serve()` approach when:

- **Integration tests** — Run the same router under Bun and Cloudflare DO in CI to ensure compatibility
- **Framework-agnostic examples** — Demonstrate patterns that work across runtimes without modification
- **Monorepo tooling** — Build generators or CLIs that auto-target different platforms based on context
- **Development servers** — Local smoke servers where you pass `--runtime=bun|cf` via CLI flag
- **Flexible deployments** — Code that selects runtime via environment variable (`WSKIT_RUNTIME=bun`)

## Explicit Runtime Selection

Pass `runtime` to `serve()`:

```typescript
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();

serve(router, {
  port: 3000,
  runtime: "bun", // Explicit: "bun", "cloudflare-do", or "deno"
  authenticate(req) {
    return { userId: "123" };
  },
});
```

**Supported runtimes:**

- `"bun"` — Bun runtime
- `"cloudflare-do"` — Cloudflare Durable Objects
- `"deno"` — Deno runtime

## Environment Variable Override

Set `WSKIT_RUNTIME` to choose runtime without code changes:

```bash
# Development
WSKIT_RUNTIME=bun node server.js

# CI testing
WSKIT_RUNTIME=cloudflare-do node server.js

# Production (explicit in code is preferred, but env var works)
WSKIT_RUNTIME=bun node server.js
```

This is useful for:

- CI/CD pipelines that test multiple targets
- Gradual platform migrations
- Local development with a `--runtime` CLI flag

## Example: Conditional Runtime Selection

```typescript
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();

// Select runtime from environment or code
const runtime =
  process.env.WSKIT_RUNTIME ??
  (process.env.NODE_ENV === "production" ? "bun" : "auto");

serve(router, {
  port: 3000,
  runtime: runtime as "bun" | "cloudflare-do" | "deno" | "auto",
});
```

## Example: Integration Test with Multiple Runtimes

```typescript
import { describe, it } from "bun:test";
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";

const router = createRouter();
router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: "pong" });
});

// Test the same router under multiple runtimes
for (const runtime of ["bun", "cloudflare-do"] as const) {
  describe(`Router under ${runtime}`, () => {
    it("handles messages", async () => {
      // Start server on a unique port
      const port = 3000 + (runtime === "bun" ? 0 : 1);
      await serve(router, { port, runtime });

      // Connect and test
      const client = wsClient(`ws://localhost:${port}`);
      await client.connect();

      const reply = await client.request(PingMessage, {}, PongMessage);
      console.assert(reply.payload.reply === "pong");

      await client.disconnect();
    });
  });
}
```

## Caveats

### Limited Type Narrowing

When using generic `serve()`, TypeScript cannot narrow platform-specific options. You lose:

- **Type-safe options** — Can't use Bun-specific backpressure config or Cloudflare binding names
- **Type-checked errors** — Misconfigurations aren't caught at compile time
- **IDE autocomplete** — Options available are generic, not platform-specific

### Not Recommended for Production

For production deployments, use [platform-specific entrypoints](../index#platform-specific-entrypoints-recommended) instead:

```typescript
// ✅ Production: platform-specific, type-safe
import { serve } from "@ws-kit/bun";
serve(router, { port: 3000 });

// ❌ Avoid in production: limited type safety
import { serve } from "@ws-kit/bun";
serve(router, { runtime: "bun", port: 3000 });
```

**Why?** Platform entrypoints:

- Encode runtime semantics (options, error types, bindings)
- Fail fast with clear, platform-specific error messages
- Tree-shake better (zero detection overhead)
- Make the deployment target explicit in your codebase

## Production Safety

In production (`NODE_ENV === "production"`), explicit runtime selection is required. Auto-detection is disabled:

```typescript
// ❌ Production error: must specify runtime
serve(router, { port: 3000 });
// Error: Auto-detection disabled in production.
// Use serve(router, { runtime: "bun" }) or WSKIT_RUNTIME env var.
```

## See Also

- [ADR-006: Multi-Runtime serve()](../adr/006-multi-runtime-serve-with-explicit-selection) — Design decision and rationale
