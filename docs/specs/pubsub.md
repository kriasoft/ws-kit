# Pub/Sub API — Topic Subscriptions & Broadcasting

**File:** `docs/specs/pubsub.md`
**Status:** Final
**Applies to:** `@ws-kit/core` + adapters (Bun, Node/uWS, Cloudflare, etc.)

> **Design Rationale**: See [ADR-022](../adr/022-namespace-first-pubsub-api.md) for the full design decision, alternatives considered, and trade-offs.

---

## 0. Prior Design Issues

An earlier draft had namespace confusion, ambiguous return types, no batch operations, zero type safety, and unclear authorization semantics. See [ADR-022 Context](../adr/022-namespace-first-pubsub-api.md#context) for the full analysis and design rationale.

---

## 1. Overview

This spec defines a **minimal, portable, and hard-to-misuse topic-based pub/sub system** for WS-Kit.

- Subscriptions are **per-connection** via `ctx.topics` and **process-wide** via `router.publish()`.
- On Bun (v1.3.2+), subscriptions leverage native WebSocket pub/sub (`ws.subscribe`, `server.publish`).
- On other adapters, behavior is **emulated** with identical semantics unless explicitly stated.

### Design Philosophy

- **Namespace for clarity:** `ctx.topics` isolates subscription ops from the broader context.
- **JS-native state:** Subscriptions are a `ReadonlySet<string>` — no custom wrapper needed.
- **Throw on error, void on success:** Idempotent operations return `Promise<void>`; only errors throw.
- **Batch operations first-class:** Atomic `subscribeMany()` and `unsubscribeMany()` for efficiency.
- **Publishing is flat:** `ctx.publish()` stays at top-level (asymmetry is intentional).
- **Optional type safety:** Typed topic helpers for progressive validation without ceremony.

### Goals

- Minimal, conventional surface with clear semantics.
- Idempotent operations (subscribe twice = no-op, no error).
- Portable across adapters with identical behavior.
- Progressive type safety: simple apps use strings, complex apps use optional typed helpers.
- Authorizable at topic/context level with hooks.

### Non-Goals

- Wildcard topics / pattern matching (future extension).
- Guaranteed delivery or ordering across topics (at-most-once, best-effort).
- Multi-process global fan-out (covered by separate adapters like Redis pub/sub).
- Complex middleware chains (lightweight hooks only).

---

## 2. Terminology

- **Topic** — Opaque string key, case-sensitive, normalized per app policy. Example: `"room:123"`, `"system:announcements"`.
- **Subscription** — A connection's membership in a topic; persists for connection lifetime or until explicitly removed.
- **Payload** — Data published to a topic: `string | ArrayBuffer | ArrayBufferView`. JSON is app-level.
- **Broadcast** — Publishing a message to all subscribers of a topic.

---

## 3. Public API Surface

### 3.1 Per-Connection Subscriptions (`ctx.topics`)

```typescript
/**
 * Subscription state and operations.
 * Implements ReadonlySet<string> for .has(topic), .size, iteration.
 */
interface Topics extends ReadonlySet<string> {
  /**
   * Subscribe to a topic.
   * Idempotent: subscribing twice to the same topic is a no-op (no error).
   * Throws on validation, authorization, or connection failure.
   */
  subscribe(topic: string): Promise<void>;

  /**
   * Unsubscribe from a topic.
   * Idempotent: unsubscribing twice or from non-existent topic is a no-op.
   * Throws only on authorization or adapter failure (rare).
   */
  unsubscribe(topic: string): Promise<void>;

  /**
   * Subscribe to multiple topics in one atomic operation.
   * All succeed or all fail; no partial state changes.
   * Returns count of newly added subscriptions and total subscriptions.
   */
  subscribeMany(
    topics: Iterable<string>,
  ): Promise<{ added: number; total: number }>;

  /**
   * Unsubscribe from multiple topics atomically.
   * Returns count of removed and remaining subscriptions.
   */
  unsubscribeMany(
    topics: Iterable<string>,
  ): Promise<{ removed: number; total: number }>;

  /**
   * Remove all current subscriptions.
   * Returns count of removed subscriptions.
   */
  clear(): Promise<{ removed: number }>;

  /**
   * Atomically replace current subscriptions with a desired set.
   *
   * Idempotent: if input set equals current set, returns early (no adapter calls).
   * Soft unsubscribe semantics: topics not currently subscribed are skipped.
   * Returns counts of topics added, removed, and total subscriptions after operation.
   */
  replace(
    topics: Iterable<string>,
    options?: { signal?: AbortSignal },
  ): Promise<{ added: number; removed: number; total: number }>;
}

// Augmentation
declare module "@ws-kit/core" {
  interface Context {
    /**
     * Subscription state and operations.
     * Also a ReadonlySet<string>, so supports: .has(topic), .size, for...of, spread, etc.
     */
    topics: Topics;

    /**
     * Publish a typed message to a topic (broadcast to all subscribers).
     * Fails fast if connection is closed or authorization denied.
     */
    publish<T>(
      topic: string,
      schema: Schema<T>,
      payload: T,
      options?: PublishOptions,
    ): Promise<PublishResult>;
  }
}
```

### 3.2 Router-Level Publishing (`router.publish`)

```typescript
interface Router {
  /**
   * Publish a typed message to a topic (process-wide).
   * Returns result indicating delivery capability and subscriber count (if known).
   */
  publish<T>(
    topic: string,
    schema: Schema<T>,
    payload: T,
    options?: PublishOptions,
  ): Promise<PublishResult>;
}

// Augmentation
declare module "@ws-kit/core" {
  interface Router {
    publish<T>(
      topic: string,
      schema: Schema<T>,
      payload: T,
      options?: PublishOptions,
    ): Promise<PublishResult>;
  }
}
```

### 3.3 Publish Options & Result

```typescript
interface PublishOptions {
  /**
   * Optional sharding or routing hint (advisory; adapters may ignore).
   * Useful for Redis Cluster, DynamoDB Streams, etc.
   */
  partitionKey?: string;

  /**
   * Optional metadata passed through to subscribers (if adapter supports it).
   * Default empty; not validated by core.
   */
  meta?: Record<string, unknown>;

  /**
   * Future feature: exclude the sender from receiving the published message.
   * Currently returns {ok: false, error: "UNSUPPORTED"}.
   */
  excludeSelf?: boolean;
}

export type PublishCapability = "exact" | "estimate" | "unknown";

export type PublishError =
  | "VALIDATION" // schema validation failed (local)
  | "ACL" // authorizePublish hook denied
  | "STATE" // cannot publish in current state
  | "BACKPRESSURE" // adapter send queue full
  | "PAYLOAD_TOO_LARGE" // payload exceeds adapter limit
  | "UNSUPPORTED" // feature/option not supported
  | "ADAPTER_ERROR" // unexpected adapter failure
  | "CONNECTION_CLOSED"; // connection/router disposed

export type PublishResult =
  | {
      ok: true;
      /** "exact": exact count | "estimate": lower-bound | "unknown": field omitted */
      capability: PublishCapability;
      /** Matched subscriber count. Semantics depend on capability. undefined if "unknown". */
      matched?: number;
    }
  | {
      ok: false;
      /** Canonical error code (UPPERCASE) for pattern matching and exhaustive switches. */
      error: PublishError;
      /**
       * Indicates whether the operation is safe to retry.
       * False: VALIDATION, ACL, PAYLOAD_TOO_LARGE, UNSUPPORTED, STATE (don't retry).
       * True: BACKPRESSURE, CONNECTION_CLOSED, ADAPTER_ERROR (may be transient; retry with backoff).
       */
      retryable: boolean;
      /** Name of the adapter that rejected (e.g., "redis", "inmemory"). */
      adapter?: string;
      /**
       * Structured context about the failure.
       * Examples: { feature: "excludeSelf", limit: 1048576, transient: true }
       */
      details?: Record<string, unknown>;
      /** Underlying error cause, following Error.cause conventions. */
      cause?: unknown;
    };
```

**Key Invariant:** `publish()` **never throws** for runtime conditions. All expected failures return `{ok: false}` with an error code and a `retryable` hint. This enables predictable, result-based error handling and actionable remediation logic.

---

## 4. Typed Topic Helper (Optional Convenience)

For applications that want schema validation and auto-completion on topic construction, the `topic()` helper is **recommended** but not required by the spec. Simple applications using string literals (e.g., `"room:123"`) are fully compliant.

**Topic helper interface** (provided by validator adapters like `@ws-kit/zod`):

```typescript
/**
 * A type-safe topic definition.
 * Topics are just strings at runtime, but schema provides compile-time safety.
 */
type Topic<T> = {
  readonly name: string; // e.g., "room"
  make(args: T): string; // Construct topic string (validates args)
  parse?(topic: string): T; // Optional: extract args from string
};

/**
 * Define a typed topic with automatic string formatting.
 *
 * @param name — Descriptive prefix (e.g., "room", "user:notification")
 * @param schema — Zod/Valibot schema for parameter validation
 * @param format — Function to format args into topic string
 */
function topic<T>(
  name: string,
  schema: Schema<T>,
  format: (args: T) => string,
): Topic<T>;

// Example
const RoomTopic = topic(
  "room",
  z.object({ roomId: z.string().uuid() }),
  ({ roomId }) => `room:${roomId}`,
);

// Usage in handlers
router.on(JoinRoom, async (ctx, { roomId }) => {
  const topicStr = RoomTopic.make({ roomId }); // Type-checked, validates at call-time
  await ctx.topics.subscribe(topicStr);

  const joined = ctx.topics.has(topicStr);
  if (joined) {
    await ctx.publish(topicStr, UserJoined, { userId: ctx.user.id });
  }
});
```

**Why optional?**

- Typed topics compile to strings; zero overhead if not used.
- Simple apps stay simple: just use `"room:123"` (compliant with spec).
- Complex apps get validation, type inference, and compile-time safety.
- Progressive enhancement—no mandatory ceremony.

**Implementation note**: The `topic()` helper is provided by validator adapter packages (e.g., `@ws-kit/zod`, `@ws-kit/valibot`) as a convenience, not a core specification requirement.

---

## 5. Configuration & Middleware

### 5.0 Configuration vs. Middleware (Clarification)

Topic validation is configured at **two levels**:

1. **Router limits (PRIMARY)** — `WebSocketRouterOptions.limits` sets format, max length, per-connection quota
2. **Middleware hooks (OPTIONAL)** — `usePubSub()` adds custom authorization, normalization, lifecycle tracking

**Precedence**: Router limits always run first; middleware runs second and cannot override built-in constraints.

---

For applications that need custom authorization or lifecycle tracking, use lightweight middleware hooks:

```typescript
interface UsePubSubOptions {
  /**
   * Normalize a topic string (e.g., lowercasing, trimming, namespace checks).
   * Runs BEFORE router.limits validation. Apps should normalize consistently with
   * their topicPattern config.
   * Default: identity (no change).
   */
  normalize?: (topic: string) => string;

  /**
   * Custom validation for business logic (runs AFTER router.limits format/length checks).
   * Example: enforce "room names must be 3+ chars". Should throw or return error code.
   * @deprecated Use router.limits.topicPattern for format validation instead.
   */
  validate?: (topic: string) => true | PubSubErrorCode;

  /**
   * Authorize subscription to a topic.
   * Called per subscribe() call; denies by returning false or throwing.
   * Default: allow all.
   */
  authorizeSubscribe?: (
    ctx: Context,
    topic: string,
  ) => boolean | Promise<boolean>;

  /**
   * Authorize publishing to a topic.
   * Called per publish() call.
   * Default: allow all.
   */
  authorizePublish?: (
    ctx: Context,
    topic: string,
  ) => boolean | Promise<boolean>;

  /**
   * Lifecycle hook: called after successful subscription.
   * Useful for logging, analytics, or per-topic state.
   */
  onSubscribe?: (ctx: Context, topic: string) => void | Promise<void>;

  /**
   * Lifecycle hook: called after unsubscription.
   */
  onUnsubscribe?: (ctx: Context, topic: string) => void | Promise<void>;

  /**
   * Optional: method for apps to invalidate cached ACL decisions on role change.
   * Example: user granted new permission mid-session.
   */
  invalidateAuth?: (ctx: Context) => void;
}

export function usePubSub(options?: UsePubSubOptions): Middleware;
```

**Example: Custom Authorization & Validation**

```typescript
const router = new WebSocketRouter({
  limits: {
    topicPattern: /^[a-z0-9:_\-/.]+$/i,
    maxTopicLength: 128,
  },
});

router.use(
  usePubSub({
    authorizeSubscribe: (ctx, topic) => ctx.user?.canAccessTopic(topic),
    validate: (topic) => {
      if (topic.startsWith("room:") && topic.length < 8) {
        return "INVALID_TOPIC";
      }
      return true;
    },
    onSubscribe: (ctx, topic) => {
      logger.info(`User ${ctx.user?.id} subscribed to ${topic}`);
    },
  }),
);
```

### 5.1 Topic Policy (Normative)

Configure validation via `WebSocketRouterOptions.limits`:

```typescript
const router = new WebSocketRouter({
  limits: {
    topicPattern: /^[a-z0-9:_\-/.]+$/i, // RegExp (default: alphanumeric, :_-/.)
    maxTopicLength: 128, // number (default: 128)
    maxTopicsPerConnection: 1000, // number (default: Infinity)
  },
});
```

**Validation Order (Normative):**

1. **Normalize** — Apply `normalize(topic)` if provided (e.g., trim, lowercase).
2. **Validate** — Check normalized topic:
   - Length check: Throw `PubSubError("INVALID_TOPIC", …, { reason: "length", length, max })`
   - Pattern check: Throw `PubSubError("INVALID_TOPIC", …, { reason: "pattern", topic })`
3. **Authorize** — Call `authorizeSubscribe(ctx, topic)` hook.
4. **Limit check** — Verify `subscriptions.size < maxTopicsPerConnection`.
5. **Mutate** — Add/remove topic from set.
6. **Lifecycle** — Call `onSubscribe()` / `onUnsubscribe()` hook.

**Error Details Contract:**

Validation errors MUST include `details.reason` for machine-readable error classification:

- `reason: "length"` — Topic exceeds `maxTopicLength`. Includes `{ length, max }`.
- `reason: "pattern"` — Topic doesn't match pattern. Includes `{ topic }`.

This enables:

- **Metrics/logging**: Bucket failures by `reason` for observability
- **Conditional handling**: Check reason field to determine app response (example below)

**Example:**

```typescript
const router = new WebSocketRouter({
  limits: {
    topicPattern: /^[a-z0-9:_\-]{1,128}$/i, // Alphanumeric, colon, underscore, hyphen
    maxTopicLength: 128,
    maxTopicsPerConnection: 500,
  },
});

// In a handler
try {
  await ctx.topics.subscribe("user:notifications:" + userId);
} catch (err) {
  if (err instanceof PubSubError) {
    const details = err.details as any;
    if (details.reason === "length") {
      ctx.error("E_TOPIC_TOO_LONG", `Max length is ${details.max}`);
    } else if (details.reason === "pattern") {
      ctx.error("E_INVALID_TOPIC", "Topic contains invalid characters");
    }
  }
}
```

### 5.2 Authorization Hooks

For centralized authorization and lifecycle tracking:

**Example:**

```typescript
router.use(
  usePubSub({
    normalize: (t) => t.toLowerCase(),
    validate: (t) => /^[a-z0-9:_/-]{1,128}$/.test(t) || "INVALID_TOPIC",
    authorizeSubscribe: (ctx, topic) => {
      // Users can only subscribe to their own notifications
      if (topic.startsWith("user:notifications:")) {
        const userId = topic.split(":").pop();
        return ctx.user?.id === userId;
      }
      // Public rooms anyone can join
      return topic.startsWith("room:");
    },
    onSubscribe: (ctx, topic) => {
      console.log(`User ${ctx.user?.id} joined ${topic}`);
    },
  }),
);
```

---

## 6. Semantics

### 6.1 Order of Checks (Normative)

Every subscription operation (single and batch) follows this strict invariant—adapter-first ordering:

1. **Normalize** — Apply `normalize(topic)` if provided. Result is normalized topic.
2. **Validate** — Check normalized topic against `validate()` or default pattern. Throws if invalid.
3. **Authorize** — Call `authorizeSubscribe(ctx, normalized)` hook (if provided). Throws if denied.
4. **Idempotency check** — Inspect current state before any side-effects. If already subscribed/unsubscribed, return early (no hooks, no mutation, no adapter call).
5. **Adapter call** — Delegate to platform adapter (`ws.subscribe()` / `ws.unsubscribe()`). If adapter throws, local state remains unchanged.
6. **Mutate** — Add/remove topic from connection's topic set (only after adapter succeeds).
7. **Lifecycle** — Call `onSubscribe(ctx, normalized)` or `onUnsubscribe(ctx, normalized)` hook (best-effort; hook failure does not rollback state).

**Key invariants:**

- Authorization always operates on the **normalized topic**, not the input. Prevents TOCTOU bugs.
- Hooks receive the **normalized topic**, not the raw input.
- If idempotency returns early (step 4), no side-effects occur (no adapter call, no mutation, no hooks).
- **Adapter-first**: Side-effects (adapter calls) happen before local state mutation. Eliminates ghost state and rollback complexity.
- On adapter failure, local state remains unchanged; no rollback is needed.
- If a hook throws (step 7), state is already mutated (no automatic rollback). Apps requiring transactional semantics should implement try/catch at the handler level.

**For batch operations:** Apply this order per topic in the batch. If any topic fails at any step (validation, authorization, adapter), the entire batch fails atomically—no topics are mutated and no adapter calls for any topic succeed.

### 6.2 Idempotency

Subscription ops are **idempotent**: calling twice is safe, returns success both times.

**Behavior:**

- `subscribe(topic)` when already subscribed → Returns `void` without error. No state change, no hook calls.
- `unsubscribe(topic)` when not subscribed → Returns `void` **without validation** (soft no-op). No state change, no hooks, no errors—even if topic format is invalid. Enables safe cleanup in error paths.
- Errors (invalid format, unauthorized) **still throw** on every call, **except** `unsubscribe()` skips validation if not subscribed. Only successful state mutations skip repeated effects.

**Rationale:** Idempotency means apps don't need defensive checks. Safe to call `subscribe()` or `unsubscribe()` unconditionally. This matters for:

- Reconnection logic: re-subscribe to desired topics without checking current state.
- Race conditions: multiple handlers subscribing to same topic don't conflict.
- Defensive cleanup: `unsubscribe()` in error paths or finally blocks works without pre-checks, even with unvalidated topic strings (soft no-op if not subscribed).
- No defensive guards: no need to check `if (!has(topic))` before unsubscribing.

**Hook behavior:** `onSubscribe()` and `onUnsubscribe()` hooks are **not called** on idempotent no-ops. Only called on actual state changes.

**Hook exception semantics:** If a hook throws, the exception propagates to the caller (middleware/handler), **but state remains changed**—there is no automatic rollback. Adapters may catch and log hook exceptions, but mutation is not reversed. Applications that require rollback on hook failure should implement custom try/catch logic at the handler level or in middleware before calling subscribe/unsubscribe.

### 6.3 Batch Atomicity

`subscribeMany()` and `unsubscribeMany()` are **atomic**: all-or-nothing, no partial success.

**Behavior:**

- `subscribeMany`: If validation fails on topic N, all N topics fail; none are subscribed. If authorization fails, same: all fail.
- `unsubscribeMany`: Soft no-op semantics—topics **not currently subscribed are skipped** (no validation, no error). Only subscribed topics are validated, mutated, and sent to adapter. If validation fails on any subscribed topic, entire operation fails and rolls back.
- Exception: duplicate topics in the same call are coalesced before atomicity check (not an error).

**Return values:**

- `subscribeMany`: `{ added: number, total: number }` — `added` = count of newly subscribed (not already subscribed), `total` = current total subscriptions after operation.
- `unsubscribeMany`: `{ removed: number, total: number }` — `removed` = count of topics that were subscribed and now removed, `total` = remaining subscriptions.

**Rationale:** Atomic prevents inconsistent state when batching operations. Apps can rely on: "after this call, either all topics are subscribed or none are, and state is consistent."

**Atomicity via rollback:**

To achieve atomicity for batch operations:

1. **Validation phase** happens first (before any adapter calls). If any topic fails validation, the entire batch fails immediately—no adapter calls are made.
2. **Adapter phase** processes all topics sequentially, tracking successful calls.
3. **On adapter failure**: If any adapter call fails (e.g., `ws.subscribe("room:2")` throws after `ws.subscribe("room:1")` succeeded):
   - All successfully-subscribed topics are immediately unsubscribed (rollback)
   - Local state remains unchanged
   - The operation throws `PubSubError<"ADAPTER_ERROR">`
4. **On full success**: All adapter calls complete, then local state is mutated atomically.

This ensures the invariant: either all topics are added/removed or none are. No partial state on error.

**Rollback failure handling:**

If rollback itself fails (e.g., `ws.unsubscribe("room:1")` fails during rollback), the primary error is still thrown, but the adapter is in an inconsistent state (some topics may remain subscribed in the adapter but not in local state).

**Telemetry for divergent state:**

When rollback fails, the thrown `PubSubError` includes metadata in `error.details`:

- `rollbackFailed: boolean` — True if any rollback attempt failed
- `failedRollbackTopics: string[]` — Topics whose rollback failed (exact topics depend on operation)
- `cause: unknown` — The original adapter error that triggered the rollback

Apps should monitor for `rollbackFailed: true` to detect inconsistent adapter/local state and trigger remediation (e.g., reconnect, reset state).

```typescript
try {
  await ctx.topics.subscribeMany([...]);
} catch (err) {
  if (err instanceof PubSubError && (err.details as any)?.rollbackFailed) {
    // Adapter and local state are divergent!
    // Trigger monitoring alert and request user reconnection
    logger.error("Rollback failed; adapter state may be inconsistent", err.details);
  }
}
```

### 6.4 Replace Semantics

`replace(topics)` atomically replaces current subscriptions with a desired set. Useful for reconnection: avoids manual diffing and ensures single atomic operation.

**Order of checks (normative):**

1. **Normalize & validate** all desired topics
2. **Authorize** desired topics (those being added)
3. **Compute delta** and **idempotency check**: If no changes, return early (no adapter calls)
4. **Limit check**: Verify `currentSize - removed + added <= maxTopicsPerConnection`
5. **Adapter phase** (critical ordering):
   - **Unsubscribe first** from topics being removed (frees space at adapter)
   - **Subscribe second** to new topics (uses freed space)
   - **On failure, rollback in reverse order**: Unsubscribe newly-added topics first (free space), then re-subscribe removed topics. This mirrors forward ordering and respects `maxTopicsPerConnection` during rollback.
6. **Mutate state** and return `{ added, removed, total }`

**Key invariants:**

- **Atomic**: All changes apply or none apply. No partial state.
- **Idempotent**: No adapter calls when desired set equals current set.
- **Validation first**: All topics validated before any adapter calls. Invalid or unauthorized topics cause entire operation to fail.
- **Adapter limit respect**: Unsubscribe before subscribe ensures adapter never sees a transient count above `maxTopicsPerConnection`. This enables users to "swap" topics when at the limit (e.g., leave one room to join another with the same quota).

**Why unsubscribe first?**

If `currentSize == maxTopicsPerConnection` and user wants to replace one topic with another:

- Current: `["room:1", "room:2", "room:3"]` (limit=3)
- Desired: `["room:1", "room:2", "room:4"]` (swapping room:3 for room:4)
- Limit check: `3 - 1 + 1 = 3` ✓

If we subscribed first:

- Call `subscribe("room:4")` → adapter sees 4 topics (exceeds limit!) → throws ❌

If we unsubscribe first:

- Call `unsubscribe("room:3")` → adapter now has 2 topics
- Call `subscribe("room:4")` → adapter now has 3 topics ✓

**Rollback order (reverse):**

If `subscribe("room:4")` fails after `unsubscribe("room:3")` succeeded:

- ❌ Wrong: Re-subscribe "room:3" first → adapter is at limit with room:1+room:2, can't add room:3 back → rollback fails and adapter is left inconsistent
- ✓ Correct: Unsubscribe "room:4" first (frees space) → adapter at 2 topics → then re-subscribe "room:3" → adapter back to 3 topics (original state preserved)

**Error semantics:**

Throws `PubSubError` with same codes as `subscribe()`/`unsubscribe()`. State unchanged on error.

**Example:**

```typescript
// Reconnection: atomically sync to desired state
const result = await ctx.topics.replace(["room:123", "system:announcements"]);
// { added: number, removed: number, total: number }
```

### 6.5 Publishing Semantics

**Key Invariant:** `publish()` **never throws** for runtime conditions. All expected failures return `{ok: false}` with an error code and a `retryable` hint, enabling predictable result-based error handling.

**Error Semantics: Mutations Throw, Actions Return**

This is the fundamental split between operations:

- **`subscribe()` / `unsubscribe()`** = state mutations → **throw `PubSubError`** on failure (validation, ACL, CONNECTION_CLOSED, etc.)
  - These change connection state; errors are exceptional and require immediate signal
  - Apps use `try/catch` to handle subscription failures

- **`publish()`** = transient action → **return `{ok:false}`** on failure (validation, ACL, CONNECTION_CLOSED, etc.)
  - These broadcast messages; failures are expected and recoverable
  - Apps inspect result and decide on remediation (retry, fallback, log, etc.)

**Example:** If connection drops and app calls `publish()` → returns `{ok: false, error: "CONNECTION_CLOSED", retryable: true}`. No throw. The app can decide whether to queue, retry, or log without exception handling. Contrast: calling `subscribe()` on closed connection → throws, forcing explicit error handling.

**Validation & Authorization:**

- **Payload validation:** Validated against schema; validation error returns `{ok: false, error: "VALIDATION", retryable: false}`.
- **Authorization:** `authorizePublish()` checked; denial returns `{ok: false, error: "ACL", retryable: false}`.

**Delivery & Ordering:**

- **Delivery:** Best-effort, at-most-once per subscriber. No delivery guarantee across topics.
- **Ordering:** Within a single topic, per-connection FIFO; unordered across topics.
- **Backpressure:** If adapter send queue is full, returns `{ok: false, error: "BACKPRESSURE", retryable: true}`.

**Capability Semantics:**

| Capability   | `matched` Meaning                            | Adapters                   | Use Case                                         |
| ------------ | -------------------------------------------- | -------------------------- | ------------------------------------------------ |
| `"exact"`    | Exact subscriber count                       | Bun native, MemoryPubSub   | In-process testing, single-server deployments    |
| `"estimate"` | Lower-bound estimate                         | Node/uWS polyfill          | Conservative estimate; actual may be higher      |
| `"unknown"`  | Subscriber count not tracked (field omitted) | Redis multi-process, Kafka | Distributed systems where tracking is infeasible |

**Best practice for capability-aware handling:**

```typescript
const result = await ctx.publish(topic, schema, payload);

if (result.ok) {
  // Publication succeeded
  if (result.capability === "exact") {
    // Reliable exact count (in-process or single-node)
    console.log(`Delivered to exactly ${result.matched} subscribers`);
  } else if (result.capability === "estimate") {
    // Lower-bound estimate (polyfill or distributed)
    console.log(`Delivered to ≥${result.matched} subscribers`);
  } else {
    // Unknown count (distributed, no tracking)
    console.log(`Delivered (subscriber count unknown)`);
  }
} else if (result.retryable) {
  // Transient failure, safe to retry with backoff
  scheduleRetry(topic, payload);
} else {
  // Permanent failure, don't retry
  logger.error(`Publish failed: ${result.error}`, result.details);
}
```

**Error Remediation Guide:**

| Error               | Retryable | Typical Cause                             | Remediation                                     |
| ------------------- | --------- | ----------------------------------------- | ----------------------------------------------- |
| `VALIDATION`        | ✗         | Payload doesn't match schema              | Fix payload; inspect `cause` field              |
| `ACL`               | ✗         | Authorization hook denied                 | Don't retry; permission denied                  |
| `STATE`             | ✗         | Router/adapter not ready (or closed)      | Await router ready; don't retry                 |
| `BACKPRESSURE`      | ✓         | Adapter send queue full                   | Retry with exponential backoff + jitter         |
| `PAYLOAD_TOO_LARGE` | ✗         | Payload exceeds adapter limit             | Reduce payload size; split into messages        |
| `UNSUPPORTED`       | ✗         | Feature not available (e.g., excludeSelf) | Use fallback strategy; check `adapter` field    |
| `ADAPTER_ERROR`     | ✓         | Unexpected adapter failure                | Retry with backoff; inspect `details.transient` |
| `CONNECTION_CLOSED` | ✓         | Connection/router disposed                | Retry after reconnection                        |

**Failure Examples:**

```typescript
const result = await ctx.publish(topic, Schema, payload, options);

if (result.ok) {
  logger.info(`published to ${result.matched ?? "?"} subscribers`);
} else if (result.retryable) {
  // Schedule retry with exponential backoff
  scheduleRetry(topic, payload, { backoff: exponentialBackoff() });
} else {
  // Fail-fast: don't retry
  logger.error(`publish failed: ${result.error}`, result.details);
}

// Example failures:

// validation failure
const r1 = await ctx.publish("topic", Schema, invalidData);
// {ok: false, error: "VALIDATION", retryable: false, cause: Error(...)}

// authorization (acl) failure
const r2 = await ctx.publish("admin:topic", Schema, data);
// {ok: false, error: "ACL", retryable: false, adapter: "inmemory"}

// state failure (connection closed)
const r3 = await closedCtx.publish("topic", Schema, data);
// {ok: false, error: "CONNECTION_CLOSED", retryable: true, adapter: "inmemory"}

// backpressure failure (queue full)
const r4 = await ctx.publish("topic", Schema, data);
// {ok: false, error: "BACKPRESSURE", retryable: true, adapter: "bun"}

// payload_too_large failure
const r5 = await ctx.publish("topic", Schema, hugePayload);
// {ok: false, error: "PAYLOAD_TOO_LARGE", retryable: false, details: { limit: 1048576 }}

// unsupported failure (excludeSelf not yet implemented)
const r6 = await ctx.publish("topic", Schema, data, { excludeSelf: true });
// {ok: false, error: "UNSUPPORTED", retryable: false, adapter: "inmemory", details: { feature: "excludeSelf" }}

// adapter_error failure (unexpected)
const r7 = await ctx.publish("topic", Schema, data);
// {ok: false, error: "ADAPTER_ERROR", retryable: true, adapter: "redis", cause: Error(...), details: { transient: true }}
```

### 6.5 Connection Lifecycle & Cleanup

- On connection close, all subscriptions are **automatically removed** by the adapter.
- No subscriptions leak or persist.
- `onUnsubscribe()` hook is **not** called on connection close (only on explicit `unsubscribe()`).
- Apps may proactively `ctx.topics.clear()` before closing if needed for cleanup.

---

## 7. Errors

Two error models for two different operation types:

- **Subscription Operations (throw):** `subscribe()`, `unsubscribe()`, `subscribeMany()`, `unsubscribeMany()` throw `PubSubError` on failure (validation, authorization, connection errors).
- **Publish Operations (return):** `publish()` returns `PublishResult` with `error: PublishError` and `retryable: boolean` hint. Never throws for runtime conditions.

### Subscription Error Codes (`PubSubError`)

```typescript
type PubSubErrorCode =
  | "UNAUTHORIZED_SUBSCRIBE" // Denied by authorizeSubscribe() hook
  | "UNAUTHORIZED_PUBLISH" // Denied by authorizePublish() hook
  | "INVALID_TOPIC" // Failed validation or pattern check
  | "TOPIC_LIMIT_EXCEEDED" // Connection hit maxTopicsPerConnection quota
  | "CONNECTION_CLOSED" // Connection closed; cannot subscribe/publish
  | "BACKPRESSURE" // (publish only) Adapter send queue full
  | "PAYLOAD_TOO_LARGE" // (publish only) Payload exceeds adapter limit
  | "ADAPTER_ERROR"; // Catch-all for adapter-specific errors

class PubSubError extends Error {
  readonly code: PubSubErrorCode;
  readonly details?: unknown; // Adapter-specific context (e.g., adapter error wrapped)

  constructor(code: PubSubErrorCode, message?: string, details?: unknown);
}
```

**Error handling example:**

```typescript
try {
  await ctx.topics.subscribe(`room:${roomId}`);
} catch (err) {
  if (err instanceof PubSubError) {
    switch (err.code) {
      case "UNAUTHORIZED_SUBSCRIBE":
        ctx.error("E_ACL", "You cannot access this room");
        break;
      case "INVALID_TOPIC":
        ctx.error("E_INVALID", "Invalid room ID format");
        break;
      default:
        ctx.error("E_UNKNOWN", err.message);
    }
  }
}
```

---

## 8. Edge Cases (Normative)

1. **Duplicate subscribe** → Returns `void` (idempotent, not an error).
2. **Duplicate unsubscribe** → Returns `void` (idempotent, not an error).
3. **Unsubscribe from non-existent topic** → Returns `void` (idempotent).
4. **Subscribe, immediately unsubscribe** → Both succeed atomically in order; final state is unsubscribed.
5. **Authorization changes mid-session** → Future operations re-checked with new permissions. Server MAY proactively call `onUnsubscribe()` hook and remove connections from unauthorized topics.
6. **Publish to topic with zero subscribers** → Allowed; `publish()` returns `ok: true` with matched=0.
7. **Publish while disconnected** → Returns `{ok: false, error: "CONNECTION_CLOSED", retryable: true}`. No throw; graceful failure.
8. **Subscribe after connection close** → Throws `PubSubError<"CONNECTION_CLOSED">`. State mutation on dead connection is an error signal.
9. **Large payloads** → App SHOULD validate before publish; adapter may reject with `{ok: false, error: "PAYLOAD_TOO_LARGE", retryable: false}`.
10. **Concurrent subscribe/unsubscribe** → Order is sequential per connection (single event loop); race-free in JS/Bun.
11. **Reconnection & State Persistence** — Subscriptions **do not persist** across connection close/reconnect. Clients MUST explicitly re-subscribe after reconnection.

    **Rationale**: Subscriptions are per-connection state. On disconnect, all subscriptions are cleared by the adapter (automatic cleanup). On reconnect, the client has a fresh connection with no subscriptions.

    This is intentional: clients should maintain their own "desired topics" list and re-subscribe explicitly. This is explicit and controllable by the app, vs automatic but fragile.

    **Pattern (using `replace()` for clean resync)**:

    ```typescript
    const desiredTopics = ["room:123", "system:announcements"];

    client.on("open", async () => {
      // Atomic resync to desired set (no manual diffing)
      await ctx.topics.replace(desiredTopics);
    });

    client.on("join-room", ({ roomId }) => {
      desiredTopics.push(`room:${roomId}`);
      // Update subscriptions atomically
      await ctx.topics.replace(desiredTopics);
    });

    client.on("leave-room", ({ roomId }) => {
      desiredTopics = desiredTopics.filter((t) => t !== `room:${roomId}`);
      // Atomic resync (adds/removes as needed)
      await ctx.topics.replace(desiredTopics);
    });
    ```

    **Pattern (manual control, if needed)**:

    ```typescript
    const desiredTopics = ["room:123"];

    // Subscribe to individual topics (for fine-grained control)
    client.on("open", async () => {
      for (const topic of desiredTopics) {
        await ctx.topics.subscribe(topic);
      }
    });

    // Unsubscribe explicitly
    client.on("leave-room", ({ roomId }) => {
      await ctx.topics.unsubscribe(`room:${roomId}`);
    });
    ```

---

## 9. Topics Invariants

### 9.1 Immutability

The `Topics` instance is immutable at runtime. Callers MUST NOT mutate the object or its internal state via type casts or reflection.

**Consequence:** Mutations bypass validation, authorization hooks, and adapter coordination—leading to inconsistent state and silent failures.

**Enforcement:** Adapters MUST call `Object.freeze(this)` in the constructor. TypeScript's `ReadonlySet<string>` provides compile-time safety.

**Note on iteration:** The `forEach()` method and other iteration methods (`keys()`, `values()`, `entries()`) MUST NOT expose the mutable internal `Set` via the callback's third argument. Implementations must pass a safe `ReadonlySet` reference (e.g., the TopicsImpl facade itself) to prevent bypassing validation and authorization.

See § 11: Implementation Invariants for adapter compliance details.

### 9.2 Reading Subscriptions

`ctx.topics` is a `ReadonlySet<string>`. Iteration (via `for..of`, spread, `.values()`, `.keys()`, `.entries()`, `.forEach()`) is **snapshot-based**: each iteration takes a snapshot of subscriptions at that moment. Concurrent mutations from other handlers don't affect an in-progress loop.

```typescript
const it = ctx.topics.values();
const first = it.next(); // "room:a"

await ctx.topics.subscribe("room:z"); // happens elsewhere

const second = it.next(); // "room:b" (not "room:z")
```

This prevents data races in concurrent handlers. Trade-off: O(n) per iteration call, acceptable at typical counts (< 1000 topics per connection).

---

## 10. Examples

### 10.1 Simple String Topics

```typescript
router.on(JoinRoom, async (ctx, { roomId }) => {
  const topic = `room:${roomId}`;
  await ctx.topics.subscribe(topic);

  // Inspect current subscriptions
  if (ctx.topics.has(topic)) {
    // Broadcast to all subscribers in this room
    const result = await ctx.publish(topic, UserJoined, {
      userId: ctx.user.id,
    });
    console.log(`Delivered to ${result.matched ?? "?"} subscribers`);
  }

  ctx.reply(Ack, { topics: [...ctx.topics] });
});

router.on(LeaveRoom, async (ctx, { roomId }) => {
  const topic = `room:${roomId}`;
  await ctx.topics.unsubscribe(topic);
  ctx.reply(Ack, {});
});
```

### 10.2 Batch Operations

```typescript
router.on(JoinMultipleRooms, async (ctx, { roomIds }) => {
  // Atomic batch: all succeed or all fail
  const topics = roomIds.map((id) => `room:${id}`);
  const result = await ctx.topics.subscribeMany(topics);

  ctx.reply(Ack, { added: result.added, total: result.total });
});

router.on(LeaveAllRooms, async (ctx) => {
  const result = await ctx.topics.clear();
  ctx.reply(Ack, { removed: result.removed });
});
```

### 10.3 Typed Topics

```typescript
const RoomTopic = topic(
  "room",
  z.object({ roomId: z.string().uuid() }),
  ({ roomId }) => `room:${roomId}`,
);

router.on(JoinRoom, async (ctx, { roomId }) => {
  // Schema validation happens at compile-time; runtime validation in make()
  const topicStr = RoomTopic.make({ roomId });
  await ctx.topics.subscribe(topicStr);

  await ctx.publish(topicStr, RoomEvent, {
    type: "user_joined",
    userId: ctx.user.id,
  });

  ctx.reply(Ack, { topic: topicStr });
});
```

### 10.4 With Authorization Hooks

```typescript
router.use(
  usePubSub({
    normalize: (t) => t.toLowerCase(),
    authorizeSubscribe: async (ctx, topic) => {
      const [kind, id] = topic.split(":");
      if (kind === "room") {
        return ctx.user && (await canAccessRoom(ctx.user.id, id));
      }
      return true; // Public topics
    },
    onSubscribe: (ctx, topic) => {
      logger.info(`User ${ctx.user?.id} subscribed to ${topic}`);
    },
  }),
);
```

### 10.5 Publishing from Router (Background Tasks)

```typescript
// Background job: broadcast system heartbeat every 10s
setInterval(async () => {
  const result = await router.publish("system:heartbeat", Heartbeat, {
    timestamp: Date.now(),
  });
  logger.debug(`Heartbeat delivered to ${result.matched ?? "?"} clients`);
}, 10_000);
```

### 10.6 Origin Tracking: Include Sender Identity

Track the sender of broadcast messages for chat, audit logs, or access control:

```typescript
const ChatMessage = message(
  "CHAT",
  { text: z.string(), userId: z.string() }, // Include sender in payload
);

router.on(SendChat, (ctx) => {
  const result = await ctx.publish(`room:${ctx.ws.data.roomId}`, ChatMessage, {
    text: ctx.payload.text,
    userId: ctx.ws.data.userId, // Include sender identity
  });

  if (!result.ok && result.retryable) {
    logger.warn(`Chat publish will retry (${result.error})`);
  }
});
```

**Pattern:**

- **Include in payload** — For data essential to message semantics (sender ID, timestamp)
- **Never broadcast `clientId`** — It's transport-layer identity, not application identity
- **Audit logs** — Store sender identity for compliance and debugging

### 10.7 Room Management: Subscribe, Broadcast, Cleanup

Typical flow for multi-user spaces (rooms, topics, collaborative documents):

```typescript
const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const UserJoined = message("USER_JOINED", {
  roomId: z.string(),
  userId: z.string(),
});
const UserLeft = message("USER_LEFT", {
  roomId: z.string(),
  userId: z.string(),
});

router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;

  // Update connection data for cleanup later
  ctx.assignData({ roomId });

  // Subscribe to room updates
  await ctx.topics.subscribe(`room:${roomId}`);

  // Broadcast to all room members
  const result = await ctx.publish(`room:${roomId}`, UserJoined, {
    roomId,
    userId: ctx.ws.data.userId || "anon",
  });

  if (result.ok) {
    logger.info(
      `User joined room:${roomId} (matched: ${result.matched ?? "?"})`,
    );
  }
});

router.onClose((ctx) => {
  const roomId = ctx.ws.data.roomId;

  if (roomId) {
    // Unsubscribe from room
    ctx.topics.unsubscribe(`room:${roomId}`);

    // Notify others (best-effort)
    router
      .publish(`room:${roomId}`, UserLeft, {
        roomId,
        userId: ctx.ws.data.userId || "anon",
      })
      .catch((err) => {
        logger.error(`Failed to publish user-left (${err})`);
      });
  }
});
```

**Key points:**

- Store room ID in `ctx.assignData()` for cleanup in `onClose()`
- Unsubscribe **and** broadcast leave notification (both are important)
- Publish may fail; wrap in try/catch or handle result

---

## 11. Implementation Invariants for Adapter Authors

These invariants must hold for all adapters. See [ADR-022 Implementation Invariants](../adr/022-namespace-first-pubsub-api.md#implementation-invariants-for-adapters) for the design rationale behind each invariant.

**Normalization contract:**

- Input `topic` is normalized **before** validation and authorization checks.
- App receives normalized topic in authorization hook: `authorizeSubscribe(ctx, normalized)`.
- App receives normalized topic in hooks: `onSubscribe(ctx, normalized)`.
- This prevents TOCTOU bugs where app authorizes one string and adapter stores another.

**Idempotency contract:**

- `subscribe(topic)` when already subscribed: return `void`, **do not call hooks**, **do not throw**.
- `unsubscribe(topic)` when not subscribed: return `void` **without validation**, **do not call hooks**, **do not throw** (even if topic format is invalid).
- Errors (validation, authorization) **always throw** on `subscribe()`, even on duplicate calls. For `unsubscribe()`, validation errors only throw if the topic **is** subscribed (soft no-op if not).

**Adapter-first ordering (critical for all operations):**

- All operations (single and batch) follow: normalize → validate → authorize → **adapter call** → mutate → hooks
- **Adapter calls happen before state mutation**, never after.
- If adapter call fails, local state must remain unchanged (no mutation occurs).
- This ordering eliminates ghost state, prevents rollback complexity, and ensures reads always reflect committed reality.
- Hooks fire **only after successful mutation**, and only on actual state changes (not on idempotent no-ops).

**Hook timing:**

- `onSubscribe` called **only after** adapter succeeds and mutation completes (topic added to set).
- `onUnsubscribe` called **only after** adapter succeeds and mutation completes (topic removed from set).
- If hook throws, state is **already mutated**. Mutation is not rolled back; hooks are best-effort. Adapters may log hook exceptions but must not reverse the state change.
- Hooks **not called** on idempotent no-ops or on failed adapter calls.

**Batch atomicity:**

- Validate all topics in the batch **before** any adapter calls or state mutations.
- Call adapter for all topics **before** mutating any state.
- If any adapter call fails, stop immediately; no state is mutated and no further adapter calls are made.
- If any topic fails (invalid format, unauthorized, adapter error), entire batch fails atomically—no topics are added/removed.
- Exception: duplicate topics in same call are coalesced before atomicity check (not an error).
- On success, all topics are subscribed atomically; final state is consistent.

**Replace atomicity:**

`replace()` follows the same atomic pattern: validate all desired topics → authorize all new topics → call adapter for all changes → mutate state. Return early if delta is empty (idempotent no-op).

**ReadonlySet semantics:**

- `ctx.topics` is immutable from caller perspective (ReadonlySet contract).
- Callers **cannot mutate** via `.add()`, `.delete()`, or direct access.
- Adapters must prevent mutation: use `Object.freeze()`, proxy, or wrapper.
- State changes only via `subscribe()`, `unsubscribe()`, `subscribeMany()`, `unsubscribeMany()`, `clear()`, and `replace()`.

**Authorization timing:**

- `authorizeSubscribe` checked on every `subscribe()` call, even if already subscribed (before idempotency check).
- `authorizePublish` checked on every `publish()` call.
- **Not cached** by default (each call re-checks). Apps can cache via `invalidateAuth` hook callback.

**Publish error semantics and retryability:**

- `publish()` returns `PublishResult` with `error: PublishError`, `retryable: boolean`, and optional `details` object.
- Retryability defaults:
  - **Non-retryable (`false`)**: `VALIDATION`, `ACL`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED`, `STATE` (if permanent)
  - **Retryable (`true`)**: `BACKPRESSURE`, `CONNECTION_CLOSED`, `ADAPTER_ERROR` (if transient)
- For `ADAPTER_ERROR`, include `details.transient?: boolean` to guide app retry logic.
- `details` object is unstructured; examples: `{ feature: "excludeSelf", limit: 1048576, transient: true }`.
- Always provide `cause?: unknown` for wrapped errors (following `Error.cause` convention).

**Subscription error propagation:**

- Throw `PubSubError` with correct `code` from the spec.
- Include `details?: unknown` for adapter-specific context (e.g., underlying error).
- Never throw other error types for spec-defined scenarios.

---

## 12. Adapter Compliance

### Bun (≥1.3.2)

| Capability              | Implementation                                                  | Notes                                        |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| `subscribe/unsubscribe` | Native `ws.subscribe()` / `ws.unsubscribe()`                    | Protocol native; instant                     |
| `subscriptions`         | `ws.subscriptions` snapshot wrapped as `ReadonlySet`            | Cache-aware, invalidated on sub/unsub        |
| `publish`               | `server.publish()`                                              | Returns backpressure hint                    |
| `subscriberCount?`      | `ws.subscriptions.size` (for own connection) + adapter tracking | Optional; available as exact count per topic |

### Node.js / uWS (Polyfill)

| Capability              | Implementation                                        | Notes                        |
| ----------------------- | ----------------------------------------------------- | ---------------------------- |
| `subscribe/unsubscribe` | Per-connection `Set<string>` maintained by middleware | Semantically identical       |
| `subscriptions`         | Direct Set reference                                  | Wrapped as `ReadonlySet`     |
| `publish`               | Iterate topic index; send to all subscribers          | Returns estimate             |
| `subscriberCount?`      | Maintained by middleware                              | Optional; may be unavailable |

### Other Adapters

Follow the same pattern: maintain per-connection topic set, iterate on publish.

---

## 13. Future Extensions

### 13.1 Pattern Subscriptions (Separate Spec)

```typescript
// Future: wildcard / regex subscriptions
await ctx.topics.subscribePattern("room:*"); // All rooms
await ctx.topics.subscribePattern(/^user:\d+/); // Regex
```

Planned as `specs/pubsub-patterns.md`.

### 13.2 Typed Topic Middleware (Separate Spec)

```typescript
// Future: per-topic lifecycle hooks at router level
router.topic(RoomTopic, {
  onSubscribe: (ctx, { roomId }) => {
    /* side effects */
  },
  maxSubscriptionsPerTopic: 1000,
});
```

Planned as enhancement to hooks.

### 13.3 Presence & TTL (Separate Spec)

```typescript
// Future: ephemeral subscriptions with heartbeat/expiry
await ctx.topics.subscribe(topic, { ttl: 30_000, heartbeat: 10_000 });
```

Planned as `specs/presence.md`.

### 13.4 Multi-Process Fan-Out (Separate Spec)

```typescript
// Future: Redis Adapter for cross-process pub/sub
const router = createRouter({ adapter: redisAdapter({ url: "redis://..." }) });
```

Planned as `specs/pubsub-redis.md`.

---

## 14. Concurrency & Edge Cases for Implementers

**Per-connection operations are sequential** (single event loop per connection in JS):

- If handler A calls `subscribe(topic)` and handler B simultaneously calls `subscribe(topic)`, operations are serialized via the inflight map to prevent race conditions.
- Concurrent operations on the same topic are guaranteed to be linear: the second operation waits for the first to complete, then re-checks idempotency conditions.
- This serialization prevents race conditions like "subscribe waiting for a stale unsubscribe promise" or state inconsistencies from interleaved operations.
- **No need for connection-level locking** in single-threaded adapters (Bun, Node).

**Sequential serialization** (required for correctness):

- All operations on the same topic are serialized: if an operation is in-flight, subsequent operations wait for it to complete.
- This prevents race conditions where subscribe and unsubscribe interleave (e.g., subscribe waiting for a non-existent unsubscribe promise).
- Implementation: Maintain an `inflight` map per connection, storing a `Promise<void>` for each topic with an in-flight operation. Before executing, check if `inflight[topic]` exists; if so, await it, then re-check idempotency conditions.
- After the operation completes, remove the topic from `inflight` (in a `finally` block to ensure cleanup even on error).
- This ensures linearization without complex type tracking or coalescing logic.

**Error isolation in concurrent operations** (decoupling error semantics):

- When a serialized operation waits for a prior operation that **rejected**, it MUST catch that rejection and re-check idempotency.
- **Rationale**: Each operation's error semantics depend on its own work, not failures from previous operations.
- **Example**: If `subscribe("room:1")` fails with adapter error, then `unsubscribe("room:1")` is called concurrently:
  1. `unsubscribe` waits for `subscribe`'s promise to settle (rejection caught)
  2. `unsubscribe` catches the rejection (does not propagate it)
  3. `unsubscribe` re-checks idempotency: `has("room:1")` → `false` (subscribe failed)
  4. `unsubscribe` returns void without error (soft no-op semantics preserved)
- This ensures unsubscribe's soft no-op guarantee and allows retries after failures.
- Implementation: Use `try { await existing; } catch { /* ignore */ }` when waiting for in-flight operations, then re-check state.

**Hook execution model:**

- Hooks run synchronously (or async awaited) **within** the operation, **after adapter succeeds**.
- If hook throws, operation throws; state is already mutated (hook doesn't run inside try/catch by default).
- Apps that need rollback should wrap hook in try/catch and call `unsubscribe()` if hook fails.

**Concurrent batch and single ops:**

- `subscribeMany([a, b])` and `subscribe(a)` running simultaneously: both use the same inflight serialization mechanism.
- Batch atomicity is per-batch; doesn't block other operations on same connection.
- If `subscribeMany([a, b])` is in flight and `subscribe(a)` arrives, `subscribe(a)` will wait for the batch operation to complete (due to inflight tracking), ensuring linearization.

**Publishing during subscribe/unsubscribe:**

- If handler A publishes while handler B is subscribing to same topic: both may succeed in any order.
- Adapter handles buffering/ordering; spec doesn't mandate specific behavior.
- App should not assume publish delivery before subscribe completes.

**Connection close during operation:**

- If connection closes during `subscribe()`, operation fails with `PubSubError<"CONNECTION_CLOSED">`.
- No partial state; adapter must ensure all-or-nothing semantics even on disconnect.
- In-flight coalescing MUST be cleared on connection close to prevent hanging promises.

---

## 15. Compliance Checklist (for Adapter Implementers)

- [ ] `subscribe()` and `unsubscribe()` are idempotent (no error on duplicate).
- [ ] All ops follow order: normalize → validate → authorize → **adapter call** → mutate → lifecycle hooks (adapter-first).
- [ ] If adapter call fails, local state must remain unchanged (no mutation).
- [ ] `subscribeMany()` and `unsubscribeMany()` are atomic (all-or-nothing, per batch).
- [ ] `publish()` respects schema validation and authorization.
- [ ] `publish()` returns `PublishResult` with correct capability and matched count.
- [ ] `subscriptions` is a `ReadonlySet<string>` (or compatible immutable wrapper).
- [ ] Idempotency check happens **before** hooks fire (hooks not called on no-ops).
- [ ] Hooks receive **normalized** topic, not raw input.
- [ ] Automatic cleanup on connection close (subscriptions cleared, hooks not called).
- [ ] Error codes match spec exactly: use `PubSubError` with correct code.
- [ ] Backpressure signaling works correctly in `publish()` result.
- [ ] No mutation of state if any topic in batch fails (transactional semantics).
