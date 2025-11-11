# Advanced: Testing Across Multiple Platforms

WS-Kit is designed to work across multiple platforms (Bun, Cloudflare Durable Objects, Deno, etc.). This guide shows how to test the same router code across different runtimes.

## Platform-Specific Packages (Not Generic Runtime Selection)

Unlike other frameworks, WS-Kit uses **platform-specific packages** rather than a single generic `serve()` function. Each platform has its own package:

- **`@ws-kit/bun`** — Bun runtime (with `serve()` convenience)
- **`@ws-kit/cloudflare`** — Cloudflare Durable Objects (low-level only)
- **Future: `@ws-kit/deno`** — Deno runtime

See [ADR-006](../adr/006-multi-runtime-serve-with-explicit-selection.md) for the design rationale.

## Example: Testing the Same Router Under Multiple Platforms

To validate that your router works across platforms, create a test that runs the same handler logic under different platform adapters:

```typescript
import { describe, it, expect } from "bun:test";
import { z, createRouter, message } from "@ws-kit/zod";

// Define shared schemas (platform-independent)
const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

// Define router logic (platform-independent)
function createTestRouter() {
  const router = createRouter();
  router.on(PingMessage, (ctx) => {
    ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
  });
  return router;
}

// Test under Bun
describe("Router under Bun", () => {
  it("handles ping-pong", async () => {
    const { serve } = await import("@ws-kit/bun");
    const router = createTestRouter();

    // Start server on a unique port
    const port = 3001;
    const controller = new AbortController();
    serve(router, { port, signal: controller.signal });

    // Connect and test
    const { wsClient } = await import("@ws-kit/client/zod");
    const client = wsClient(`ws://localhost:${port}`);

    const reply = await client.send(PingMessage, { text: "hello" });
    expect(reply.reply).toBe("Got: hello");

    await client.close();
    controller.abort();
  });
});
```

## Integration Testing with Jest/Vitest

For more complex multi-platform testing:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRouter, message } from "@ws-kit/zod";
import type { WebSocketClient } from "@ws-kit/client";

const QueryMessage = message("QUERY", { id: z.string() });
const ResponseMessage = message("RESPONSE", { result: z.any() });

describe("Platform compatibility", () => {
  for (const platform of ["bun", "deno"] as const) {
    describe(`${platform} platform`, () => {
      let server: any;
      let client: WebSocketClient;
      let port: number;

      beforeAll(async () => {
        const router = createRouter();
        router.rpc(QueryMessage, (ctx) => {
          ctx.reply(ResponseMessage, {
            result: `Processed: ${ctx.payload.id}`,
          });
        });

        if (platform === "bun") {
          const { serve } = await import("@ws-kit/bun");
          port = 3002;
          server = await serve(router, { port });
        } else {
          // Future: Deno support
          // const { serve } = await import("@ws-kit/deno");
          // port = 3003;
          // server = await serve(router, { port });
        }

        const { wsClient } = await import("@ws-kit/client/zod");
        client = wsClient(`ws://localhost:${port}`);
        await client.connect();
      });

      afterAll(async () => {
        await client.close();
        server?.close();
      });

      it("handles RPC queries", async () => {
        const result = await client.request(QueryMessage, { id: "123" });
        expect(result.result).toBe("Processed: 123");
      });
    });
  }
});
```

## Platform-Specific Differences to Handle

When testing across platforms, account for:

1. **Port Binding**: Bun uses `serve()` with a port. Cloudflare DO runs as a Durable Object fetch handler.

   ```typescript
   // Bun
   import { serve } from "@ws-kit/bun";
   serve(router, { port: 3000 });

   // Cloudflare DO
   import { createDurableObjectHandler } from "@ws-kit/cloudflare";
   export default { fetch: createDurableObjectHandler(router).fetch };
   ```

2. **Authentication Context**: Different platforms may have different request/auth models.

   ```typescript
   // Bun: Full HTTP request
   serve(router, {
     authenticate(req) {
       return { userId: req.headers.get("x-user-id") };
     },
   });

   // Cloudflare DO: Durable Object environment
   createDurableObjectHandler(router, {
     authenticate(req) {
       return { userId: req.headers.get("x-user-id") };
     },
   });
   ```

3. **Pub/Sub**: Platform-specific pub/sub adapters.

   ```typescript
   // Bun with memory pub/sub (default)
   serve(router, { port: 3000 });

   // Bun with Redis pub/sub for multi-instance
   import { createRedisPubSub } from "@ws-kit/redis-pubsub";
   serve(router, {
     port: 3000,
     pubsub: createRedisPubSub({ url: "redis://..." }),
   });
   ```

## CI/CD Pattern: Test All Platforms

In your `vitest.config.ts` or similar:

```typescript
export default {
  test: {
    globals: true,
    include: ["**/*.test.ts"],
    // Run platform-compatibility tests in CI
    testTimeout: 10000,
  },
};
```

Then in your test suite:

```bash
# Run all tests including platform compatibility
bun test

# Or filter by platform
bun test --grep="Bun platform"
```

## Production Deployment

For actual deployments, use the **platform-specific package** directly:

```typescript
// Production on Bun
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();
// ... register handlers
serve(router, { port: 3000 });

// Production on Cloudflare DO
import { createDurableObjectHandler } from "@ws-kit/cloudflare";

export default {
  fetch: createDurableObjectHandler(router).fetch,
};
```

**No runtime detection or environment variables needed** — choose your platform at compile time.

## See Also

- [ADR-006: Per-Platform Packages](../adr/006-multi-runtime-serve-with-explicit-selection.md) — Design rationale
- [Deployment Guide](../deployment.md) — Production deployment patterns
- [Platform Adapters](../specs/adapters.md) — Platform adapter responsibilities
