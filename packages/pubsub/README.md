# @ws-kit/pubsub

In-memory pub/sub plugin for WS-Kit with optional policy enforcement (topic normalization, authorization).

## Installation

```bash
npm install @ws-kit/pubsub
```

## Quick Start

```typescript
import { createRouter } from "@ws-kit/core";
import { withPubSub, createMemoryAdapter, usePubSub } from "@ws-kit/pubsub";
import { message } from "@ws-kit/zod";
import { z } from "zod";

type AppData = { userId: string };

const Notify = message("NOTIFY", { text: z.string() });

const router = createRouter<AppData>()
  .plugin(withPubSub(createMemoryAdapter()))
  .use(
    usePubSub({
      hooks: {
        normalizeTopic: (topic) => topic.toLowerCase(),
        authorize: async (action, topic, ctx) => {
          if (action === "subscribe" && !ctx.data.userId) {
            throw new Error("Unauthorized");
          }
        },
      },
    }),
  );

router.on(Notify, async (ctx) => {
  await ctx.topics.subscribe("room:lobby");
  ctx.publish("room:lobby", Notify, { text: "Hello" });
});
```

## Architecture

### File Structure

```bash
src/
├─ core/                    # Core pub/sub primitives (internal)
│  ├─ topics.ts            # TopicsImpl: per-connection subscription state
│  ├─ error.ts             # PubSubError, AbortError, error codes
│  └─ constants.ts         # DEFAULT_TOPIC_PATTERN, MAX_TOPIC_LENGTH
├─ adapters/
│  └─ memory.ts            # createMemoryAdapter() implementation
├─ index.ts                # Public exports (plugin, adapters, middleware, types)
├─ plugin.ts               # withPubSub() plugin factory
├─ middleware.ts           # usePubSub() policy enforcement middleware
├─ types.ts                # Type definitions (Topics, PublishOptions, hooks)
└─ internal.ts             # Internal re-exports (TopicsImpl, etc. for core)
```

### Design Principles

- **`core/`** — Internal implementation details not part of public API. Used by `@ws-kit/core` router for managing subscription state.
- **`adapters/`** — Extensible location for adapter implementations (memory, Redis, Cloudflare, etc.).
- **Public API** — `plugin.ts`, `middleware.ts`, and user-facing types exported from `index.ts`.
- **Internal API** — Implementation classes and core primitives exported from `internal.ts` for `@ws-kit/core` integration only.

### Components

#### Plugin: `withPubSub(adapter)`

Adds pub/sub capability to the router.

```typescript
import { withPubSub, createMemoryAdapter } from "@ws-kit/pubsub";

const router = createRouter().plugin(withPubSub(createMemoryAdapter()));
```

Provides:

- `router.publish(topic, schema, payload, opts)` — Broadcast to topic subscribers
- `router.subscriptions.list()` — Active topics
- `router.subscriptions.has(topic)` — Check if topic has subscribers
- `ctx.publish(topic, schema, payload, opts)` — Publish from handler
- `ctx.topics` — Per-connection subscription operations

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

#### Adapter: `createMemoryAdapter()`

In-memory implementation using `Map<topic, Set<clientId>>`.

Implements `PubSubAdapter` interface:

```typescript
interface PubSubAdapter {
  publish(msg: PubSubMessage): Promise<void>;
  subscribe(clientId: string, topic: string): Promise<void>;
  unsubscribe(clientId: string, topic: string): Promise<void>;
  listTopics(): readonly string[];
  hasTopic(topic: string): boolean;
}
```

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
await ctx.topics.replace(topics, options?);
await ctx.topics.clear(options?);

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
