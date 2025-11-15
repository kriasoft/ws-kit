# Plugins

Complete reference for the plugin system: how plugins work, core plugins shipped with WS-Kit, and how to implement custom plugins.

**Quick Reference**: Plugins add capabilities to the router via `.plugin()` method. Each plugin can:

- Define TypeScript types (adding methods to context)
- Register middleware
- Initialize adapter backends
- Gate features at compile-time and runtime

See [ADR-031](../adr/031-plugin-adapter-architecture.md) for design rationale and [ADR-032](../adr/032-canonical-imports-design.md) for canonical import sources.

## Plugin Locations & Canonical Imports

**Core Framework Plugins** (import from `@ws-kit/plugins`):

- `withMessaging()` — Fire-and-forget unicast/broadcast
- `withRpc()` — Request-response with streaming

**Feature Plugins** (import from feature packages):

- `withPubSub()` — Topic-based pub/sub (canonical: `@ws-kit/pubsub`)
- `withRateLimit()` — Rate limiting (canonical: `@ws-kit/rate-limit`)
- Future: `withTelemetry()`, `withCompression()`, `withCaching()` (each has own package)

**Validator Plugins** (choose one validator, import from its package):

- `withZod()` / `withValibot()` — All-in-one validation plugin

**Convenience Re-exports** (optional, from validators):

Core plugins and feature plugins are re-exported from `@ws-kit/zod` and `@ws-kit/valibot` for convenience. See [ADR-032: Canonical Imports Design](../adr/032-canonical-imports-design.md) for complete rules and rationale.

---

## Overview

### What is a Plugin?

A plugin is a function that:

1. **Takes** a router instance and optional configuration
2. **Returns** a modified router (or void if modifying in-place)
3. **Enhances** context with new methods, middleware, or capabilities
4. **Types** the router at compile-time to gate method availability

### Plugin Composition

Plugins compose sequentially. Each plugin can depend on earlier plugins.

```typescript
const router = createRouter()
  .plugin(withValidation()) // Step 1: Enables type inference for payload
  .plugin(withMessaging()) // Step 2: Adds ctx.send()
  .plugin(withRpc()) // Step 3: Adds ctx.reply(), ctx.progress()
  .plugin(withPubSub()); // Step 4: Adds ctx.publish()
```

**Dependency Model**:

- `withValidation()` has no dependencies
- `withMessaging()` depends on `withValidation()` (type-level only)
- `withRpc()` depends on `withValidation()` and `withMessaging()`
- `withPubSub()` depends on `withMessaging()`
- `withRateLimit()` has no dependencies (can apply anywhere)

### Plugin Registration Styles

**Style 1: Validator Plugins (Recommended for Most Apps)**

```typescript
import { createRouter, withZod } from "@ws-kit/zod"; // or @ws-kit/valibot
import { withPubSub } from "@ws-kit/pubsub";
import { redisPubSub } from "@ws-kit/redis";

const router = createRouter()
  .plugin(withZod()) // ✅ Includes validation + messaging + RPC
  .plugin(
    withPubSub({
      adapter: redisPubSub(redis),
    }),
  );
```

**Style 2: Granular Plugins (For Advanced Composition)**

```typescript
import { createRouter } from "@ws-kit/core";
import { withZod } from "@ws-kit/zod"; // or withValibot from @ws-kit/valibot
import { withMessaging, withRpc } from "@ws-kit/plugins";
import { withPubSub } from "@ws-kit/pubsub";

const router = createRouter()
  .plugin(withZod())
  .plugin(withMessaging())
  .plugin(withRpc())
  .plugin(withPubSub());
```

---

## Core Plugins

### Validation Plugins

**Location**: `@ws-kit/zod` and `@ws-kit/valibot` (validator adapters)

**Purpose**: Enable type-safe schema validation and payload type inference in handlers.

Validation is provided by validator adapter plugins rather than a standalone plugin. Choose your validator:

**Example (Zod)**:

```typescript
import { createRouter, withZod } from "@ws-kit/zod";
import { message } from "@ws-kit/zod";

const router = createRouter().plugin(withZod());

router.on(message("PING", { text: z.string() }), (ctx) => {
  ctx.payload.text; // ✅ Inferred as string
});
```

**Example (Valibot)**:

```typescript
import { createRouter, withValibot } from "@ws-kit/valibot";
import { message } from "@ws-kit/valibot";

const router = createRouter().plugin(withValibot());

router.on(message("PING", { text: v.string() }), (ctx) => {
  ctx.payload.text; // ✅ Inferred as string
});
```

