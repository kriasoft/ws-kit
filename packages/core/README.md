# @ws-kit/core

**Tiny, composable WebSocket router for Bun and Cloudflare.**

## Core Concepts

- **Minimal by design**: `createRouter()` contains only routing, not validation or pub/sub
- **Plugin-driven**: Validators (Zod, Valibot) and Pub/Sub are added via plugins
- **Capability-gated**: APIs exist only when enabled; no "method throws disabled"
- **Type-safe**: Full TypeScript inference from schema through handlers
- **Platform-agnostic**: Works with any platform (Bun, Cloudflare, Node.js)

## Import Patterns

`createRouter()` is the base router factory available from `@ws-kit/core`. It's also re-exported from validator packages (`@ws-kit/zod`, `@ws-kit/valibot`) for convenience:

- **`@ws-kit/core`** — Base router (minimal, validator-agnostic). Use when you need a bare router or want explicit control over plugin imports.
- **`@ws-kit/zod`** / **`@ws-kit/valibot`** — Re-export `createRouter` plus validators and helpers for single-source imports.

**Recommended**: Import from your validator package for a single canonical import source:

```typescript
// ✅ Single import source (recommended)
import { createRouter, withZod, z, message } from "@ws-kit/zod";

const router = createRouter().plugin(withZod());
```

Both patterns work equally well — choose based on your preference.

## Quick Start

```typescript
import { createRouter } from "@ws-kit/core";
import { withZod } from "@ws-kit/zod"; // or withValibot from @ws-kit/valibot

const router = createRouter<{ userId?: string }>().plugin(withZod()); // Add validation plugin for full features

// Register an event handler (with validation)
router.on(schema, (ctx) => {
  ctx.data; // { userId?: string }
  ctx.type; // Literal from schema
  ctx.payload; // Typed payload (available with validation plugin)
});

// Errors flow to universal sink
router.onError((err, ctx) => {
  console.error("error:", err, "type:", ctx?.type);
});
```

## API Surface

### Base Router (always available)

```typescript
router.use(mw); // Global middleware
router.on(schema, handler); // Event handler
router.route(schema).use(mw).on(handler); // Per-route middleware + handler
router.merge(other, { onConflict: "error" }); // Combine routers
router.mount("prefix.", other); // Prefix types for namespacing
router.plugin(withZod()); // Add capabilities
router.onOpen((ctx) => {}); // Connection opened (after auth)
router.onClose((ctx) => {}); // Connection closed
router.onError((err, ctx) => {}); // Universal error sink
```

### Added by Plugins

After `withZod()` or `withValibot()`:

```typescript
router.rpc(schema, handler); // RPC handlers (request-response)
```

After `withPubSub()`:

```typescript
router.publish(topic, schema, payload);
// ctx.subscribe(topic), ctx.unsubscribe(topic), ctx.subscriptions
```

## Architecture

- **`src/router/`** — Core routing: factory, dispatch, middleware, registry
- **`src/context/`** — Context types: base, event, RPC
- **`src/schema/`** — Runtime message shape: contracts for validators
- **`src/plugin/`** — Plugin system: capability management
- **`src/capabilities/`** — Adapter contracts (no implementations)
- **`src/ws/`** — WebSocket adapter interface
- **`src/error/`** — Unified error handling
- **`src/options/`** — Heartbeat & rate limiting
- **`src/utils/`** — Utilities: assertions, composition, ID generation

## Design Philosophy

From [docs/proposals/router.md](../../docs/proposals/router.md):

1. **No hidden APIs**: Capability-gated; throw on missing plugin
2. **Validator-agnostic**: Adapters implement `ValidatorAdapter` interface
3. **Deterministic composition**: `merge()` and `mount()` with explicit conflict resolution
4. **Single error sink**: All errors flow to `router.onError()`
5. **Transparent behavior**: Heartbeat & limits add no API surface
6. **No branding symbols**: Type-level inference only; schemas are plain objects at runtime

## Type Safety

Full type inference from schema through handlers:

```typescript
// Schema defines the contract
const UserUpdate = message("USER_UPDATE", {
  id: z.string(),
  name: z.string(),
});

// Handler context is inferred
router.on(UserUpdate, (ctx) => {
  ctx.payload; // { id: string; name: string }
  ctx.type; // "USER_UPDATE"
});
```

## Error Handling

Single universal error sink with error codes:

```typescript
router.onError((err, ctx) => {
  if (err instanceof WsKitError) {
    console.log("Error code:", err.code); // "BAD_REQUEST", "INVALID_ARGUMENT", etc.
    console.log("Retryable:", err.retryable);
  }
});
```

## Testing

`createTestRouter()` provides in-memory transport + fake clock:

```typescript
import { createTestRouter } from "@ws-kit/core/testing";

const testRouter = createTestRouter(router);
testRouter.clock.advance(30_000); // Fast-forward heartbeat
testRouter.capture.errors(); // Assert on errors
```

## See Also

- **Router proposal**: [docs/proposals/router.md](../../docs/proposals/router.md)
- **Validator contracts**: See `@ws-kit/zod`, `@ws-kit/valibot`
- **Platform adapters**: See `@ws-kit/bun`, `@ws-kit/cloudflare`
- **Pub/Sub adapters**: See `@ws-kit/redis`, `@ws-kit/kafka`

## License

MIT
