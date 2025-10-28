# ws-kit Plan Updates: Feedback Incorporation Summary

## Overview

This document summarizes how critical feedback about router configuration and production-readiness was incorporated into `ws-kit-plan.md`.

---

## Changes Made

### 1. Router Configuration Structure (New Section: ~Line 776)

Added explicit `WebSocketRouterOptions<V>` type definition with clean, noun-based field names:

```typescript
type WebSocketRouterOptions<V> = {
  validator?: V; // Pluggable validator
  platform?: PlatformAdapter; // Pluggable platform
  pubsub?: PubSub; // Custom PubSub (optional)

  hooks?: {
    // Lifecycle callbacks
    onAuth?: (ctx) => boolean | Promise<boolean>;
    onClose?: (ctx, code, reason) => void;
    onError?: (err, ctx?) => void;
  };

  heartbeat?: {
    // Connection health
    intervalMs?: number; // Ping cadence
    timeoutMs?: number; // Pong timeout
  };

  limits?: {
    // Constraints
    maxPayloadBytes?: number;
  };
};
```

**Benefits**:

- Nouns instead of verbs (consistent with config convention)
- Organized nesting improves discoverability
- Clear type signatures for all options

### 2. Production-Grade Features in Phase 2

Updated Phase 2 implementation tasks to include:

- **Authentication hook (`onAuth`)**: Invoked on first message before handler dispatch
- **Heartbeat management**: Configurable ping intervals and pong timeouts with auto-close for stale connections
- **Message limits**: Payload size constraints enforced before deserialization
- **Lifecycle hooks (`onClose`, `onError`)**: For cleanup and error handling

Updated type testing requirements to cover hook types and config validation.

### 3. Explicit Deferred Items (New Section: ~Line 807)

Clearly listed features deferred to Phase 8+ (post-launch):

- **Codec abstraction** (`codec?: Codec`)
  - _Rationale_: No current demand; JSON sufficient for v1

- **Middleware chain** (`middleware?: Middleware[]`)
  - _Rationale_: Hooks are sufficient; add if demand emerges

- **Protocol versioning** (`protocol?: { version, strictUnknownTypes }`)
  - _Rationale_: No current versioning requirement

- **Backpressure policies** (`backpressure?: { policy }`)
  - _Rationale_: Platform-specific; Bun handles natively

**Philosophy**: Avoid premature abstraction; extend API cleanly in future phases if needed.

### 4. PubSub Composition Pattern (New Subsection: ~Line 1054)

Added explicit decision against string literals for PubSub:

```typescript
// ✅ Correct - explicit factories
const router = new WebSocketRouter({
  platform: createBunAdapter(),
  pubsub: createRedisPubSub({ host: "localhost" }),
});

// ❌ Wrong - magic strings couple core to implementations
const router = new WebSocketRouter({ pubsub: "redis" });
```

**Rationale**:

- Avoids coupling `@ws-kit/core` to all platform implementations
- Factory pattern is extensible without core changes
- Explicit dependencies clear in code
- Matches overall composition-over-inheritance philosophy

### 5. Core API Example Update (Line ~73)

Updated the core API example in `@ws-kit/core` to demonstrate all new options:

```typescript
const router = new WebSocketRouter({
  validator: createZodValidator(z),
  platform: createBunAdapter(),
  pubsub: createRedisPubSub(options), // Optional

  hooks: {
    onAuth: (ctx) => (ctx.ws.data?.token ? true : false),
    onClose: (ctx, code, reason) => {
      /* cleanup */
    },
    onError: (err, ctx) => {
      /* log */
    },
  },

  heartbeat: {
    intervalMs: 30000,
    timeoutMs: 5000,
  },

  limits: {
    maxPayloadBytes: 1_000_000,
  },
});
```

### 6. Success Criteria Addition (Line ~1446)

Added new "Production-Grade Features" section to success criteria:

- ✅ Authentication lifecycle with `onAuth` hook
- ✅ Connection heartbeat with configurable ping/pong
- ✅ Message limits with payload size constraints
- ✅ Lifecycle hooks for cleanup and error handling
- ✅ Type-safe hook definitions

---

## What Was Rejected (And Why)

### String Literals for PubSub Configuration

