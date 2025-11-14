# ADR-031: Plugin-Adapter Architecture

**Status:** Final
**Date:** 2025-11-14
**References:** ADR-028 (Plugin System), ADR-021 (Adapter-First Architecture), ADR-025 (Validator Plugins)

---

## Context

As the plugin system matured (ADR-028), a new question emerged: **where should stateful features like pub/sub and rate-limiting live?**

### The Challenge

Three candidates competed for ownership:

1. **In core packages** (`@ws-kit/core`) — Always available, zero config
2. **In validator packages** (`@ws-kit/zod`, `@ws-kit/valibot`) — With validation plugins
3. **In separate packages** (`@ws-kit/pubsub`, `@ws-kit/rate-limit`) — One feature per package

Each had trade-offs:

| Option     | Pros                           | Cons                                                            |
| ---------- | ------------------------------ | --------------------------------------------------------------- |
| Core       | Always available, discoverable | Bloats core; some users don't need it                           |
| Validators | Ships with validation          | Couples unrelated features; requires duplication in Zod/Valibot |
| Separate   | Clear ownership, opt-in        | Multiple imports, more packages to manage                       |

### The Real Problem

The real issue wasn't **where to put features**, but **where to put backends**:

- **Pub/Sub** works the same on a single server (memory) or Redis (distributed)
- **Rate-limiting** works the same locally (token bucket in memory) or globally (Redis Streams)
- Users should swap adapters without rewriting code

We needed a **plugin-adapter split**: plugins = framework features (live in core), adapters = backend implementations (live in separate packages).

---

## Decision

### Core Principle: Plugin vs Adapter

**Plugins** = Framework features, adapter-agnostic:

- `withMessaging()` — Unicast and broadcast
- `withRpc()` — Request-response with streaming
- `withPubSub()` — Pub/sub pattern (any backend)
- `withRateLimit()` — Rate limiting (any backend)

**Adapters** = Backend implementations:

- Memory adapters in `@ws-kit/core` (defaults, zero config)
- Redis adapters in `@ws-kit/redis`
- Cloudflare adapters in `@ws-kit/cloudflare`
- Custom adapters anywhere (user-provided)

### Package Structure

```
@ws-kit/core/src
├── plugins/                    # Framework features (validator-agnostic)
│   ├── messaging/
│   │   ├── index.ts           # withMessaging() plugin
│   │   └── types.ts           # SendOptions, etc.
│   ├── rpc/
│   │   ├── index.ts           # withRpc() plugin
│   │   └── types.ts           # ReplyOptions, ProgressOptions, RpcContext
│   ├── pubsub/
│   │   ├── index.ts           # withPubSub() plugin
│   │   └── types.ts           # PubSubAdapter interface, types
│   ├── rate-limit/
│   │   ├── index.ts           # withRateLimit() plugin
│   │   └── types.ts           # RateLimiterAdapter interface
│   └── validation/
│       ├── index.ts           # withValidation() plugin (generic)
│       └── types.ts           # ValidatorAdapter interface
└── index.ts                   # Re-exports: all plugins

@ws-kit/zod & @ws-kit/valibot/src
└── index.ts                   # Re-exports core plugins (convenience)

@ws-kit/memory/src             # In-memory adapters (development/testing)
├── pubsub.ts                  # memoryPubSub() - in-memory implementation
├── limiter.ts                 # memoryRateLimiter() - in-memory token bucket
└── index.ts                   # Re-exports: all memory adapters

@ws-kit/redis/src
├── pubsub.ts                  # redisPubSub(client) adapter
├── rate-limit.ts              # redisRateLimiter(client) adapter
└── index.ts

@ws-kit/cloudflare/src
├── pubsub.ts                  # cloudflarePubSub(durableObjects) adapter
├── rate-limit.ts              # cloudflareRateLimiter(env) adapter
└── index.ts
```

**Key Design:**

- **Plugins** (`@ws-kit/plugins`) contain framework APIs—stateless or adapter-agnostic
- **Memory adapters** (`@ws-kit/memory`) are bundled defaults for zero-config dev
- **External adapters** (`@ws-kit/redis`, `@ws-kit/cloudflare`) are separate packages for production
- **Separate plugins package**—all core plugins live in `@ws-kit/plugins` for clean separation

**Why a separate plugins package?**

- ✅ All plugins centralized and easy to discover (single import source: `@ws-kit/plugins`)
- ✅ Simpler core package (core owns routing, adapters own adapter interfaces)
- ✅ Cleaner mental model (core = framework, plugins = capabilities)
- ✅ Extensibility (users can add plugins without core bloat)
- ⚠️ Trade-off: One more package to import from (but re-exported by validators for convenience)