**Type Effects**:

```typescript
interface ContextWithValidation {
  payload: TPayload; // Type inferred from schema
  error(code: string, message: string, details?: unknown): void | Promise<void>;
  // Plus messaging and RPC methods (composed from withMessaging, withRpc)
}
```

---

### `withMessaging()`

**Location**: `@ws-kit/plugins/src/messaging`

**Purpose**: Enable fire-and-forget messaging to individual connections.

**Configuration**: None

**Effects**:

- Adds `ctx.send(schema, data, opts?)` method
- Allows sending typed messages to current connection
- Works with or without validation plugin

**Example**:

```typescript
router.on(message("PING", { text: z.string() }), (ctx) => {
  ctx.send(message("PONG"), { reply: `Got: ${ctx.payload.text}` });
});
```

**Type Effects**:

```typescript
interface ContextWithMessaging {
  send<TPayload>(
    schema: MessageSchema<TPayload>,
    data: TPayload,
    opts?: SendOptions,
  ): void | Promise<void>;
}
```

**SendOptions**:

```typescript
interface SendOptions {
  waitFor?: "drain" | "ack"; // Wait for send completion
  signal?: AbortSignal; // Cancel if aborted
  meta?: Record<string, unknown>; // Additional metadata
}
```

---

### `withRpc()`

**Location**: `@ws-kit/plugins/src/rpc`

**Purpose**: Enable request-response patterns with streaming progress updates.

**Configuration**: None

**Effects**:

- Adds `.rpc(schema, handler)` method to router
- Adds `ctx.reply()` and `ctx.progress()` to handlers
- Requires `withValidation()` plugin (enforced at type-level)
- Auto-correlates responses via `correlationId`

**Example**:

```typescript
const FetchDataRequest = message("FETCH_DATA", { id: z.string() });
const FetchDataResponse = message("FETCH_DATA_RESPONSE", { data: z.unknown() });

router.rpc(FetchDataRequest, FetchDataResponse, (ctx) => {
  ctx.reply({ data: fetchedData });
});

// Or with streaming progress
router.rpc(FetchDataRequest, FetchDataResponse, (ctx) => {
  ctx.progress({ data: partial1 });
  ctx.progress({ data: partial2 });
  ctx.reply({ data: complete });
});
```

**Type Effects**:

```typescript
interface ContextWithRpc {
  reply<TResponse>(
    payload: TResponse,
    opts?: ReplyOptions,
  ): void | Promise<void>;

  progress<TResponse>(
    payload: TResponse,
    opts?: ProgressOptions,
  ): void | Promise<void>;

  error<TDetails = unknown>(
    code: string,
    message: string,
    details?: TDetails,
    opts?: ReplyOptions,
  ): void | Promise<void>;
}

interface ReplyOptions {
  waitFor?: "drain" | "ack";
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
}

interface ProgressOptions extends ReplyOptions {
  throttleMs?: number; // Rate-limit rapid updates
}
```

---

### `withPubSub(config?)`

**Location**: `@ws-kit/pubsub` (canonical; also re-exported from `@ws-kit/zod`/`@ws-kit/valibot` for convenience)

**Purpose**: Enable topic-based broadcasting to multiple subscribers.

**Configuration**:

```typescript
interface PubSubConfig {
  adapter?: PubSubAdapter; // Defaults to memoryPubSub()
}
```

**Effects**:

- Adds `ctx.publish(topic, schema, data)` method
- Adds `ctx.topics.subscribe(topic)` and `ctx.topics.unsubscribe(topic)`
- Works with any backend via adapters (memory, Redis, Cloudflare, custom)
- No validation dependency required

**Example**:

```typescript
// Subscribe (in a handler or lifecycle hook)
await ctx.topics.subscribe("chat:room-123");

// Publish
router.publish("chat:room-123", MessageSchema, { text: "Hello" });

// Unsubscribe
await ctx.topics.unsubscribe("chat:room-123");
```

**Adapter Swap Pattern** (no code change needed):

```typescript
// Development (memory adapter, zero config)
.plugin(withPubSub())  // Uses memoryPubSub() by default

// Production (Redis adapter)
import { redisPubSub } from "@ws-kit/redis";
.plugin(withPubSub({ adapter: redisPubSub(redis) }))

// Cloudflare Workers (Durable Objects)
import { cloudflarePubSub } from "@ws-kit/cloudflare";
.plugin(withPubSub({ adapter: cloudflarePubSub(env.DURABLE_OBJECTS) }))
```

