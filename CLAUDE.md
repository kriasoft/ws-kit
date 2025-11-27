# WS-Kit

WS-Kit — Type-Safe WebSocket router for Bun and Cloudflare.

## Documentation

**ADRs** (`docs/adr/NNN-slug.md`): Architectural decisions (reference as ADR-NNN)
**SPECs** (`docs/specs/slug.md`): Component specifications (reference as docs/specs/slug.md)

### Component Specifications

- `docs/specs/README.md` — Navigation hub for all specifications
- `docs/specs/schema.md` — Message structure, type definitions, canonical imports
- `docs/specs/router.md` — Server router API, handlers, lifecycle hooks
- `docs/specs/validation.md` — Validation flow, normalization, error handling
- `docs/specs/context-methods.md` — Handler context methods: send, reply, progress, publish
- `docs/specs/plugins.md` — Plugin system: core plugins, adapters, custom plugins
- `docs/specs/canonical-imports.md` — Quick reference for canonical import sources
- `docs/specs/pubsub.md` — Pub/Sub API, topic subscriptions, publishing, patterns
- `docs/specs/client.md` — Client SDK API, connection states, queueing
- `docs/specs/adapters.md` — Platform adapter responsibilities, limits, pub/sub guarantees
- `docs/specs/patterns.md` — Architectural patterns for production applications
- `docs/specs/rules.md` — Development rules (MUST/NEVER) with links to details
- `docs/specs/error-handling.md` — Error codes and patterns
- `docs/specs/test-requirements.md` — Type-level and runtime test requirements
- `docs/adr/README.md` — Architectural decision records index

## Architecture

- **Modular Packages**: `@ws-kit/core` router with pluggable validator and platform adapters
- **Capability Plugins**: `.plugin()` gates features (validation, pub/sub) for both runtime and types
- **Composition Over Inheritance**: Single `WebSocketRouter<V>` class, any validator + platform combo works
- **Message-Based Routing**: Routes by message `type` field to registered handlers
- **Type Safety**: Full TypeScript inference from schema to handler via generics and overloads
- **Platform Adapters**: `@ws-kit/bun`, `@ws-kit/cloudflare`, etc. each with both high-level and low-level APIs
- **Validator Adapters**: `@ws-kit/zod`, `@ws-kit/valibot`, custom validators welcome via `ValidatorAdapter` interface

## API Design Principles

- **Plain functions**: `message()` and `createRouter()` are plain functions, not factories
- **Full type inference**: TypeScript generics preserve types from schema through handlers without assertions
- **Runtime identity**: Functions preserve `instanceof` checks and runtime behavior

## Quick Start

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { redisPubSub } from "@ws-kit/redis";
import { serve } from "@ws-kit/bun";
import { createClient } from "redis";

declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    roles?: string[];
  }
}

const redis = createClient({ url: process.env.REDIS_URL! });
await redis.connect();

const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub({ adapter: redisPubSub(redis) }));

router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "user_123", roles: ["admin"] } : undefined;
  },
});
```

**Key concepts**:

- **Canonical imports** (see ADR-032): Always import plugins from their official sources
  - Validators + helpers: `@ws-kit/zod` or `@ws-kit/valibot` (choose one)
  - Core plugins: `@ws-kit/plugins` (`withMessaging`, `withRpc`)
  - Feature plugins: Feature-specific packages (`@ws-kit/pubsub`, `@ws-kit/rate-limit`, etc.)
  - Adapters: Adapter packages (`@ws-kit/memory`, `@ws-kit/redis`, `@ws-kit/cloudflare`)
- Plugins add capabilities: `.plugin(withZod())` (validation), `.plugin(withPubSub())` (broadcasting)
- Module augmentation for `ConnectionData` (define once, shared across routers)
- Adapters provide backends: memory (dev), Redis/Cloudflare (production)

## API Surface

All available methods at a glance:

```typescript
// Fire-and-forget messaging
router.on(Message, async (ctx) => {
  ctx.send(schema, data); // Send to current connection (1-to-1)
  ctx.publish(topic, schema, data); // Broadcast to topic subscribers (1-to-many)
  await ctx.topics.subscribe(topic); // Subscribe to topic (async)
  await ctx.topics.unsubscribe(topic); // Unsubscribe from topic (async)
  ctx.data; // Access typed connection data
  ctx.assignData(partial); // Update connection data
});

// Request-response pattern (RPC)
router.rpc(Request, (ctx) => {
  ctx.reply(payload, opts?); // Terminal response (one-shot)
  ctx.progress(update, opts?); // Non-terminal progress updates
});