**Feedback suggested**: `pubsub: 'memory' | 'bun' | 'do' | 'auto'`

**Decision**: Keep explicit factory pattern

**Reasoning**:

1. **Coupling**: Magic strings force core to know about all implementations
2. **Extensibility**: New PubSub implementations require core changes with string approach
3. **Clarity**: Explicit factories (e.g., `createRedisPubSub(options)`) make dependencies clear
4. **Consistency**: Matches validator/platform adapter pattern already in design
5. **Composability**: Factories allow custom implementations without magic string conflicts

### Codec Abstraction

**Feedback suggested**: `codec?: Codec` with options for JSON, msgpack, proto3

**Decision**: Defer to Phase 8+

**Reasoning**:

1. **No current demand**: No users asking for binary message formats yet
2. **Complexity**: Generic codec system adds abstraction overhead
3. **JSON sufficient**: Perfect for text-based messages in v1
4. **Future-proof**: Can add as extension without breaking existing API
5. **Keep focused**: Ship v1 focused on core, validator, platform adapters

### Middleware Chain

**Feedback suggested**: `middleware?: Middleware[]` with ordered chain

**Decision**: Use hooks instead; consider middleware in Phase 8+ if demand emerges

**Reasoning**:

1. **Simpler for v1**: Hooks are sufficient for auth, logging, cleanup
2. **Fewer moving parts**: No `next()` continuation complexity
3. **Type safety**: Hooks have clear, specific signatures
4. **Demand-driven**: Add middleware if users demonstrate need for ordered chain
5. **Avoid feature creep**: Hooks cover 80% of use cases

---

## Key Design Decisions Reinforced

### 1. Composition Over Inheritance

All options use composition (passing adapters) rather than inheritance (subclassing):

- Single `WebSocketRouter<V>` class
- Validators/platforms plugged in at instantiation
- No `ZodRouter`, `BunRouter`, etc.

### 2. Explicit Over Implicit

Configuration uses explicit factories and adapters rather than magic strings:

- `createZodValidator(z)` vs. `{ validator: 'zod' }`
- `createBunAdapter()` vs. `{ platform: 'bun' }`
- `createRedisPubSub()` vs. `{ pubsub: 'redis' }`

### 3. Noun-Based Configuration

Config options use noun form (not verb):

- `validator`, `platform`, `pubsub` (not `validate`, `providePlatform`)
- `hooks`, `heartbeat`, `limits` (organized noun groups)

### 4. Defer Premature Abstraction

Only include in v1 what's truly needed:

- Codec, middleware, protocol versioning deferred
- Can extend API cleanly later
- Keeps codebase focused and maintainable

---

## Testing Implications

### New Type Tests Required

```typescript
// hooks.test.ts
- Assert onAuth returns boolean | Promise<boolean>
- Assert onClose receives (ctx, code, reason?)
- Assert onError receives (err, ctx?)

// config.test.ts
- Assert WebSocketRouterOptions structure
- Assert heartbeat defaults (30s, 5s)
- Assert limits defaults (1MB)

// composition.test.ts
- Assert factory patterns for adapters
- Assert PubSub composition works
- Assert no string literals for PubSub
```

### Runtime Tests

- Heartbeat: Verify ping sent at intervals, close on timeout
- Auth: Verify `onAuth` called before handler, reject if returns false
- Limits: Verify oversized messages rejected
- Hooks: Verify `onClose` and `onError` invoked appropriately

---

## Impact on Phases

### Phase 2 (Expanded)

Now includes heartbeat, hooks, limits alongside core router

### Phase 8+ (New Scope)

- Codec system for generic serialization
- Middleware chain if demand emerges
- Protocol versioning for multi-version support
- Backpressure policy customization

---

## Backward Compatibility

Plan maintains **zero breaking changes** for existing `bun-ws-router` users:

- Migration guide provided
- Facade package option available for 1-2 versions
- New features are additive (all optional)

---

## Summary

The plan now incorporates production-grade features (auth, heartbeat, limits, error handling) while explicitly deferring nice-to-have abstractions (codec, middleware, protocol versioning). The design remains focused on **composition over inheritance**, **explicit over implicit**, and **shipping v1 focused and tight**.

All changes maintain the core philosophy: **one router class, N validator adapters, M platform adapters = N×M combinations without explosion**.