**Type Effects**:

```typescript
interface ContextWithPubSub {
  publish<TPayload>(
    topic: string,
    schema: MessageSchema<TPayload>,
    data: TPayload,
    opts?: SendOptions,
  ): void | Promise<void>;

  topics: {
    subscribe(topic: string): Promise<void>;
    unsubscribe(topic: string): Promise<void>;
    list(): Promise<string[]>; // List subscribed topics for this connection
  };
}
```

---

### `withRateLimit(config?)`

**Location**: `@ws-kit/rate-limit` (canonical; also re-exported from `@ws-kit/zod`/`@ws-kit/valibot` for convenience)

**Purpose**: Enable rate-limiting of messages per connection, per user, or per type.

**Configuration**:

```typescript
interface RateLimitConfig {
  adapter?: RateLimiterAdapter; // Defaults to memoryRateLimiter()
  capacity: number; // Token bucket size (default: 100)
  tokensPerSecond: number; // Refill rate (default: 10)
  key?: (ctx: MinimalContext) => string; // Custom key function
}
```

**Effects**:

- Registers global middleware that checks rate limits before handlers
- Blocks over-limit messages with error
- Works with any backend via adapters (memory, Redis, Cloudflare)

**Example**:

```typescript
import { withRateLimit } from "@ws-kit/rate-limit";
import { redisRateLimiter } from "@ws-kit/redis";

const router = createRouter().plugin(
  withRateLimit({
    adapter: redisRateLimiter(redis),
    capacity: 1000,
    tokensPerSecond: 50,
    key: (ctx) => `user:${ctx.data.userId}`, // Per-user limit
  }),
);
```

**Built-in Key Functions**:

```typescript
// Per-connection (default)
key: (ctx) => ctx.clientId;

// Per-user
key: (ctx) => `user:${ctx.data.userId}`;

// Per-user-per-type
key: (ctx) => `user:${ctx.data.userId}:${ctx.type}`;
```

**Type Effects**:

```typescript
// Rate limiting applies globally; no context methods added
// Handlers run only if rate limit not exceeded
// If exceeded, automatic error response is sent
```

---

## Adapter System

### What is an Adapter?

An adapter is a backend implementation for a plugin. Adapters:

- Implement the plugin's interface contract
- Handle backend-specific concerns (Redis, memory, Cloudflare, etc.)
- Are swappable without code changes

### Core Adapter Interfaces

#### `PubSubAdapter`

```typescript
export interface PubSubAdapter {
  /**
   * Subscribe a connection to a topic.
   */
  subscribe(clientId: string, topic: string): Promise<void>;

  /**
   * Unsubscribe a connection from a topic.
   */
  unsubscribe(clientId: string, topic: string): Promise<void>;

  /**
   * Publish a message to all subscribers of a topic.
   * Returns publish result with matched subscriber count.
   */
  publish(topic: string, message: SerializedMessage): Promise<PublishResult>;

  /**
   * List all topics a connection is subscribed to.
   */
  list(clientId: string): Promise<string[]>;
}

export interface PublishResult {
  matched: number; // Number of subscribers that received message
  capability: "exact" | "prefix" | "regex"; // Matching mode used
}
```

#### `RateLimiterAdapter`

```typescript
export interface RateLimiterAdapter {
  /**
   * Attempt to consume tokens from the bucket.
   * Returns whether consumption succeeded (tokens available).
   */
  consume(
    key: string,
    tokens: number,
  ): Promise<{
    ok: boolean;
    retryAfterMs?: number; // When tokens will be available
  }>;

  /**
   * Reset the bucket (clear all tokens).
   */
  reset(key: string): Promise<void>;
}
```

### Memory Adapters (Zero-Config Defaults)

Memory adapters are available in `@ws-kit/memory` for development and testing.

**`memoryPubSub()`**:

```typescript
import { memoryPubSub } from "@ws-kit/memory";

const router = createRouter().plugin(withPubSub({ adapter: memoryPubSub() }));
```

**`memoryRateLimiter()`**:

```typescript
import { memoryRateLimiter } from "@ws-kit/memory";

const router = createRouter().plugin(
  withRateLimit({
    adapter: memoryRateLimiter(),
    capacity: 100,
    tokensPerSecond: 10,
  }),
);
```

