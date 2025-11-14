# ADR-021: Adapter-First Architecture for Stateful Features

**Status**: Proposed
**Date**: 2025-11-01
**Related**: ADR-006 (multi-runtime serve), ADR-008 (middleware)

## Context

ws-kit must support production deployments across diverse runtimes: single-instance Bun, multi-pod Node.js, Cloudflare Workers/Durable Objects, and edge runtimes. Features requiring shared state (rate limiting, deduplication, presence, sessions) face a fundamental portability challenge:

1. **Single-instance (Bun)**: In-memory state works fine; no coordination needed
2. **Multi-pod (Node.js)**: Must coordinate state across pods (Redis, Memcached, etc.)
3. **Serverless (Cloudflare Workers)**: Isolated execution contexts; need Durable Objects or external KV stores
4. **Edge runtimes**: Lightweight state access; geographically distributed

A naive approach—hardcoding Redis or in-memory state—breaks at least one deployment model. A monolithic "choose your backend" library becomes unmaintainable as runtimes proliferate.

**The problem**: How do we ship stateful features that work identically across all runtimes without littering the codebase with backend-specific logic?

## Decision

Establish **adapter-first architecture**: Core packages define lean **adapter interfaces** (contracts); adapters implement those contracts for specific backends. This decouples policy (middleware) from storage/communication (adapters).

### TL;DR

- ✅ Core defines the interface (contract only, no impl)
- ✅ Middleware consumes the interface (policy-agnostic)
- ✅ Adapters implement the interface (one per backend: memory, Redis, Durable Objects)
- ✅ Apps choose adapters based on deployment (single-instance, multi-pod, serverless)
- ✅ All adapters pass the same test suite (correctness guarantees)

### Core Principle

**One interface, many implementations**:

- Interface lives in `@ws-kit/core` (or relevant core package)
- Implementations live in `@ws-kit/adapters` (organized by backend)
- Middleware consumes the interface, never specific adapters
- Apps choose the adapter that fits their deployment

### Example: Rate Limiting

```typescript
// Interface (core package)
export interface RateLimitStore {
  consume(key: string, cost: number): Promise<RateLimitDecision>;
}

// Middleware (doesn't care about backend)
export function createRateLimiter(opts: {
  store: RateLimitStore; // ← Any adapter implementing the interface
  key: (ctx) => string;
  cost: (ctx) => number;
}): Middleware;

// Adapters (one per backend)
export function createMemoryBackend(): RateLimitBackend; // @ws-kit/adapters/memory
export function createRedisBackend(): RateLimitBackend; // @ws-kit/adapters/redis
export function createDurableObjectBackend(): RateLimitBackend; // @ws-kit/adapters/cloudflare
```

### Package Structure

```
@ws-kit/core
├── Adapter interfaces (RateLimitStore, KVStore, PubSub, etc.)
└── Router, validators, error handling

@ws-kit/middleware
├── createRateLimiter(store)
├── createDeduplicator(store)
├── createPresence(pubsub)
└── (All middleware agnostic to backend)

@ws-kit/adapters
├── memory/        → memoryStore, memoryPubSub (Bun, Node.js dev)
├── redis/         → redisStore, redisPubSub (multi-pod production)
└── cloudflare/ → durableObjectStore, durableObjectPubSub (Workers)
```

## Design Directives

**DO**:

- ✅ Define interfaces in core; implementations in `@ws-kit/adapters/*`
- ✅ Make interfaces async-first (support both sync and network backends)
- ✅ Design interfaces to be minimal and backend-agnostic
- ✅ Require all adapters to pass the same contract test suite
- ✅ Use subpath imports (`@ws-kit/adapters/redis`) to isolate dependencies

**NEVER**:

- ❌ Hardcode backend selection (no auto-detection; let apps choose)
- ❌ Expose backend-specific operations in the middleware interface
- ❌ Create separate packages per adapter (consolidate in `@ws-kit/adapters`)
- ❌ Skip contract tests for new adapters
- ❌ Assume a specific storage model (KV, relational, etc.)

## Design Constraints

### 1. Adapter Interface Design

Interfaces must be:

- **Async-first** — Support both sync (memory) and async (network) backends
- **Minimal** — Only capture the contract, not implementation details
- **Backend-agnostic** — Never assume a specific storage model (key-value, relational, etc.)

Example good interface:

```typescript
interface RateLimitStore {
  consume(key: string, cost: number): Promise<RateLimitDecision>;
}
```

Example bad interface:

```typescript
interface RateLimitStore {
  get(key: string): Promise<number>; // ← Assumes key-value model
  set(key: string, value: number): Promise<void>;
  // ← Exposes impl details; not atomic; adapters must manage policy
}
```

