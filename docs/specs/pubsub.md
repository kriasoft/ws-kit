# Pub/Sub API — Topic Subscriptions & Broadcasting

**File:** `docs/specs/pubsub.md`
**Status:** Final
**Applies to:** `@ws-kit/core` + adapters (Bun, Node/uWS, Cloudflare, etc.)

> **Design Rationale**: See [ADR-022](../adr/022-namespace-first-pubsub-api.md) for the full design decision, alternatives considered, and trade-offs.

---

## 0. Prior Design Issues

The initial draft specification had several problems addressed by the current design:

- **Namespace confusion** — `ctx.pubsub.subscriptions.list()` nested awkwardly; unclear API hierarchy
- **Boolean return types** — `Promise<boolean>` on idempotent ops created ambiguity; what does `false` mean?
- **No batch operations** — Required O(n) awaits; enabled partial failures and inconsistent state
- **Zero type safety** — Topics were opaque strings; no schema validation or compile-time checks
- **Unclear authorization timing** — Ambiguous when hooks run relative to idempotency checks
- **Subscribe/unsubscribe asymmetry** — State mutation and transient action conflated in same namespace

For full analysis and design rationale, see [ADR-022 Context](../adr/022-namespace-first-pubsub-api.md#context).

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
 * Options for topic mutation operations.
 * Supports cancellation via AbortSignal.
 */
interface TopicMutateOptions {
  /**
   * AbortSignal for cancellation.
   * If aborted before commit phase, operation rejects with AbortError and no state changes occur.
   * If aborted after commit begins, operation completes normally (late aborts ignored).
   */
  signal?: AbortSignal;
}

/**
 * Subscription state and operations.
 * Implements ReadonlySet<string> for .has(topic), .size, iteration.
 */
interface Topics extends ReadonlySet<string> {
  /**
   * Subscribe to a topic.
   * Idempotent: subscribing twice to the same topic is a no-op (no error).
   * Throws on validation, authorization, or connection failure.
   * @param options - Optional cancellation signal
   */
  subscribe(topic: string, options?: TopicMutateOptions): Promise<void>;

  /**
   * Unsubscribe from a topic.
   * Idempotent: unsubscribing twice or from non-existent topic is a no-op.
   * Throws only on authorization or adapter failure (rare).
   * @param options - Optional cancellation signal
   */
  unsubscribe(topic: string, options?: TopicMutateOptions): Promise<void>;

  /**
   * Subscribe to multiple topics in one atomic operation.
   * All succeed or all fail; no partial state changes.
   * Returns count of newly added subscriptions and total subscriptions.
   * @param options - Optional cancellation signal
   */
  subscribeMany(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
  ): Promise<{ added: number; total: number }>;

  /**
   * Unsubscribe from multiple topics atomically.
   * Returns count of removed and remaining subscriptions.
   * @param options - Optional cancellation signal
   */
  unsubscribeMany(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
  ): Promise<{ removed: number; total: number }>;

  /**
   * Remove all current subscriptions.
   * Returns count of removed subscriptions.
   * @param options - Optional cancellation signal
   */
  clear(options?: TopicMutateOptions): Promise<{ removed: number }>;

  /**
   * Atomically replace current subscriptions with a desired set.
   *
   * Idempotent: if input set equals current set, returns early (no adapter calls).
   * Soft unsubscribe semantics: topics not currently subscribed are skipped.
   * Returns counts of topics added, removed, and total subscriptions after operation.
   * @param options - Optional cancellation signal
   */
  replace(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
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

````typescript
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
   * **Status**: Not yet implemented (all adapters return {ok: false, error: "UNSUPPORTED"}).
   *
   * **Purpose**: Exclude the sender from receiving the published message.
   *
   * **Portable Pattern (until supported):**
   *
   * Include sender identity in payload and filter on subscriber side:
   * ```typescript
   * // Publisher
   * await ctx.publish(topic, Msg, {
   *   ...payload,
   *   _senderId: ctx.ws.data.clientId
   * });
   *
   * // Subscriber
   * router.on(Msg, (ctx) => {
   *   if (ctx.payload._senderId === ctx.ws.data.clientId) return; // Skip self
   * });
   * ```
   *
   * **Alternative Pattern:**
   *
   * Use separate per-connection topic (e.g., "room:123:others") that only subscribers (not sender) subscribe to:
   * ```typescript
   * // When joining room, sender subscribes to "room:123:others"
   * // When publishing, send to both "room:123" (all) and sender can filter
   * ```
   */
  excludeSelf?: boolean;
}

export type PublishCapability = "exact" | "estimate" | "unknown";

export type PublishError =
  | "VALIDATION" // schema validation failed (local)
  | "ACL_PUBLISH" // authorizePublish hook denied
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
       * False: VALIDATION, ACL_PUBLISH, PAYLOAD_TOO_LARGE, UNSUPPORTED, STATE (don't retry).
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
````

**Error Codes & Remediation**: See [§ 7 Unified Error Codes & Remediation](./pubsub.md#unified-error-codes--remediation) for complete error reference, causes, retryability, and remediation guidance.

**Key Invariant:** `publish()` **never throws** for runtime conditions. All expected failures return `{ok: false}` with an error code and a `retryable` hint. This enables predictable, result-based error handling without exception handling boilerplate. Only programmer errors (wrong schema wiring at startup) throw synchronously.

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

### 5.0 Configuration Authority: Single Extension Point

**🎯 Core Policy (Normative):**

Apps configure pub/sub in **exactly one place**: `usePubSub()` middleware. Router constructor is **structural shape only**.

| Responsibility           | Where                    | Examples                                                                              |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| **Structural shape**     | `router.limits`          | `topicPattern` (regex), `maxTopicLength`, `maxTopicsPerConnection`                    |
| **Context-aware policy** | `usePubSub()` middleware | `authorizeSubscribe`, `authorizePublish`, `normalize`, `onSubscribe`, `onUnsubscribe` |

**Rule**: All pub/sub authorization, normalization, and lifecycle hooks go in `usePubSub()` middleware. Constructor is for structural validation only. No ACL, no hooks in `new WebSocketRouter({...})`.

**Why**: Eliminates confusion about "where do I put authorization?" Answer is always `usePubSub()` middleware. Separates deploy-time shape from runtime policy; makes testing easier.

---

For applications that need custom authorization or lifecycle tracking, use lightweight middleware hooks:

```typescript
interface UsePubSubOptions {
  /**
   * Normalize a topic string (e.g., lowercasing, trimming, namespace checks).
   * Runs before validation. Apps should normalize consistently with their
   * router.limits.topicPattern config.
   * Default: identity (no change).
   */
  normalize?: (topic: string) => string;

  /**
   * Authorize subscription to a topic.
   * Called when a state change would occur (after idempotency check).
   * Denies by returning false or throwing.
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
   * Lifecycle hook: called after successful subscription (actual state change).
   * Useful for logging, analytics, per-topic state initialization.
   * Not called on idempotent no-ops.
   */
  onSubscribe?: (ctx: Context, topic: string) => void | Promise<void>;

  /**
   * Lifecycle hook: called after successful unsubscription (actual state change).
   * Not called on idempotent no-ops.
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

**Example: Custom Authorization & Lifecycle**

```typescript
const router = new WebSocketRouter({
  limits: {
    // All format/length/quota validation goes here
    topicPattern: /^[a-z0-9:_./-]{1,128}$/i, // Default from @ws-kit/core
    maxTopicLength: 128,
    maxTopicsPerConnection: 1000,
  },
});

router.use(
  usePubSub({
    // Context-aware authorization and lifecycle hooks only
    normalize: (t) => t.toLowerCase(),
    authorizeSubscribe: (ctx, topic) => {
      // Access control based on user/role
      return ctx.user?.canAccessTopic(topic) ?? false;
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
    topicPattern: /^[a-z0-9:_./-]{1,128}$/i, // RegExp (default: alphanumeric, :_-/.)
    maxTopicLength: 128, // number (default: 128)
    maxTopicsPerConnection: 1000, // number (default: Infinity)
  },
});
```

**Validation & Authorization Order (Normative):**

Per §6.1, after idempotency check, operations proceed in this order (before adapter calls):

1. **Normalize** — Apply `normalize(topic)` if provided via `usePubSub()` (e.g., trim, lowercase).
2. **Format & length validation** — Check normalized topic against `router.limits.topicPattern` and `router.limits.maxTopicLength`:
   - Length check: Throw `PubSubError("INVALID_TOPIC", …, { reason: "length", length, max })`
   - Pattern check: Throw `PubSubError("INVALID_TOPIC", …, { reason: "pattern", topic })`
3. **Authorization** — Call `authorizeSubscribe(ctx, normalized)` hook via `usePubSub()`.
4. **Limit check** — Verify `subscriptions.size < maxTopicsPerConnection`.
5. **Adapter call** — Delegate to platform.
6. **Mutate** — Add/remove topic from set.
7. **Lifecycle** — Call `onSubscribe()` / `onUnsubscribe()` hook.

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
    topicPattern: /^[a-z0-9:_./-]{1,128}$/i, // Alphanumeric, colon, underscore, hyphen, dot, slash
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

### 5.2 Authorization & Lifecycle Tracking

For centralized access control and event tracking, use `usePubSub()` middleware.

**Example:**

```typescript
const router = new WebSocketRouter({
  limits: {
    topicPattern: /^[a-z0-9:_/-]{1,128}$/i, // Format validation in router limits
    maxTopicsPerConnection: 100,
  },
});

router.use(
  usePubSub({
    // Optional: normalize before any checks
    normalize: (t) => t.toLowerCase(),

    // Access control (called only when state would change)
    authorizeSubscribe: (ctx, topic) => {
      // Users can only subscribe to their own notifications
      if (topic.startsWith("user:notifications:")) {
        const userId = topic.split(":").pop();
        return ctx.user?.id === userId;
      }
      // Public rooms anyone can join
      return topic.startsWith("room:");
    },

    // Lifecycle tracking (called after state changes)
    onSubscribe: (ctx, topic) => {
      console.log(`User ${ctx.user?.id} joined ${topic}`);
    },
  }),
);
```

---

## 6. Semantics

### 6.1 Canonical Operation Order (Normative)

Every subscription operation (single, batch, and replace) follows this **strict invariant: idempotency-first, adapter-before-mutation**.

**Canonical Flow:**

```
Input: subscribe(topic) or unsubscribe(topic)
  ↓
[1] Normalize topic
  ↓
[2] Await in-flight operations on same topic
  ↓
[3] 🔴 IDEMPOTENCY CHECK ← CRITICAL
    Already in target state?
    ├─ YES → Return void (ZERO side effects)
    │        No validation, auth, adapter, hooks, mutation
    │
    └─ NO (state change needed)
       ↓
       [4] Validate (format, length)
           ├─ FAIL → Throw PubSubError
           └─ PASS
              ↓
              [5] Authorize (check hook)
                  ├─ DENY → Throw PubSubError
                  └─ ALLOW
                     ↓
                     [6] Limit check (size < max)
                         ├─ FAIL → Throw PubSubError
                         └─ PASS
                            ↓
                            [7] Adapter call (ws.subscribe/unsubscribe)
                                ├─ FAIL → Throw (state unchanged)
                                └─ PASS
                                   ↓
                                   [8] Mutate local state (add/remove topic)
                                   ↓
                                   [9] Lifecycle hook (onSubscribe/onUnsubscribe)
                                       ├─ FAIL → Throw (state already changed)
                                       └─ PASS
                                          ↓
                                          Return void
```

**🔴 CRITICAL INVARIANT: Idempotency-First (Step 3)**

Duplicate calls return immediately with **ZERO side effects**:

- No validation
- No authorization
- No adapter calls
- No hooks
- No mutation

Guaranteed clean no-ops. **This is the single most important invariant for DX and concurrency safety.**

**Key Principles:**

- **Adapter-before-mutation** (steps 7→8): Side-effects happen before mutation. If adapter throws, local state unchanged; no rollback needed.
- **Normalized authorization** (step 5): Always checks normalized topic, never raw. Prevents TOCTOU bugs.
- **Normalized hooks** (step 9): Hooks receive normalized topic, not raw input.
- **Hook failures don't rollback** (step 9): If hook throws, state is already mutated. Apps requiring transactional semantics implement try/catch at handler level.

### 6.2 Idempotency

Subscription ops are **idempotent**: calling twice is safe, returns success both times.

**Behavior (per §6.1 Canonical Order, step 3) — CRITICAL**:

- `subscribe(topic)` when already subscribed → Returns `void` **without any side effects**. **No validation check, no authorization check, no adapter call, no mutation, no hooks.** Completely transparent no-op.
- `unsubscribe(topic)` when not subscribed → Returns `void` **without any side effects**. **No validation check, no authorization check, no adapter call, no state change, no hooks.** Completely transparent no-op—even if topic format is invalid. Enables safe cleanup in error paths and concurrent scenarios.
- **Errors only on state changes**: Invalid format, authorization denial, connection errors **only throw when a state change would occur**. Idempotent no-ops (already subscribed, not subscribed) **never error, never validate, never authorize, never call adapter**.

**Why This Matters:**

Idempotency-first means apps don't need defensive checks or race condition guards:

- **Reconnection**: Re-subscribe to desired topics without checking current state. Already-subscribed topics are free no-ops.
- **Concurrent handlers**: Multiple handlers calling `subscribe()` on same topic don't conflict or cause spurious validation failures.
- **Error cleanup**: `unsubscribe()` in error paths or finally blocks works unconditionally, even with unvalidated topic strings (soft no-op if not subscribed). No pre-checks needed.
- **No defensive code**: No need for `if (!has(topic))` before unsubscribing or `if (!has(topic) && isValidTopic(topic))` before subscribing.

**Hook behavior**: `onSubscribe()` and `onUnsubscribe()` hooks are **not called** on idempotent no-ops (already subscribed/unsubscribed). Only called on actual state changes.

**Hook exception semantics**: If a hook throws, the exception propagates to the caller (middleware/handler), **but state remains changed**—there is no automatic rollback. Adapters may catch and log hook exceptions, but mutation is not reversed. Applications that require rollback on hook failure should implement custom try/catch logic at the handler level or in middleware before calling subscribe/unsubscribe.

### 6.3 Batch Atomicity

`subscribeMany()` and `unsubscribeMany()` are **atomic**: all-or-nothing, no partial success.

**Guarantee**: Either all topics are added/removed or all fail atomically. No partial state on error.

**Key Behaviors:**

- **Idempotency per-topic**: Already-subscribed topics are skipped (no validation, no auth, no adapter call, no hook). Batch processes only topics requiring state change.
- **Validation first**: All topics requiring state change validated before ANY adapter calls. If any fails, entire batch fails (no mutations, no adapter calls).
- **Sequential adapter calls**: Topics called sequentially; tracked for rollback.
- **Atomic mutation**: Local state changed only after ALL adapter calls succeed.
- **Soft unsubscribe**: `unsubscribeMany` skips non-subscribed topics (no error).
- **Duplicate coalescing**: Duplicate topics in same call coalesced before processing (not an error).

**Return Values:**

- `subscribeMany`: `{ added: number, total: number }`
- `unsubscribeMany`: `{ removed: number, total: number }`

**Atomicity Flow (On Adapter Failure):**

```
Input: subscribeMany([room:1, room:2, room:3])
  ↓
[Per-topic idempotency] Skip already-subscribed topics
  Remaining = [room:1, room:2, room:3]
  ↓
[Validation phase] All topics validated, authorized, limit-checked
  Any fail? → Entire batch fails (return early, zero adapter calls)
  ↓
[Adapter phase] Sequential calls with tracking:
  ├─ ws.subscribe("room:1") ✓ SUCCESS
  ├─ ws.subscribe("room:2") ✓ SUCCESS
  ├─ ws.subscribe("room:3") ✗ FAILURE → ROLLBACK
  │
  ROLLBACK (reverse order):
  ├─ ws.unsubscribe("room:2") → Unwind room:2
  └─ ws.unsubscribe("room:1") → Unwind room:1
  ↓
  Local state unchanged → Throw PubSubError(ADAPTER_ERROR)
```

**Rollback Failure (Rare):**

If rollback itself fails (e.g., `ws.unsubscribe("room:1")` fails during rollback), adapter state becomes inconsistent (some topics may remain subscribed in adapter but not in local state).

Thrown `PubSubError` includes diagnostics in `error.details`:

```typescript
{
  rollbackFailed: boolean,           // True if rollback partially failed
  failedRollbackTopics: string[],    // Topics whose rollback failed
  cause: unknown                     // Original adapter error
}
```

**Monitoring Example:**

```typescript
try {
  await ctx.topics.subscribeMany([...]);
} catch (err) {
  if (err instanceof PubSubError && (err.details as any)?.rollbackFailed) {
    // Adapter/local state diverged; request reconnection
    logger.error("Adapter state inconsistent; reconnect required", err.details);
  }
}
```

### 6.4 Replace Semantics

`replace(topics)` atomically replaces current subscriptions with a desired set. Useful for reconnection: avoids manual diffing and ensures single atomic operation.

**Order of checks (normative):**

1. **Normalize & validate** all desired topics
2. **Authorize** desired topics (those being added)
3. **Per-topic in-flight**: Before computing delta, await any in-flight operation for all desired topics (best-effort try/catch, then re-check state). Ensures linearization with concurrent single-topic ops.
4. **Compute delta** and **🔴 IDEMPOTENCY CHECK (CRITICAL)**: If desired set equals current set, return early with `{added: 0, removed: 0, total: ...}` (no validation, no authorization, no adapter calls, no hooks). Completely transparent no-op.
5. **Limit check**: Verify `currentSize - removed + added <= maxTopicsPerConnection`
6. **Adapter phase** (critical ordering):
   - **Unsubscribe first** from topics being removed (frees space at adapter)
   - **Subscribe second** to new topics (uses freed space)
   - **On failure, rollback in reverse order**: Unsubscribe newly-added topics first (free space), then re-subscribe removed topics. This mirrors forward ordering and respects `maxTopicsPerConnection` during rollback.
7. **Mutate state** and return `{ added, removed, total }`

**Key invariants:**

- **🔴 Idempotency-first (step 4)**: If desired set equals current set, no adapter calls, no validation, no authorization, no hooks. Transparent no-op.
- **Atomic**: All changes apply or none apply. No partial state.
- **Validation first**: All topics requiring state change validated before any adapter calls. Invalid or unauthorized topics cause entire operation to fail.
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

### 6.5 Cancellation Semantics (Optional AbortSignal)

All topic mutation methods accept `{ signal?: AbortSignal }` for pre-commit cancellation.

**Behavior:**

- **Pre-commit abort** (before adapter call): Operation rejects with `AbortError`; no state change, no hooks.
- **Post-commit abort** (after adapter call starts): Operation completes atomically; late aborts ignored.
- **Batch atomicity preserved**: Atomic operations remain all-or-nothing even with cancellation.

**Example:**

```typescript
const controller = new AbortController();
controller.abort();

try {
  await ctx.topics.subscribe("room:1", { signal: controller.signal });
} catch (err) {
  if (err instanceof AbortError) {
    // No state change; ctx.topics.has("room:1") === false
  }
}
```

---

### 6.6 Publishing Semantics

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
- **Authorization:** `authorizePublish()` checked; denial returns `{ok: false, error: "ACL_PUBLISH", retryable: false}`.

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
// {ok: false, error: "ACL_PUBLISH", retryable: false, adapter: "inmemory"}

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

### 6.7 Connection Lifecycle & Cleanup

- On connection close, all subscriptions are **automatically removed** by the adapter.
- No subscriptions leak or persist.
- `onUnsubscribe()` hook is **not** called on connection close (only on explicit `unsubscribe()`).
- Apps may proactively `ctx.topics.clear()` before closing if needed for cleanup.

---

## 7. Error Models

**Rule**: Mutations throw, actions return.

- **Subscriptions (mutations):** `subscribe()`, `unsubscribe()`, `subscribeMany()`, `unsubscribeMany()` **throw `PubSubError`** on failure
- **Publish (action):** `publish()` **returns `PublishResult`** with `ok`, `error`, and `retryable` fields. Never throws for runtime conditions.

**Unified Error Codes**: ACL failures use namespaced codes (`ACL_SUBSCRIBE`, `ACL_PUBLISH`) to enable consistent pattern-matching across adapters. Optional `PubSubAclDetails` struct provides 401/403 nuance and policy context without expanding the core error taxonomy.

### Error Decision Tree

**For subscriptions** (throw on error):

```typescript
try {
  await ctx.topics.subscribe(topic);
} catch (err) {
  if (err instanceof PubSubError) {
    // Handle based on code; see table below
  }
}
```

**For publish** (check result):

```typescript
const result = await ctx.publish(topic, schema, payload);
if (result.ok) {
  // Success
} else if (result.retryable) {
  // Transient failure; schedule retry
} else {
  // Permanent failure; don't retry
}
```

### Unified Error Codes & Remediation

| Error Code             | Operation                     | Cause                                   | Retryable | Remediation                                   |
| ---------------------- | ----------------------------- | --------------------------------------- | --------- | --------------------------------------------- |
| `INVALID_TOPIC`        | subscribe/unsubscribe         | Format/length validation failed         | ✗         | Fix topic string format                       |
| `ACL_SUBSCRIBE`        | subscribe                     | Authorization hook denied               | ✗         | User lacks permission                         |
| `ACL_PUBLISH`          | publish                       | Authorization hook denied               | ✗         | User lacks permission                         |
| `TOPIC_LIMIT_EXCEEDED` | subscribe                     | Hit maxTopicsPerConnection quota        | ✗         | Unsubscribe from other topics                 |
| `CONNECTION_CLOSED`    | subscribe/unsubscribe/publish | Connection closed or router disposed    | ✓         | Retry after reconnection                      |
| `VALIDATION`           | publish                       | Payload doesn't match schema            | ✗         | Fix payload; inspect `cause` field            |
| `STATE`                | publish                       | Router/adapter not ready                | ✗         | Await router ready; check state               |
| `BACKPRESSURE`         | publish                       | Adapter send queue full                 | ✓         | Retry with exponential backoff + jitter       |
| `PAYLOAD_TOO_LARGE`    | publish                       | Payload exceeds adapter limit           | ✗         | Reduce payload size; split messages           |
| `UNSUPPORTED`          | publish                       | Feature unavailable (e.g., excludeSelf) | ✗         | Use fallback strategy; check `adapter` field  |
| `ADAPTER_ERROR`        | any                           | Unexpected adapter failure              | ✓         | Retry with backoff; check `details.transient` |

### Error Type Definitions

**PubSubError** (thrown by subscription operations):

```typescript
class PubSubError extends Error {
  readonly code: PubSubErrorCode;
  readonly details?: unknown; // Adapter-specific context
  constructor(code: PubSubErrorCode, message?: string, details?: unknown);
}
```

**PublishResult** (returned by publish, never thrown):

```typescript
type PublishResult =
  | { ok: true; capability: "exact" | "estimate" | "unknown"; matched?: number }
  | {
      ok: false;
      error: PublishError;
      retryable: boolean;
      adapter?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    };
```

**Subscription Error Codes** (thrown by `subscribe()`, `unsubscribe()`, etc.):

```typescript
export type PubSubErrorCode =
  | "INVALID_TOPIC"
  | "ACL_SUBSCRIBE"
  | "TOPIC_LIMIT_EXCEEDED"
  | "CONNECTION_CLOSED"
  | "ADAPTER_ERROR";
```

**ACL Details** (optional structured context for ACL failures):

```typescript
export type PubSubAclDetails = {
  op: "subscribe" | "publish"; // mirrors error code
  kind?: "unauthorized" | "forbidden"; // 401 vs 403 nuance
  reason?: string; // machine-readable hint
  policy?: string; // policy id/name
  topic?: string; // offending topic
};
```

### Error Handling Examples

**Subscribe error:**

```typescript
try {
  await ctx.topics.subscribe(`room:${roomId}`);
} catch (err) {
  if (err instanceof PubSubError) {
    switch (err.code) {
      case "ACL_SUBSCRIBE":
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

**Publish error:**

```typescript
const result = await ctx.publish(topic, Schema, payload);

if (result.ok) {
  logger.info(`Published to ${result.matched ?? "?"} subscribers`);
} else if (result.retryable) {
  scheduleRetry(topic, payload, { backoff: exponentialBackoff() });
} else {
  logger.error(`Publish failed: ${result.error}`, result.details);
}
```

---

## 8. Edge Cases & Guarantees

**Idempotent Operations:**

- Duplicate subscribe → Returns void (no error, no side effects)
- Duplicate unsubscribe → Returns void (no error, no side effects)
- Unsubscribe from non-subscribed topic → Returns void (no error)

**Atomic Ordering:**

- Subscribe then immediately unsubscribe → Both complete in order; final state is unsubscribed

**Publication Behavior:**

- Publish to topic with zero subscribers → `ok: true` with matched=0 (allowed)
- Publish while disconnected → `{ok: false, error: "CONNECTION_CLOSED", retryable: true}` (graceful failure)
- Large payloads → Adapter may reject with `PAYLOAD_TOO_LARGE` (app should validate first)

**Connection & Concurrency:**

- Subscribe after connection close → Throws `PubSubError("CONNECTION_CLOSED")`
- Concurrent subscribe/unsubscribe → Sequential per connection (race-free in JS/Bun)
- Authorization changes mid-session → Future ops re-checked; server MAY proactively remove unauthorized subscriptions

---

## 9. Reconnection & State Persistence (IMPORTANT PATTERN)

Subscriptions **do NOT persist** across connection close/reconnect. Clients MUST explicitly re-subscribe.

**Rationale**: Subscriptions are per-connection state. On disconnect, adapter clears them automatically. On reconnect, connection is fresh (no subscriptions). This is intentional: apps maintain control via explicit re-subscription.

**Recommended Pattern: Atomic Resync using `replace()`**

```typescript
const desiredTopics = ["room:123", "system:announcements"];

router.onOpen((ctx) => {
  // Atomically resync to desired set (no manual diffing)
  await ctx.topics.replace(desiredTopics);
});

router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  desiredTopics.push(`room:${roomId}`);
  // Update subscriptions atomically
  await ctx.topics.replace(desiredTopics);
});

router.on(LeaveRoom, (ctx) => {
  const { roomId } = ctx.payload;
  desiredTopics = desiredTopics.filter((t) => t !== `room:${roomId}`);
  // Atomic resync (adds/removes as needed)
  await ctx.topics.replace(desiredTopics);
});
```

**Alternative: Manual Control using `subscribe()`/`unsubscribe()`**

For fine-grained control, manage subscriptions individually:

```typescript
const desiredTopics = ["room:123"];

router.onOpen((ctx) => {
  // Subscribe individually
  for (const topic of desiredTopics) {
    await ctx.topics.subscribe(topic);
  }
});

router.on(LeaveRoom, (ctx) => {
  // Unsubscribe explicitly
  await ctx.topics.unsubscribe(`room:${ctx.payload.roomId}`);
});
```

---

## 9. Topics Invariants

### 9.1 Immutability

The `Topics` instance is immutable at runtime. Callers MUST NOT mutate the object or its internal state via type casts or reflection.

**Consequence:** Mutations bypass validation, authorization hooks, and adapter coordination—leading to inconsistent state and silent failures.

**Enforcement:** Implementations MUST prevent direct mutation via:

- `Object.freeze(this)` in the constructor, AND/OR
- A Proxy that throws on `.add()`, `.delete()`, `.clear()` attempts

TypeScript's `ReadonlySet<string>` provides compile-time safety.

**Iteration contract:** The `forEach()` method and other iteration methods (`keys()`, `values()`, `entries()`, `[Symbol.iterator]()`) MUST return snapshots or pass a safe `ReadonlySet` facade (never the mutable internal Set). This prevents callers from bypassing validation and authorization via the callback's third argument.

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

Examples are organized by use case. Start with **Quick Start** for common scenarios, then explore **Advanced Patterns** and **Design Patterns** as needed.

---

### Quick Start (Essential Use Cases)

#### 10.1 Simple String Topics

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

#### 10.2 Batch Operations

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

#### 10.3 Typed Topics

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

---

### Advanced Patterns (Common Real-World Scenarios)

#### 10.4 With Authorization Hooks

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

#### 10.5 Publishing from Router (Background Tasks)

```typescript
// Background job: broadcast system heartbeat every 10s
setInterval(async () => {
  const result = await router.publish("system:heartbeat", Heartbeat, {
    timestamp: Date.now(),
  });
  logger.debug(`Heartbeat delivered to ${result.matched ?? "?"} clients`);
}, 10_000);
```

#### 10.6 Origin Tracking: Include Sender Identity

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

#### 10.7 Room Management: Subscribe, Broadcast, Cleanup

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

### Common Recipes (Copy-Paste Solutions)

#### 10.8 Batch Analytics: Diff Once Per Operation

**Goal:** Log/analyze subscription changes atomically, without per-topic hook overhead.

```typescript
router.on(UpdateSubscriptions, async (ctx, { desired }) => {
  // Capture before state
  const before = new Set(ctx.topics);

  // Execute atomic operation
  const result = await ctx.topics.replace(desired);

  // Compute diff once
  const added = [...ctx.topics].filter((t) => !before.has(t));
  const removed = [...before].filter((t) => !ctx.topics.has(t));

  // Single analytics event
  analytics.track("subscriptions_changed", {
    userId: ctx.ws.data.userId,
    added,
    removed,
    total: result.total,
    timestamp: Date.now(),
  });
});
```

**Why this pattern:**

- Avoids N individual `onSubscribe` / `onUnsubscribe` hook calls
- Single atomic event for audit/analytics
- Useful when you care about the complete delta, not individual topic changes

**Performance note**: For very large batches (100+ topics), this diff-once approach is better than per-topic hooks. If you only need counts, use `result.added` and `result.removed` directly.

---

#### 10.9 Post-Commit Atomic Side-Effects

**Goal:** Run a side-effect after the entire subscription operation succeeds (no rollback if side-effect fails).

```typescript
router.on(JoinMultipleRooms, async (ctx, { roomIds }) => {
  const topics = roomIds.map((id) => `room:${id}`);

  // Atomic subscription
  const result = await ctx.topics.subscribeMany(topics);

  // Post-commit audit log (fire-and-forget; doesn't rollback subscription)
  audit
    .logOnce(ctx, {
      op: "subscribeMany",
      topics,
      count: result.added,
      userId: ctx.ws.data.userId,
      timestamp: Date.now(),
    })
    .catch((err) => {
      logger.error("Audit log failed (subscription already committed)", err);
    });

  ctx.reply(JoinAck, { added: result.added, total: result.total });
});
```

**Why this pattern:**

- Side-effects run **after** subscription succeeds (topic state is committed)
- If side-effect fails, subscription is NOT rolled back (side-effects are best-effort)
- Separates concerns: subscription is atomic; side-effects are optional
- Perfect for audit trails, notifications, cache invalidation

---

#### 10.10 Per-Tenant / Per-Connection Policy (Lazy-Loaded & Cached)

**Goal:** Load authorization policy from database once per connection, cache it, and reuse across all subscription operations.

```typescript
interface TenantPubSubPolicy {
  normalize?: (topic: string) => string;
  authorizeSubscribe?: (
    ctx: Context,
    topic: string,
  ) => boolean | Promise<boolean>;
  authorizePublish?: (
    ctx: Context,
    topic: string,
  ) => boolean | Promise<boolean>;
  onSubscribe?: (ctx: Context, topic: string) => void | Promise<void>;
  onUnsubscribe?: (ctx: Context, topic: string) => void | Promise<void>;
}

router.use(async (ctx, next) => {
  // Load policy once per connection (lazy on first use)
  if (!ctx.ws.data.tenantPolicy) {
    const tenantId = ctx.ws.data.tenantId;
    ctx.assignData({
      tenantPolicy: await db.policies.findByTenant(tenantId),
    });
  }

  // Apply loaded policy
  return usePubSub({
    normalize: (topic) => ctx.ws.data.tenantPolicy?.normalize?.(topic) ?? topic,

    authorizeSubscribe: (ctx, topic) =>
      ctx.ws.data.tenantPolicy?.authorizeSubscribe?.(ctx, topic) ?? true,

    authorizePublish: (ctx, topic) =>
      ctx.ws.data.tenantPolicy?.authorizePublish?.(ctx, topic) ?? true,

    onSubscribe: (ctx, topic) =>
      ctx.ws.data.tenantPolicy?.onSubscribe?.(ctx, topic),

    onUnsubscribe: (ctx, topic) =>
      ctx.ws.data.tenantPolicy?.onUnsubscribe?.(ctx, topic),
  })(ctx, next);
});
```

**Why this pattern:**

- **Lazy-loaded**: Policy fetched on first connection use, not at auth time
- **Cached per-connection**: No repeated database lookups
- **Composable**: Different tenants can have different rules without code duplication
- **Flexible**: Policies can include custom normalization, validation, or hooks
- **Automatic cleanup**: Policy discarded when connection closes (no WeakMap ceremony)

**Alternative**: If policies are dynamic and change mid-session, listen for `invalidateAuth` to refetch:

```typescript
if (policyChanged) {
  ctx.invalidatePubSubAuth?.();
  // Re-load on next operation
  ctx.ws.data.tenantPolicy = undefined;
}
```

---

### Design Patterns & Optional Helpers

#### 10.11 Optional DX Sugar: Helper Patterns

These helpers are not part of the core API but demonstrate ergonomic patterns built from the standard primitives. Apps can implement them as needed:

```typescript
// Ensure subscription exists; return true if newly added
async function ensure(topics: Topics, topic: string): Promise<boolean> {
  if (topics.has(topic)) return false;
  await topics.subscribe(topic);
  return true;
}

// Alias for intent clarity (sync desired topics)
const sync = (
  topics: Topics,
  desired: Iterable<string>,
  options?: { signal?: AbortSignal },
) => topics.replace(desired, options);

// Batch unsubscribe with automatic filtering (soft no-op on non-subscribed)
async function dropMany(topics: Topics, toUnsubscribe: Iterable<string>) {
  return topics.unsubscribeMany(toUnsubscribe); // Automatically skips non-subscribed
}

// Conditional subscribe (useful in reconnection)
async function subscribeIf(
  topics: Topics,
  topic: string,
  condition: () => boolean,
) {
  if (condition()) {
    await topics.subscribe(topic);
  }
}
```

**Note:** These are convenience functions only. The core API is complete and these demonstrate composition without expanding the surface.

---

## 11. Implementation Invariants for Adapter Authors

These invariants must hold for all adapters. See [ADR-022 Implementation Invariants](../adr/022-namespace-first-pubsub-api.md#implementation-invariants-for-adapters) for the design rationale behind each invariant.

**Normalization contract:**

- Input `topic` is normalized **before** validation and authorization checks.
- App receives normalized topic in authorization hook: `authorizeSubscribe(ctx, normalized)`.
- App receives normalized topic in hooks: `onSubscribe(ctx, normalized)`.
- This prevents TOCTOU bugs where app authorizes one string and adapter stores another.

**🔴 Idempotency contract (CRITICAL):**

- **`subscribe(topic)` when already subscribed**: Return `void` with **ZERO side effects**. Do **NOT** validate, **NOT** authorize, **NOT** call adapter, **NOT** mutate state, **NOT** call hooks. Completely transparent no-op. This is guaranteed by checking idempotency before any other step.

- **`unsubscribe(topic)` when not subscribed**: Return `void` with **ZERO side effects**. Do **NOT** validate, **NOT** authorize, **NOT** call adapter, **NOT** mutate state, **NOT** call hooks. Soft no-op—even if topic format is invalid. Guaranteed transparent no-op.

- **Errors only on state changes**: Validation, authorization, connection errors **only throw** when a state change would occur. Idempotent no-ops (already in target state) **never throw**.

- **Per-batch**: Within `subscribeMany()`, `unsubscribeMany()`, `replace()`, each topic gets idempotency-checked individually. Already-subscribed/unsubscribed topics are skipped (no validation, no authorization, no adapter call) before the batch processes remaining topics.

**Adapter-before-mutation (critical for all operations):**

Per §6.1, all operations (single and batch) follow: normalize → **await in-flight** → **idempotency check** → validate → authorize → **adapter call** → mutate → hooks

- Idempotency check happens early (after normalize, after await in-flight) so duplicate calls never error and never hit validation/auth.
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

- **Idempotency check first (per-topic)**: Before validating any topic in the batch, check each topic's current state. Already-subscribed/unsubscribed topics are skipped entirely (no validation, no authorization, no adapter call). Only topics requiring state change proceed.

- **Validate all remaining topics**: Topics requiring state change are validated **before** any adapter calls or state mutations.

- **Call adapter for all remaining topics**: Adapter calls made for all topics requiring state change **before** mutating any state.

- **Atomicity guarantee**: If any topic (of those requiring state change) fails validation, authorization, or adapter call, entire batch fails atomically—no topics are mutated and no adapter calls for any topic succeed.

- **Exception**: Duplicate topics in same call are coalesced before atomicity check (not an error).

- **On success**: All topics requiring state change are subscribed atomically; final state is consistent. Already-subscribed topics remain unchanged (transparent no-op).

**Replace atomicity:**

`replace()` follows the same atomic pattern:

1. Check desired set against current set (idempotency check)
2. Return early if no delta (transparent no-op, no validation, no authorization, no adapter calls)
3. Validate all desired topics
4. Authorize all new topics
5. Call adapter for all changes
6. Mutate state atomically

**ReadonlySet semantics:**

- `ctx.topics` is immutable from caller perspective (ReadonlySet contract).
- Callers **cannot mutate** via `.add()`, `.delete()`, or direct access.
- Adapters must prevent mutation: use `Object.freeze()`, proxy, or wrapper.
- State changes only via `subscribe()`, `unsubscribe()`, `subscribeMany()`, `unsubscribeMany()`, `clear()`, and `replace()`.

**Authorization timing:**

- `authorizeSubscribe` is checked **only when a state change would occur** (after idempotency check). Duplicate `subscribe()` calls skip authorization entirely—no ACL hit on true no-ops.
- `authorizePublish` checked on every `publish()` call.
- **Not cached** by default (each call re-checks). Apps can cache via `invalidateAuth` hook callback for explicit cache invalidation on permission changes.

**Publish error semantics and retryability:**

- `publish()` returns `PublishResult` with `error: PublishError`, `retryable: boolean`, and optional `details` object.
- Retryability defaults:
  - **Non-retryable (`false`)**: `VALIDATION`, `ACL_PUBLISH`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED`, `STATE` (if permanent)
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
- [ ] All ops follow order: normalize → validate → authorize → **adapter call** → mutate → lifecycle hooks (adapter-before-mutation).
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