### External Adapters

External packages provide production-grade adapters.

#### `@ws-kit/redis`

Distributed pub/sub and rate-limiting via Redis.

```typescript
import { createClient } from "redis";
import { redisPubSub, redisRateLimiter } from "@ws-kit/redis";

const redis = createClient();
await redis.connect();

const router = createRouter()
  .plugin(withPubSub({ adapter: redisPubSub(redis) }))
  .plugin(
    withRateLimit({
      adapter: redisRateLimiter(redis),
      capacity: 1000,
      tokensPerSecond: 50,
    }),
  );
```

#### `@ws-kit/cloudflare`

Cloudflare Workers adapters using Durable Objects and native rate limiting.

```typescript
import { cloudflarePubSub, cloudflareRateLimiter } from "@ws-kit/cloudflare";

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const router = createRouter()
      .plugin(withPubSub({ adapter: cloudflarePubSub(env.DURABLE_OBJECTS) }))
      .plugin(
        withRateLimit({
          adapter: cloudflareRateLimiter(env.RATE_LIMITER),
          capacity: 1000,
          tokensPerSecond: 50,
        }),
      );

    return router.handle(req, ctx);
  },
};
```

### Custom Adapters

Users can implement custom adapters for proprietary backends.

**Example: Kafka Pub/Sub**:

```typescript
import { PubSubAdapter } from "@ws-kit/core";

export function kafkaPubSub(producer: KafkaProducer): PubSubAdapter {
  return {
    subscribe: async (clientId, topic) => {
      // Track subscription client-side (Kafka doesn't have subscriptions)
      await subscriptionMap.set(`${topic}:${clientId}`, true);
    },
    unsubscribe: async (clientId, topic) => {
      await subscriptionMap.delete(`${topic}:${clientId}`);
    },
    publish: async (topic, message) => {
      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
      const subscribers = await subscriptionMap.keys(`${topic}:*`);
      return { matched: subscribers.length, capability: "exact" };
    },
    list: async (clientId) => {
      const keys = await subscriptionMap.keys(`*:${clientId}`);
      return keys.map((k) => k.split(":")[0]);
    },
  };
}
```

---

## Plugin Type Safety

### Capability Gating

TypeScript enforces that methods only exist if their plugins are registered.

```typescript
const router = createRouter();

// ❌ Error: Property 'send' does not exist
router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, {}); // Missing withMessaging() plugin
});

// ✅ OK after adding plugin
const router2 = createRouter().plugin(withMessaging());

router2.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, {}); // ✅ Available now
});
```

### How It Works

Each plugin returns a router with enhanced type signatures:

```typescript
// Type-level tracking
interface Router<
  TValidator extends ValidatorAdapter,
  TContext extends ConnectionData,
  TCapabilities extends Record<string, unknown>,
> {
  plugin<TNewCapability>(
    plugin: Plugin<TContext, TNewCapability>,
  ): Router<TValidator, TContext, TCapabilities & TNewCapability>;

  on<TPayload, TResponse>(
    schema: MessageSchema<TPayload>,
    handler: (ctx: MinimalContext & TCapabilities) => void,
  ): this;
}
```

---

## Plugin Definition (Advanced)

### Creating a Custom Plugin

Use `definePlugin()` helper for full type safety:

```typescript
import { definePlugin } from "@ws-kit/core";

export interface MyPluginCapability {
  myMethod(arg: string): void;
}

export function withMyPlugin(): Plugin<ConnectionData, MyPluginCapability> {
  return definePlugin<ConnectionData, MyPluginCapability>(
    "myPlugin",
    (router, config) => {
      // Register middleware
      router.use((ctx, next) => {
        // Enhance context
        (ctx as any).myMethod = (arg: string) => {
          console.log("My plugin method called with:", arg);
        };
        return next();
      });

      return router;
    },
  );
}
```

**Usage**:

```typescript
const router = createRouter().plugin(withMyPlugin());

router.on(someSchema, (ctx) => {
  ctx.myMethod("hello"); // ✅ TypeScript knows about this
});
```

---

## Plugin Composition Patterns

### Pattern 1: Feature Feature Flags

Enable/disable features with configuration:

```typescript
export function withMessaging(config?: { enabled?: boolean }): Plugin {
  if (config?.enabled === false) {
    return (router) => router; // No-op
  }

  return (router) => {
    // Register messaging middleware
    router.use((ctx, next) => {
      ctx.send = (schema, data) => {
        /* ... */
      };
      return next();
    });
    return router;
  };
}
```

