# ADR-006: Per-Platform Packages with Both High-Level and Low-Level APIs

**Status**: Accepted
**Date**: 2025-10-29
**Related**: ADR-005, ADR-007

## Context

WebSocket routing must be available across multiple platforms (Bun, Cloudflare Durable Objects, Deno, etc.), but each platform has different APIs and semantics:

- Bun: `Bun.serve()` with `{ fetch, websocket }`
- Cloudflare DO: Durable Object handler with `fetch(request)`
- Deno: `Deno.serve()` with WebSocket upgrade

This creates design tensions:

1. **Not all platforms have "serve"** — Cloudflare DO and serverless runtimes don't bind ports or start servers
2. **Namespace collision risk** — Creating a separate `@ws-kit/serve` package that doesn't have variants for all platforms creates false abstraction
3. **Single source of truth** — Platform-specific code should live in platform-specific packages

## Decision

Each platform adapter package (e.g., `@ws-kit/bun`) exports **both high-level and low-level APIs**:

### High-Level API: `serve()`

Convenience function for quick starts:

```typescript
import { serve } from "@ws-kit/bun";

serve(router, { port: 3000 });
```

- ✅ Recommended for 90% of use cases
- ✅ Sensible defaults (auto-generated client IDs, error handling, etc.)
- ✅ Type-safe options tailored to platform

### Low-Level API: Handler Factory

For advanced users needing full control:

```typescript
import { createBunHandler } from "@ws-kit/bun";

const { fetch, websocket } = createBunHandler(router, options);

Bun.serve({
  port: 3000,
  fetch,
  websocket,
  // Custom options here
});
```

- ✅ Full control over platform-specific config
- ✅ No wrapper layers, direct integration
- ✅ Zero overhead for custom routing logic

### Platform Consistency

**Bun (`@ws-kit/bun`):**

- `serve()` — High-level convenience
- `createBunHandler()` — Low-level control

**Cloudflare Durable Objects (`@ws-kit/cloudflare`):**

- `createDurableObjectHandler()` — Only low-level (no port binding; "serve" isn't a concept)

**Future: Deno (`@ws-kit/deno`):**

- `serve()` — High-level convenience (if applicable)
- `createDenoHandler()` — Low-level control

### Why Not a Separate `@ws-kit/serve` Package?

1. **Conceptual honesty**: Not all platforms have a "serve" concept. Cloudflare DO and serverless runtimes don't bind ports.
2. **Single canonical location**: All platform APIs live in one place (`@ws-kit/bun`, `@ws-kit/cloudflare`, etc.)
3. **Reduced fragmentation**: Developers learning Bun naturally look in `@ws-kit/bun` and find both APIs.
4. **Simpler mental model**: Platform = one package with all variants.
5. **No version skew**: Platform packages are versioned together; no cross-package sync needed.

## Implementation Examples

### Bun High-Level (Recommended)

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

const PingMessage = message("PING", { text: z.string() });

const router = createRouter();
router.on(PingMessage, (ctx) => {
  ctx.send(message("PONG"), { text: `Got: ${ctx.payload.text}` });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    return { userId: "123" };
  },
});
```

### Bun Low-Level (Advanced)

```typescript
import { createBunHandler } from "@ws-kit/bun";

const { fetch, websocket } = createBunHandler(router, {
  authenticate(req) {
    return { userId: "123" };
  },
});

Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      return fetch(req, server);
    }
    return new Response("Not Found", { status: 404 });
  },
  websocket,
  // Custom Bun options available here
});
```

### Cloudflare Durable Objects (Low-Level Only)

```typescript
import { createDurableObjectHandler } from "@ws-kit/cloudflare";

const handler = createDurableObjectHandler(router, {
  authenticate(req) {
    return { userId: "123" };
  },
});

