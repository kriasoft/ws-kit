# @ws-kit/pubsub

Policy enforcement middleware for pub/sub operations (topic normalization, authorization).

**Note:** The core `withPubSub()` plugin has moved to `@ws-kit/plugins`. This package provides optional policy middleware for controlling subscribe/publish/unsubscribe operations.

## Installation

```bash
bun add @ws-kit/pubsub
```

## Quick Start

```typescript
import { createRouter, message, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/plugins";
import { memoryPubSub } from "@ws-kit/memory";
import { usePubSub } from "@ws-kit/pubsub";
import { z } from "zod";

declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
  }
}

const Notify = message("NOTIFY", { text: z.string() });

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub({ adapter: memoryPubSub() }))
  .use(
    usePubSub({
      hooks: {
        normalizeTopic: (topic) => topic.toLowerCase(),
        authorize: async (action, topic, ctx) => {
          if (action === "subscribe" && !ctx.data?.userId) {
            throw new Error("Unauthorized");
          }
        },
      },
    }),
  );

router.on(Notify, async (ctx) => {
  await ctx.topics.subscribe("room:lobby");
  await ctx.publish("room:lobby", Notify, { text: "Hello" });
});
```

## Architecture

### File Structure

```bash
src/
├─ core/                   # Core pub/sub primitives (internal)
│  ├─ topics.ts            # OptimisticTopics, createTopics(): per-connection subscription state
│  ├─ error.ts             # PubSubError, AbortError, error codes
│  └─ constants.ts         # DEFAULT_TOPIC_PATTERN, DEFAULT_TOPIC_MAX_LENGTH
├─ adapters/
│  └─ memory.ts            # In-memory adapter implementation (use via @ws-kit/memory)
├─ index.ts                # Public exports (plugin, adapters, middleware, types)
├─ plugin.ts               # withPubSub() plugin factory
├─ middleware.ts           # usePubSub() policy enforcement middleware
├─ types.ts                # Type definitions (Topics, PublishOptions, hooks)
└─ internal.ts             # Internal re-exports (OptimisticTopics, createTopics, etc. for core)
```

### Design Principles

- **`core/`** — Internal implementation details not part of public API. Used by `@ws-kit/core` router for managing subscription state.
- **`adapters/`** — Extensible location for adapter implementations (memory, Redis, Cloudflare, etc.).
- **Public API** — `plugin.ts`, `middleware.ts`, and user-facing types exported from `index.ts`.
- **Internal API** — Implementation classes and core primitives exported from `internal.ts` for `@ws-kit/core` integration only.

### Components

#### Plugin: `withPubSub({ adapter })`

The core `withPubSub()` plugin is now in `@ws-kit/plugins`. It adds pub/sub capability to the router:

```typescript
import { withPubSub } from "@ws-kit/plugins";
import { memoryPubSub } from "@ws-kit/memory";

const router = createRouter().plugin(withPubSub({ adapter: memoryPubSub() }));
```

Provides:

- `router.publish(topic, schema, payload, opts)` — Broadcast to topic subscribers
- `ctx.publish(topic, schema, payload, opts)` — Publish from handler
- `ctx.topics` — Per-connection subscription operations

See `@ws-kit/plugins` for the complete plugin API.

#### Middleware: `usePubSub(options)`

Optional middleware for topic normalization and authorization.

```typescript
.use(usePubSub({
  hooks: {
    normalizeTopic: (topic, ctx) => {
      // Apply transformations (e.g., lowercase, validation)
      return topic.toLowerCase();
    },
    authorize: async (action, topic, ctx) => {
      // Check permissions before subscribe/unsubscribe/publish
      const allowed = await checkAccess(ctx.data.userId, action, topic);
      if (!allowed) throw new Error("Access denied");
    },
  },
}))
```

Supported actions: `"subscribe"`, `"unsubscribe"`, `"publish"`

#### Adapter: In-Memory (from `@ws-kit/memory`)

In-memory pub/sub adapter using `Map<topic, Set<clientId>>`. Available from memory package for zero-config development:

```typescript
import { memoryPubSub } from "@ws-kit/memory";

const adapter = memoryPubSub();
```

For production, use distributed adapters like `redisPubSub()` from `@ws-kit/redis` or `cloudflarePubSub()` from `@ws-kit/cloudflare`.

All adapters implement the same `PubSubAdapter` interface, so swapping is seamless.

## API Reference

### Router Methods

```typescript
// Publish to a topic (process-wide)
await router.publish(topic, schema, payload, options?);

// Query subscriptions
router.subscriptions.list();     // → string[]
router.subscriptions.has(topic); // → boolean
```

### Context Methods

```typescript
// Publish to a topic
await ctx.publish(topic, schema, payload, options?);

// Subscribe/unsubscribe
await ctx.topics.subscribe(topic, options?);
await ctx.topics.unsubscribe(topic, options?);

// Batch operations
await ctx.topics.subscribeMany(topics, options?);
await ctx.topics.unsubscribeMany(topics, options?);
await ctx.topics.set(topics, options?);
await ctx.topics.update(mutator, options?);
await ctx.topics.clear(options?);

// Lifecycle and verification
ctx.topics.localStatus(topic);  // Check settlement status
await ctx.topics.settle(topic?, options?);  // Wait for operations to settle
await ctx.topics.verify(topic, options?);   // Verify adapter truth

// Query subscriptions (ReadonlySet<string>)
ctx.topics.has(topic);
ctx.topics.size;
for (const topic of ctx.topics) { ... }
```

### Publish Options

```typescript
interface PublishOptions {
  partitionKey?: string; // Routing hint for distributed adapters
  meta?: Record<string, unknown>; // Custom metadata
  excludeSelf?: boolean; // Exclude sender (not yet supported)
}
```

## Features

- **Lightweight**: Minimal in-memory implementation using Map and Set
- **Type-safe**: Full TypeScript support with capability gating
- **Plugin-based**: Integrates seamlessly with WS-Kit's plugin system
- **Functional**: Plain factory function design, consistent with `createRouter()` and `message()`
- **Flexible**: Optional policy middleware for normalization and authorization
- **Portable**: Identical semantics across adapters

## License

MIT
