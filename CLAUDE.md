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
- **Composition Over Inheritance**: Single `WebSocketRouter<V>` class, any validator + platform combo works
- **Message-Based Routing**: Routes by message `type` field to registered handlers
- **Type Safety**: Full TypeScript inference from schema to handler via generics and overloads
- **Platform Adapters**: `@ws-kit/bun`, `@ws-kit/cloudflare-do`, etc. each with both high-level and low-level APIs
- **Validator Adapters**: `@ws-kit/zod`, `@ws-kit/valibot`, custom validators welcome via `ValidatorAdapter` interface

## API Design Principles

- **Single canonical import source**: Import validator and helpers from one place (`@ws-kit/zod` or `@ws-kit/valibot`) to avoid dual package hazards
- **Plain functions**: `message()` and `createRouter()` are plain functions, not factories
- **Full type inference**: TypeScript generics preserve types from schema through handlers without assertions
- **Runtime identity**: Functions preserve `instanceof` checks and runtime behavior

## Quick Start

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

type AppData = { userId?: string };

const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

const router = createRouter<AppData>();

router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    return { userId: "anonymous" };
  },
});
```

## API Surface

All available methods at a glance:

```typescript
// Fire-and-forget messaging
router.on(Message, async (ctx) => {
  ctx.send(schema, data); // Send to current connection (1-to-1)
  ctx.publish(topic, schema, data); // Broadcast to topic subscribers (1-to-many)
  await ctx.topics.subscribe(topic); // Subscribe to topic (async)
  await ctx.topics.unsubscribe(topic); // Unsubscribe from topic (async)
  ctx.getData(key); // Access typed connection data
  ctx.assignData(partial); // Update connection data
});

// Request-response pattern (RPC)
router.rpc(Request, (ctx) => {
  ctx.reply(schema, data); // Terminal response (one-shot)
  ctx.progress(data); // Non-terminal progress updates
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

**Connection Data**: Pass generic `AppData` type to `createRouter<AppData>()` for full type inference. See [docs/specs/router.md#connection-data](./docs/specs/router.md) for details.

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

### Validator Requirement (Breaking)

Router now requires a validator to be configured. Methods `.on()`, `.off()`, `.use(schema, ...)`, and `.send()` throw immediately if no validator is set.

**Migration**: Create router with validator:

```typescript
import { createRouter } from "@ws-kit/zod"; // Provides validator
// or
const router = new WebSocketRouter({ validator: new ZodAdapter() });
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

## Development

```bash
# Validation
bun run lint        # ESLint with unused directive check
bun tsc --noEmit    # Type checking
bun run format      # Prettier formatting

# Testing
bun test            # Run all tests
bun test --watch    # Watch mode
```

## Test Structure

Tests are organized by package. Each package owns its test directory:

```text
packages/
├── core/test/              # Core router tests + features/
├── zod/test/               # Zod validator tests + features/
├── valibot/test/           # Valibot validator tests + features/
├── bun/test/               # Bun adapter tests
├── client/test/            # Client tests (runtime/ + types/)
└── cloudflare-do/test/     # Cloudflare DO adapter tests
```

**When adding tests:**

- **Core features**: `packages/core/test/features/`
- **Validator features**: Mirror Zod tests in Valibot with same structure
- **Type inference tests**: Use `packages/*/test/types/`
- **Adapters**: Add to respective `packages/*/test/`

**Run tests:**

```bash
bun test                           # All tests
bun test packages/zod/test         # Specific package
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