export default {
  fetch: handler.fetch,
};
```

## Package Structure

Platform packages expose both APIs in a single import location:

```
@ws-kit/bun/
├── serve()              # High-level convenience (exported)
├── createBunHandler()   # Low-level control (exported)
└── BunPubSub           # Platform-specific pubsub (internal)

@ws-kit/cloudflare/
├── createDurableObjectHandler()  # Low-level control (only exported)
└── CloudflarePubSub             # Platform-specific pubsub (internal)
```

All APIs live in platform-specific packages. No generic `@ws-kit/serve` multi-runtime wrapper package needed.

## Consequences

### Benefits

✅ **Honest abstractions** — Each package exports what makes sense for its platform
✅ **Single canonical location** — Find all Bun APIs in `@ws-kit/bun`, Cloudflare APIs in `@ws-kit/cloudflare`, etc.
✅ **Two-level API per platform** — High-level `serve()` for 90% of cases, low-level handler factory for advanced users
✅ **No false universality** — Don't pretend Cloudflare DO has a "serve" concept
✅ **Reduced fragmentation** — Developers naturally look in platform package and find all variants
✅ **Type safety** — Options and APIs tailored to platform capabilities
✅ **Zero version skew** — Platform packages versioned together; no cross-package sync
✅ **Backwards compatible** — Direct handler imports always available

### Trade-offs

⚠️ **Multiple packages required** — One for validator (`@ws-kit/zod`), one for platform (`@ws-kit/bun`)
⚠️ **No "universal serve"** — Can't write code that works across all platforms without choosing one
⚠️ **Mental model change** — Developers must understand platform-specific APIs vary

## Alternatives Considered

### 1. Single `@ws-kit/serve` Package with All Runtimes

Create a central package with `@ws-kit/bun`, `@ws-kit/cloudflare`, etc.

**Why rejected:**

- **Conceptual dishonesty**: Cloudflare DO and serverless runtimes don't have a "serve" concept; creating `@ws-kit/cloudflare` is misleading
- **Namespace collision**: Some platforms wouldn't have variants, creating asymmetry and confusion
- **Fragmentation**: Developers looking for Bun APIs split between `@ws-kit/bun` (adapter) and `@ws-kit/bun` (convenience)
- **Version complexity**: Separate package means separate versioning; easier to get skew

### 2. Only Low-Level Handler APIs

Just export `createBunHandler()`, `createCloudflareDOHandler()`, etc. No high-level `serve()`.

**Why rejected:**

- **Reduces DX significantly** — 90% of users would write boilerplate for `Bun.serve()`
- **Inconsistent across platforms**: Bun users write less code than Cloudflare users for the same result
- **Learning curve**: New users must understand platform internals before getting started
- **Encourages bad patterns**: Without high-level defaults, users may miss security/stability considerations

### 3. Central Serve Function with Dynamic Platform Selection

Create a generic `serve()` that detects runtime or uses environment variables.

**Why rejected:**

- **Detection overhead**: Runtime capability checks on startup
- **Ambiguity risk**: Environments with multiple runtimes shimmed (e.g., Deno + Bun compat)
- **Type precision loss**: Can't narrow options to platform-specific capabilities when platform is unknown
- **Not idiomatic**: Different from how platform frameworks work (Remix, SvelteKit, etc.)

## References

- **ADR-005**: Builder Pattern and Symbol Escape Hatch (context for transparent router)
- **ADR-007**: Export-with-Helpers Pattern (uses platform-specific serve() function)
- **Implementation**:
  - `packages/bun/src/serve.ts` — Bun high-level convenience
  - `packages/bun/src/handler.ts` — Bun low-level handler factory
  - `packages/bun/src/index.ts` — Exports both serve() and createBunHandler()
  - `packages/cloudflare/src/` — Cloudflare handler integration
- **Specifications**:
  - `docs/specs/router.md` — Router setup and platform selection
- **Examples**:
  - `examples/quick-start/index.ts` — Bun high-level serve()
  - `examples/bun-zod-chat/index.ts` — Bun low-level control