// Client-side
client.send(schema, data); // Fire-and-forget to server
client.request(schema, data); // RPC call (returns Promise, auto-correlation)
```

**Naming rationale** (see ADRs):

- `send()` vs `publish()` — one connection vs many (ADR-020)
- `reply()` vs `send()` — RPC terminal response vs fire-and-forget (ADR-015)
- `progress()` — non-terminal RPC updates for streaming (ADR-015)
- `request()` — client-side RPC with auto-correlation (ADR-014)

**Connection Data**: Use `createRouter<ConnectionData>()` for full type inference. Module augmentation allows you to define connection data once and share across all routers. See [docs/specs/router.md#custom-connection-data](./docs/specs/router.md) for details.

## Key Patterns

For detailed pattern documentation, see the specs:

- **Route Composition** — [docs/specs/router.md#route-composition](./docs/specs/router.md)
- **Middleware** — [docs/specs/router.md#middleware](./docs/specs/router.md)
- **Authentication** — [docs/specs/router.md#authentication](./docs/specs/router.md)
- **Request-Response (RPC)** — [docs/specs/router.md#rpc](./docs/specs/router.md)
- **Broadcasting & Pub/Sub** — [docs/specs/pubsub.md](./docs/specs/pubsub.md)
- **Client-Side** — [docs/specs/client.md](./docs/specs/client.md)
- **Error Handling** — [docs/specs/error-handling.md](./docs/specs/error-handling.md)
- **Connection Data** — [docs/specs/router.md#connection-data](./docs/specs/router.md)

Each spec includes code examples, type signatures, and detailed semantics.

## Recent Changes & Breaking Updates

### Validation Plugin Required for RPC (Breaking)

The `.rpc()` method requires a validation plugin (`withZod()` or `withValibot()`). Fire-and-forget `.on()` works without validation but won't validate payloads.

**Migration**: Add validation plugin for RPC support:

```typescript
import { createRouter } from "@ws-kit/zod";
// or
const router = createRouter().plugin(withZod());
```

### Heartbeat is Now Opt-In (Breaking)

Heartbeat is no longer initialized by default. Only enable when explicitly configured.

**Migration**: Add heartbeat config if needed:

```typescript
createRouter({
  heartbeat: {
    intervalMs: 30_000, // Optional: defaults to 30s
    timeoutMs: 5_000, // Optional: defaults to 5s
    onStaleConnection: (clientId, ws) => {
      /* cleanup */
    },
  },
});
```

### PubSub is Lazily Initialized (Non-Breaking)

PubSub instance is created only on first use. Apps without broadcasting get zero overhead.

### Publish Validation Coverage

The validation plugin now enforces outbound checks for `ctx.publish()` (send/reply/publish per ADR-025). Router-level `publish()` remains payload-blind by design; rely on validator plugins and handler-side publishing for schema enforcement.

## Development

```bash
# Validation
bun lint        # ESLint with unused directive check
bun typecheck   # Type checking (tsc --build tsconfig.check.json)
bun tsc --build packages/*/tsconfig.check.json  # Per-package type check
bun format      # Prettier formatting

# Testing
bun test            # Run all tests
bun test --watch    # Watch mode
```

## Test Structure

Hybrid structure: unit tests co-located in `src/`, feature tests in `test/`, cross-package in `tests/`.

```text
packages/<name>/
├── src/*.test.ts          # Unit tests next to implementation
└── test/features/         # Feature/integration tests (optional)

tests/
├── integration/           # Cross-package integration
├── e2e/                   # Full client-server scenarios
├── benchmarks/            # Performance benchmarks
└── helpers/               # Shared utilities
```

**When adding tests:**

- **Unit tests**: `packages/*/src/*.test.ts` (next to the file being tested)
- **Feature tests**: `packages/*/test/features/` (integration scenarios)
- **Validator features**: Mirror Zod tests in Valibot
- **Cross-package**: `tests/integration/` or `tests/e2e/`

**Run tests:**

```bash
bun test                           # All tests
bun test packages/core/src         # Package unit tests
bun test packages/zod/test         # Package feature tests
bun test --grep "pattern"          # By pattern
bun test --watch                   # Watch mode
```

## Implementing Application Patterns

See [docs/patterns/README.md](./docs/patterns/README.md) for detailed guides and examples.

### Workflow

1. Copy template: `cp -r examples/state-channels examples/my-pattern`
2. Define message contract (in `contract.json` or `schema.ts`, using canonical field names from [docs/invariants.md](./docs/invariants.md))
3. Implement `server.ts` and `client.ts` using the contract (use `ctx.send()`, `ctx.publish()` in handlers, or direct `ws.send()` in helper methods)
4. Create 3+ fixtures in `fixtures/NNN-description.json` (numbered 001, 002, 003...)
5. Write `conformance.test.ts` to validate fixtures
6. Update `docs/patterns/README.md` with pattern description

> Example: All three shipped patterns (`state-channels`, `flow-control`, `delta-sync`) use `contract.json`. Alternatively, a TypeScript schema (`schema.ts`) is also valid.

### Checklist

- [ ] Fixtures numbered sequentially (001, 002, 003) with no gaps
- [ ] Zero `// @ts-ignore` directives in implementations
- [ ] Contract/schema uses canonical field names from `docs/invariants.md`
- [ ] Pattern referenced in `docs/patterns/README.md`
- [ ] `bun test examples/my-pattern/conformance.test.ts` passes

### Validate

```bash
bun run test:patterns  # Runs CI checks on all patterns
```