### Pattern 2: Conditional Adapters

Choose adapters based on environment:

```typescript
const adapter =
  process.env.NODE_ENV === "production" ? redisPubSub(redis) : memoryPubSub();

const router = createRouter().plugin(withPubSub({ adapter }));
```

### Pattern 3: Plugin Dependencies

Ensure plugins are registered in correct order. Type system enforces this:

```typescript
// ❌ Type error: withRpc() requires withValidation()
const router = createRouter().plugin(withRpc());

// ✅ OK: withValidation() before withRpc()
const router = createRouter().plugin(withValidation()).plugin(withRpc());
```

---

## Best Practices

1. **Always validate input schemas**

   ```typescript
   // ❌ No validation
   router.on((ctx) => {
     console.log(ctx.payload); // Any type
   });

   // ✅ With validation
   router.on(message("PING", { text: z.string() }), (ctx) => {
     console.log(ctx.payload.text); // string
   });
   ```

2. **Use memory adapters for development, external for production**

   ```typescript
   const adapter =
     process.env.NODE_ENV === "production"
       ? redisPubSub(redis)
       : memoryPubSub();
   ```

3. **Extract adapter initialization to functions**

   ```typescript
   // ❌ Adapter logic scattered
   function createApp() {
     return createRouter().plugin(
       withPubSub({
         adapter:
           process.env.NODE_ENV === "production"
             ? redisPubSub(redis)
             : memoryPubSub(),
       }),
     );
   }

   // ✅ Clean initialization
   function createAdapter() {
     return process.env.NODE_ENV === "production"
       ? redisPubSub(redis)
       : memoryPubSub();
   }

   function createApp() {
     return createRouter().plugin(withPubSub({ adapter: createAdapter() }));
   }
   ```

4. **Configure rate limits per use case**

   ```typescript
   // Strict (API key)
   .plugin(withRateLimit({
     capacity: 100,
     tokensPerSecond: 5,
     key: (ctx) => ctx.data.apiKey,
   }))

   // Relaxed (authenticated user)
   .plugin(withRateLimit({
     capacity: 1000,
     tokensPerSecond: 50,
     key: (ctx) => `user:${ctx.data.userId}`,
   }))
   ```

5. **Use topic namespacing for organization**

   ```typescript
   // ❌ Flat namespace (collision risk)
   await ctx.topics.subscribe("messages");

   // ✅ Hierarchical (clear organization)
   await ctx.topics.subscribe("chat:room:123:messages");
   await ctx.topics.subscribe("notifications:user:456");
   ```

---

## Migration Guide

### Canonical Import Sources (All Versions)

Always use canonical sources per [ADR-032](../adr/032-canonical-imports-design.md):

**Recommended** (validator convenience):

```typescript
import { createRouter, withZod } from "@ws-kit/zod"; // or @ws-kit/valibot
import { withPubSub } from "@ws-kit/pubsub";
import { withRateLimit } from "@ws-kit/rate-limit";

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub())
  .plugin(withRateLimit());
```

**Explicit** (canonical sources, same imports):

```typescript
import { createRouter, withZod } from "@ws-kit/zod";
import { withMessaging, withRpc } from "@ws-kit/plugins";
import { withPubSub } from "@ws-kit/pubsub";
import { withRateLimit } from "@ws-kit/rate-limit";

const router = createRouter()
  .plugin(withZod())
  .plugin(withMessaging())
  .plugin(withRpc())
  .plugin(withPubSub())
  .plugin(withRateLimit());
```

**Note**: Importing from non-canonical sources (e.g., `withPubSub` from `@ws-kit/plugins` when it's actually in `@ws-kit/pubsub`) will fail. Always use the canonical source for each feature.

---

## References

- [ADR-032](../adr/032-canonical-imports-design.md) - Canonical imports design (FOUNDATIONAL: import sources for all plugins)
- [ADR-031](../adr/031-plugin-adapter-architecture.md) - Plugin-adapter split decision
- [ADR-028](../adr/028-plugin-architecture-final-design.md) - Plugin architecture design
- [docs/specs/router.md](./router.md) - Router API and handler registration
- [docs/specs/context-methods.md](./context-methods.md) - Context methods reference
- [docs/specs/pubsub.md](./pubsub.md) - Pub/sub patterns and semantics
- [docs/specs/adapters.md](./adapters.md) - Adapter system and implementations