### 2. Where Adapters Live

- **Core logic** → `@ws-kit/core` (interfaces only; no impl)
- **Cross-runtime adapters** → `@ws-kit/adapters` (memory, Redis, etc.)
- **Runtime-specific helpers** → Runtime packages (e.g., `@ws-kit/bun`, `@ws-kit/cloudflare`)

**Not allowed**: Scattered `@ws-kit/rate-limit-redis`, `@ws-kit/rate-limit-memory`, etc. (splinters ecosystem).

### 3. Adapter Naming

- Backends: `create<Name>Backend()` or `create<Name>Store()` (e.g., `createRedisBackend()`)
- Convenience wrappers: `<name>Store()` (e.g., `memoryStore()` — single policy, common case)
- Implementations live in `@ws-kit/adapters/<name>`

### 4. Testing Requirements

Every adapter must pass **the same contract test suite** under concurrency:

- Atomicity tests (no race conditions)
- Fairness tests (key isolation)
- Edge-case tests (cost > capacity, clock skew, etc.)

This ensures any adapter can be swapped in without behavior changes.

## Consequences

### Benefits

✅ **Portability**: Middleware works identically on Bun, Node.js, Cloudflare, edge runtimes
✅ **Zero coupling**: Middleware never knows which adapter is plugged in
✅ **Scalability**: Apps start with memory adapter, scale to Redis or DO without code changes
✅ **Testability**: Adapters tested in isolation; middleware tested with fake adapter
✅ **Reusability**: Same adapter interface used by rate limiting, deduplication, presence, etc.
✅ **Maintainability**: Centralized adapter implementations, no scattered logic

### Trade-offs

⚠️ **Indirection**: Apps must choose and configure the right adapter (vs. auto-detect)
⚠️ **Interface iteration**: Adding features to adapters requires new interface versions
⚠️ **Dependency overhead**: Even unused adapters are "exposed" in type imports (mitigated by `@ws-kit/adapters/*` subpath structure)
⚠️ **Coordination burden**: Shared backends (Redis, DO namespace) require careful prefix/shard management by apps

## Alternatives Considered

### 1. Runtime Auto-Detection

Detect runtime and automatically choose adapter:

```typescript
const store = await autoDetectRateLimitStore(); // Bun → memory, Node → Redis?
```

**Why rejected:**

- Implicit behavior is harder to debug
- Apps can't easily test with non-default adapters
- Clouds providers (Cloudflare) have no obvious "default"
- Encourages assumptions about runtime capabilities

### 2. Single Monolithic Package

Bundle all adapters in separate packages:

```typescript
import { memoryRateLimiter } from "@ws-kit/memory";
import { redisRateLimiter } from "@ws-kit/redis";
```

**Why rejected:**

- Pulls in all dependencies (Redis client, DO types) even if not used
- Harder to maintain as new adapters/runtimes emerge
- Doesn't scale to future features (deduplication, presence, etc.)
- Violates Unix philosophy (one package, one concern)

### 3. Inheritance-Based Adapters

Use class hierarchy:

```typescript
abstract class RateLimitStore { abstract consume(...) }
class MemoryRateLimitStore extends RateLimitStore { ... }
class RedisRateLimitStore extends RateLimitStore { ... }
```

**Why rejected:**

- Creates cognitive overhead (inheritance hierarchy to learn)
- Makes it harder to support multiple implementations (composition wins)
- TypeScript interface inheritance is sufficient and simpler

### 4. Adapter Factory with Magic

Auto-instantiate adapters based on environment variables:

```typescript
const store = createRateLimiter({
  backendUrl: process.env.REDIS_URL, // Auto-detects Redis
});
```

**Why rejected:**

- Same problems as runtime auto-detection
- Harder to test (can't easily swap backends)
- Magic is error-prone (typos in env vars, subtle failures)

## References

- **ADR-006**: Multi-Runtime `serve()` with Explicit Selection (explicit runtime choice)
- **ADR-008**: Middleware Support (middleware pattern that consumes adapters)
- **Proposal**: [Feature Proposal: Built-In Rate Limiting](../proposals/rate-limiting.md) (first use of adapter pattern)

## Future Applications

The adapter pattern is not limited to rate limiting. Same principle applies to:

- **Deduplication**: `DeduplicationStore` (memory, Redis, DO)
- **Presence**: `PresenceStore` (for tracking user activity across connections)
- **Sessions**: `SessionStore` (for connection recovery, state persistence)
- **Observability**: `MetricsExporter` (Prometheus, OTLP, CloudWatch)

Each feature defines a lean interface, implements adapters for common backends, and leaves app responsibility for choosing. This keeps ws-kit focused while enabling production patterns.