---

## Rationale

### 1. Plugins in Core (High-Use Framework Features)

**Why `withPubSub()` and `withRateLimit()` belong in core:**

- **Validator-agnostic**: Work with Zod, Valibot, or custom validators
- **High usage**: ~60% of real-time apps need pub/sub; ~40% need rate-limiting
- **No backend coupling**: Plugin defines API; adapter provides backend
- **Small footprint**: ~180 LOC combined (plugins only, no adapter logic)
- **Discoverability**: Users expect framework features in core

**What lives in plugins:**

- `withPubSub()` → context API (`ctx.publish()`), middleware integration
- `withRateLimit()` → middleware, rate-limit checking logic
- **No backend-specific code** (Redis Lua scripts, Cloudflare APIs, etc.)

---

### 2. Memory Adapters in Core (Zero-Config Defaults)

**Why default adapters belong in core:**

- **Development experience**: Works immediately, no Redis setup needed
- **Testing**: Apps pass tests without external infrastructure
- **Learning**: Beginners can focus on logic, not configuration
- **Backward compatible**: Apps transition from dev → prod by swapping adapters

**Examples:**

```typescript
// In-memory pub/sub (development)
export function memoryPubSub(): PubSubAdapter {
  const subscriptions = new Map<string, Set<string>>();
  return {
    subscribe: (clientId, topic) => {
      if (!subscriptions.has(topic)) subscriptions.set(topic, new Set());
      subscriptions.get(topic)!.add(clientId);
    },
    publish: (topic, message) => {
      const subscribers = subscriptions.get(topic) || new Set();
      return { matched: subscribers.size, capability: "exact" };
    },
    // ... unsubscribe, etc.
  };
}

// Token-bucket rate limiter (development)
export function memoryRateLimiter(): RateLimiterAdapter {
  const buckets = new Map<string, { tokens: number; lastRefill: number }>();
  return {
    consume: async (key, count) => {
      // Token bucket algorithm
    },
  };
}
```

**Size impact:** ~110 LOC in core (negligible)

---

### 3. External Adapters in Separate Packages (Optional Production)

**Why Redis/Cloudflare adapters stay separate:**

- **Heavy dependencies**: `@ws-kit/redis` requires redis client (~50KB)
- **Platform-specific**: Cloudflare APIs only work in Workers environment
- **Versioning**: Adapters evolve independently from core
- **Choice**: Apps without these don't pay bundle cost

**Examples:**

```typescript
// @ws-kit/redis
export function redisPubSub(client: RedisClient): PubSubAdapter {
  return {
    subscribe: (clientId, topic) => client.sadd(keyOf(topic), clientId),
    publish: (topic, message) => client.publish(keyOf(topic), JSON.stringify(message)),
  };
}

// @ws-kit/cloudflare
export function cloudflarePubSub(env: CloudflareEnv): PubSubAdapter {
  return {
    subscribe: (clientId, topic) => env.DURABLE_OBJECTS.stub.request(...),
    publish: (topic, message) => env.DURABLE_OBJECTS.stub.request(...),
  };
}
```

---

## Benefits

### For Users

| Scenario        | Experience                                                           |
| --------------- | -------------------------------------------------------------------- |
| **Development** | `withPubSub()` uses memory adapter by default; works immediately     |
| **Testing**     | No Redis needed; in-memory adapters sufficient                       |
| **Production**  | Swap to `redisPubSub(redis)` by changing one line                    |
| **Scaling**     | Seamless move from single-server to distributed without code changes |

### For Maintainers

| Benefit                    | Details                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| **No duplication**         | Plugins defined once in core; adapters in separate packages      |
| **Clear ownership**        | Each adapter package owns its backend (Redis, Cloudflare, etc.)  |
| **Independent versioning** | Core, validators, and adapters can release on separate schedules |
| **Extensibility**          | Users can implement custom adapters without forking              |

---

## Implementation

### Phase 1: Extract Shared Logic (Unblock Plugins)

Move from validator plugins to core (`@ws-kit/core/src/`):

- `SendOptions`, `ReplyOptions`, `ProgressOptions` types
- Meta utilities: `sanitizeMeta()`, `preserveCorrelationId()`
- Throttling utilities
- RPC guards (one-shot reply logic)

**Risk**: Low—just moving existing code

### Phase 2: Create Core Plugins

Add to `@ws-kit/core/src/plugins/`:

- `messaging/index.ts` + `types.ts` — `withMessaging()` (~100 LOC)
- `rpc/index.ts` + `types.ts` — `withRpc()` (~120 LOC)
- `pubsub/index.ts` + `types.ts` — `withPubSub()` (~100 LOC)
- `rate-limit/index.ts` + `types.ts` — `withRateLimit()` (~80 LOC)

Each plugin gets its own subdirectory with implementation and types.

**Risk**: Low—existing logic refactored from validators

### Phase 3: Create Memory Adapters

Add to `@ws-kit/memory/src/`:

- `pubsub.ts` — `memoryPubSub()` adapter (~50 LOC)
- `limiter.ts` — `memoryRateLimiter()` adapter (~60 LOC)

Memory adapters implement the adapter interfaces defined in their corresponding plugins.

**Risk**: Low—simple in-memory implementations

### Phase 4: External Adapters (Parallel)

Create or update external packages:

- `@ws-kit/redis` — `redisPubSub()`, `redisRateLimiter()`
- `@ws-kit/cloudflare` — `cloudflarePubSub()`, `cloudflareRateLimiter()`

**Risk**: Low—independent from core

### Phase 5: Update Validators

Refactor `@ws-kit/zod` and `@ws-kit/valibot`:

- Import plugins from core instead of implementing
- Re-export core plugins for convenience

**Risk**: Low—non-breaking for public API

---

## Usage Examples

### Development (Zero Config)

```typescript
import { createRouter, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/plugins";
import { memoryPubSub } from "@ws-kit/memory";

const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub({ adapter: memoryPubSub() })); // ✅ Zero-config memory adapter
```

### Production (Redis Adapters)

```typescript
import { createRouter, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/plugins";
import { redisPubSub } from "@ws-kit/redis";

const router = createRouter()
  .plugin(withZod())
  .plugin(
    withPubSub({
      adapter: redisPubSub(redis), // ✅ Swap adapter
    }),
  );
```

### Cloudflare Workers

```typescript
import { withPubSub } from "@ws-kit/plugins";
import { cloudflarePubSub } from "@ws-kit/cloudflare";

const router = createRouter()
  .plugin(withZod())
  .plugin(
    withPubSub({
      adapter: cloudflarePubSub(env.DURABLE_OBJECTS), // Cloudflare DO
    }),
  );
```

---

## Adapter Interface Contract

### PubSubAdapter

```typescript
export interface PubSubAdapter {
  subscribe(clientId: string, topic: string): Promise<void>;
  unsubscribe(clientId: string, topic: string): Promise<void>;
  publish(topic: string, message: Message): Promise<PublishResult>;
  list(clientId: string): Promise<string[]>;
}
```

### RateLimiterAdapter

```typescript
export interface RateLimiterAdapter {
  consume(
    key: string,
    tokens: number,
  ): Promise<{ ok: boolean; retryAfterMs?: number }>;
  reset(key: string): Promise<void>;
}
```

---

## Consequences

### Positive

- ✅ **Zero-config development**: `withPubSub()` works immediately
- ✅ **Simple production setup**: One-line adapter swap
- ✅ **No code changes**: Dev code works unchanged in production
- ✅ **Clear ownership**: Each package has one job
- ✅ **Extensible**: Users can implement custom adapters
- ✅ **No duplication**: Plugins in core, adapters separate
- ✅ **Tree-shakeable**: Unused adapters not included in bundle

### Negative

- ❌ **More packages**: Users manage core + validators + adapters
- ❌ **Adapter discovery**: Finding available adapters requires looking at docs
- ❌ **Custom adapters**: Users must implement adapter interface (but it's small)

### Trade-offs

| Aspect                   | Dev Experience                | Production Complexity |
| ------------------------ | ----------------------------- | --------------------- |
| **Single package**       | ❌ All features bundled       | ✅ Easy deployment    |
| **Plugin-adapter split** | ✅ Zero-config, swap adapters | ✅ Explicit, flexible |

---

## Future Considerations

1. **Adapter registry**: Docs/tooling to discover available adapters
2. **More adapters**: Kafka, RabbitMQ, AWS SNS/SQS, etc.
3. **Adapter market**: Community-maintained adapters
4. **Auto-selection**: Smart adapter choice based on environment (dev vs prod)

---

## References

- **ADR-028**: Plugin Architecture - Type-safe plugin system foundation
- **ADR-021**: Adapter-First Architecture - Original adapter pattern
- **docs/specs/plugins.md** — Comprehensive plugin reference
- **docs/specs/adapters.md** — Adapter interface specifications
