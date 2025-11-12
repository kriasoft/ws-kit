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

### Capability Gating & Identity

Pub/Sub is a **capability-gated** feature: `ctx.publish()` and `ctx.topics` exist **only** when `withPubSub(adapter)` is plugged into the router.

**Router identity:**

- Each connection is assigned a stable **`clientId`** at accept time (available as `ctx.clientId` in all handlers).
- `clientId` is a string (typically a UUID or random identifier) that uniquely identifies a WebSocket connection.
- Used internally by the adapter to track per-connection subscriptions and to implement cleanup on disconnect.

**Type Safety:**

- Without `withPubSub()`, `ctx.publish()` and `ctx.topics` don't exist at compile time; TypeScript prevents usage.
- With `withPubSub()`, both are guaranteed to be present (gated at the type level by capability plugins).
- Middleware can safely assume `ctx.clientId` is always present (no null checks needed).

**Example:**

```typescript
// With withPubSub:
const router = createRouter().plugin(withZod()).plugin(withPubSub(adapter));

router.on(Message, async (ctx) => {
  await ctx.topics.subscribe("room:123"); // ✅ Allowed; passes ctx.clientId to adapter
  const result = await ctx.publish("topic", Msg, payload); // ✅ Allowed
});

// Without withPubSub:
const router2 = createRouter().plugin(withZod());

router2.on(Message, async (ctx) => {
  await ctx.topics.subscribe("room:123"); // ❌ TS error: ctx.topics doesn't exist
  const result = await ctx.publish("topic", Msg, payload); // ❌ TS error: ctx.publish doesn't exist
});
```

---

## 2. Terminology

- **Topic** — Opaque string key, case-sensitive, normalized per app policy. Example: `"room:123"`, `"system:announcements"`.
- **Subscription** — A connection's membership in a topic; persists for connection lifetime or until explicitly removed.
- **Payload** — Data published to a topic: `string | ArrayBuffer | ArrayBufferView`. JSON is app-level.
- **Broadcast** — Publishing a message to all subscribers of a topic.
- **clientId** — Stable, unique identifier assigned to each WebSocket connection at accept time. Available as `ctx.clientId` in all handlers. Used internally by pub/sub adapter to track per-connection subscriptions.

---

## 3. Public API Surface

### 3.1 Per-Connection Subscriptions (`ctx.topics`)

```typescript
/**
 * Options for topic mutation operations.
 * Supports cancellation via AbortSignal and settlement semantics.
 */
interface TopicMutateOptions {
  /**
   * AbortSignal for cancellation.
   * If aborted before commit phase, operation rejects with AbortError and no state changes occur.
   * If aborted after commit begins, operation completes normally (late aborts ignored).
   */
  signal?: AbortSignal;

  /**
   * Wait for operation settlement semantics.
   * - "optimistic" (default): Return immediately after local mutation and adapter enqueue (fast path)
   * - "settled": Wait for adapter settlement; respects timeoutMs and signal
   *
   * Use "settled" for tests and correctness-critical flows requiring deterministic settlement.
   * Note: "settled" means the operation completed locally after a successful adapter call;
   * use verify() to check adapter truth across failures/failovers.
   */
  waitFor?: "optimistic" | "settled";

  /**
   * Timeout in milliseconds for "settled" operations.
   * Only meaningful when waitFor === "settled".
   * On timeout, operation throws AbortError.
   * Composes with signal: if either aborts, operation rejects.
   */
  timeoutMs?: number;

  /**
   * After settlement, verify adapter truth before returning.
   * Only meaningful when waitFor === "settled".
   *
   * - "strict": Must verify; throw if adapter lacks capability or verification fails
   * - "best-effort": Try to verify; fall back to local state if adapter doesn't support
   * - "off" (default): Skip verification
   */
  verify?: "strict" | "best-effort" | "off";
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
   * @param options - Optional cancellation signal, settlement, verification
   */
  set(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
  ): Promise<{ added: number; removed: number; total: number }>;

  /**
   * Get detailed subscription status (settled, pending, or absent).
   * Use when you need to distinguish in-flight operations from settled state.
   *
   * **Important**: "settled" means the operation completed locally after a successful adapter call.
   * It does NOT guarantee adapter truth across failures, failovers, or other connections.
   * Use verify() to check adapter truth if needed.
   *
   * @returns One of: 'settled' (last mutation completed locally after adapter call),
   *          'pending-subscribe' (subscribe in-flight),
   *          'pending-unsubscribe' (unsubscribe in-flight),
   *          'absent' (not subscribed)
   */
  localStatus(
    topic: string,
  ): "settled" | "pending-subscribe" | "pending-unsubscribe" | "absent";

  /**
   * Update subscriptions using a callback that mutates a draft Set.
   * Provides Set-like ergonomics while maintaining atomicity.
   *
   * @param mutator - Function that mutates the draft Set in-place
   * @param options - Optional cancellation signal, settlement, verification
   * @returns { added, removed, total } - Counts of topics changed
   */
  update(
    mutator: (draft: Set<string>) => void,
    options?: TopicMutateOptions,
  ): Promise<{ added: number; removed: number; total: number }>;

  /**
   * Wait for all in-flight operations to settle.
   * Useful for tests and tooling: ensures all pending subscribe/unsubscribe/set/update calls
   * have completed before you assert state.
   *
   * @param topic - Optional: wait for a specific topic's operations. If omitted, wait for all.
   * @param options - Optional: `timeoutMs` for timeout, `signal` for cancellation
   * @returns Promise that resolves when settlement is complete
   */
  settle(
    topic?: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<void>;

  /**
   * Probe the adapter for current subscription truth.
   *
   * Returns a discriminated union representing different verification outcomes, allowing
   * precise error handling (retry on error/timeout, fallback on unsupported, etc).
   *
   * @param topic - Topic to verify
   * @param options - Optional: mode ("strict" | "best-effort"), signal (abort)
   * @returns Promise<VerifyResult>
   *   - { kind: "subscribed" }: adapter confirms this connection is subscribed
   *   - { kind: "unsubscribed" }: adapter confirms this connection is NOT subscribed
   *   - { kind: "unsupported" }: adapter lacks verification capability
   *   - { kind: "error"; cause }: transient error from adapter (may retry)
   *   - { kind: "timeout" }: operation timed out
   * @throws AbortError if signal aborts
   */
  verify(
    topic: string,
    options?: {
      mode?: "strict" | "best-effort";
      signal?: AbortSignal;
    },
  ): Promise<VerifyResult>;
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
   *   _senderId: ctx.clientId
   * });
   *
   * // Subscriber
   * router.on(Msg, (ctx) => {
   *   if (ctx.payload._senderId === ctx.clientId) return; // Skip self
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

| Responsibility           | Where                    | Examples                                                                  |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------- |
| **Structural shape**     | `router.limits`          | `topicPattern` (regex), `maxTopicLength`, `maxTopicsPerConnection`        |
| **Context-aware policy** | `usePubSub()` middleware | `normalizeTopic`, `authorize` (unified for subscribe/unsubscribe/publish) |

**Rule**: All pub/sub authorization and normalization go in `usePubSub()` middleware. Constructor is for structural validation only. No ACL, no hooks in router constructor.

**Why**: Eliminates confusion about "where do I put authorization?" Answer is always `usePubSub()` middleware. Separates deploy-time shape from runtime policy; makes testing easier.

---

For applications that need custom authorization or topic normalization, use the `usePubSub()` middleware:

```typescript
interface PubSubPolicyHooks<TConn = unknown> {
  /**
   * Normalize a topic string (e.g., lowercasing, trimming, namespace checks).
   * Runs before validation. Apps should normalize consistently with their
   * router.limits.topicPattern config.
   * Default: identity (no change).
   */
  normalizeTopic?: (
    topic: string,
    ctx: { clientId: string; data: TConn },
  ) => string;

  /**
   * Authorize an operation on a topic.
   * Called for subscribe, unsubscribe, and publish operations.
   * Throw an error to deny the operation.
   * Default: allow all.
   */
  authorize?: (
    action: "subscribe" | "unsubscribe" | "publish",
    topic: string,
    ctx: { clientId: string; data: TConn },
  ) => Promise<void> | void;
}

interface UsePubSubOptions<TConn = unknown> {
  /**
   * Policy hooks for normalization and authorization.
   */
  hooks?: PubSubPolicyHooks<TConn>;
}

export function usePubSub<TConn = unknown>(
  options?: UsePubSubOptions<TConn>,
): Middleware<TConn>;
```

**Example: Custom Authorization**

```typescript
const router = createRouter<AppData>()
  .plugin(withPubSub(createMemoryAdapter()))
  .use(
    usePubSub({
      hooks: {
        normalizeTopic: (topic) => topic.toLowerCase(),
        authorize: async (action, topic, ctx) => {
          // Users can only subscribe to their own notifications
          if (
            action === "subscribe" &&
            topic.startsWith("user:notifications:")
          ) {
            const userId = topic.split(":").pop();
            if (ctx.data.userId !== userId) {
              throw new Error("Access denied");
            }
          }
          // Public rooms anyone can subscribe to
          if (
            !topic.startsWith("room:") &&
            !topic.startsWith("user:notifications:")
          ) {
            throw new Error("Invalid topic");
          }
        },
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

1. **Normalize** — Apply `normalizeTopic(topic)` if provided via `usePubSub()` (e.g., trim, lowercase).
2. **Format & length validation** — Check normalized topic against `router.limits.topicPattern` and `router.limits.maxTopicLength`:
   - Length check: Throw `PubSubError("INVALID_TOPIC", …, { reason: "length", length, max })`
   - Pattern check: Throw `PubSubError("INVALID_TOPIC", …, { reason: "pattern", topic })`
3. **Authorization** — Call `authorize(action, normalized, ctx)` hook via `usePubSub()`.
4. **Limit check** — Verify `subscriptions.size < maxTopicsPerConnection`.
5. **Adapter call** — Delegate to platform.
6. **Mutate** — Add/remove topic from set.

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

### 6.3 Batch Atomicity

`subscribeMany()` and `unsubscribeMany()` are **atomic**: all-or-nothing, no partial success.

**Guarantee**: Either all topics are added/removed or all fail atomically. No partial state on error.

**Key Behaviors:**

- **Idempotency per-topic**: Already-subscribed topics are skipped (no validation, no auth, no adapter call). Batch processes only topics requiring state change.
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

### 6.4 Set Semantics

`set(topics)` atomically replaces current subscriptions with a desired set. Useful for reconnection: avoids manual diffing and ensures single atomic operation.

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
const result = await ctx.topics.set(["room:123", "system:announcements"]);
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

### 6.6 Settlement Semantics (Optional Wait & Timeout)

All topic mutation methods accept `{ waitFor?: "optimistic" | "settled", timeoutMs?: number, verify?: "strict" | "best-effort" | "off" }` for deterministic settlement and adapter verification.

**Default Behavior (Optimistic):**

By default (`waitFor` omitted or `"optimistic"`), operations return immediately after local state mutation and adapter enqueue. This is the fast path, matching historical behavior:

```typescript
// Optimistic (default)
await ctx.topics.subscribe("room:1");
// Returns immediately; adapter call may still be in-flight
```

**Settled Behavior:**

Pass `waitFor: "settled"` to await adapter settlement before returning. Useful for tests or correctness-critical flows:

```typescript
// Block until adapter settlement
await ctx.topics.subscribe("room:1", { waitFor: "settled" });
// Now guaranteed: adapter.subscribe("room:1") has completed

// With timeout (5 seconds)
await ctx.topics.subscribe("room:1", {
  waitFor: "settled",
  timeoutMs: 5000,
});
// Throws AbortError if adapter doesn't settle within 5s
```

**Timeout Composition:**

Timeout composes with `AbortSignal`: either can abort the operation:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);

try {
  await ctx.topics.set(["room:1", "room:2"], {
    waitFor: "settled",
    signal: controller.signal,
    timeoutMs: 5000,
  });
} catch (err) {
  // Either signal aborted (at 1s) or timeout fired (at 5s)
}
```

**Idempotent Settled Subscribe:**

For already-settled topics, settled subscribe returns promptly (no extra wait):

```typescript
await ctx.topics.subscribe("room:1", { waitFor: "settled" });
// Waits for settlement

await ctx.topics.subscribe("room:1", { waitFor: "settled" });
// Already settled; returns immediately (fast path)
```

**Return Values Unchanged:**

Settlement does not change return types or error semantics:

```typescript
// Still returns void
await ctx.topics.subscribe("room:1", { waitFor: "settled" });

// Still returns counts
const { added, removed, total } = await ctx.topics.set(["a", "b"], {
  waitFor: "settled",
});

// Still throws on error (no Result unions)
try {
  await ctx.topics.subscribe("invalid_topic", { waitFor: "settled" });
} catch (err) {
  // err is PubSubError or AbortError
}
```

### 6.6.1 Topic Local Status & Introspection (`localStatus()`)

Query the detailed subscription status of a topic:

```typescript
localStatus(topic: string): "settled" | "pending-subscribe" | "pending-unsubscribe" | "absent"
```

**States:**

- **`"settled"`** — Last mutation completed locally after a successful adapter call (not a guarantee of adapter truth; use `verify()` for that)
- **`"pending-subscribe"`** — Subscribe operation in-flight (optimistic local state shows subscribed)
- **`"pending-unsubscribe"`** — Unsubscribe operation in-flight (optimistic local state shows unsubscribed)
- **`"absent"`** — Not subscribed

**Optimistic vs Settled Semantics (Quick Reference):**

| Scenario                         | `has(topic)` | `localStatus(topic)`    | Notes                                          |
| -------------------------------- | ------------ | ----------------------- | ---------------------------------------------- |
| Not subscribed, no in-flight ops | `false`      | `"absent"`              | Initial state                                  |
| Subscribe in-flight              | `true`       | `"pending-subscribe"`   | Optimistic: local mutation happens immediately |
| Subscribe completed              | `true`       | `"settled"`             | Operation completed locally after adapter call |
| Unsubscribe in-flight            | `false`      | `"pending-unsubscribe"` | Optimistic: local state already changed        |
| Unsubscribe completed            | `false`      | `"absent"`              | Operation completed locally after adapter call |

**Key insight:** `has()` returns the _optimistic_ local state (includes in-flight mutations), while `localStatus()` reveals the precise state of each operation. Use `has()` for fast checks; use `localStatus()` when you need to distinguish pending from settled. Note: "settled" is local completion, not adapter truth. Use `verify()` for adapter-side checks.

**Use cases:**

- Distinguish in-flight operations from settled state for testing or debugging
- Conditional subscription logic: only resubscribe if pending
- Monitor subscription health across connection lifecycle

**Example:**

```typescript
await ctx.topics.subscribe("room:1");
const status = ctx.topics.localStatus("room:1");

if (status === "pending-subscribe") {
  // Still in-flight; adapter may reject it
  await ctx.topics.settle("room:1", { timeoutMs: 5000 });
}
if (status === "settled") {
  // Operation completed locally; subscription may be valid
  // Use verify() to check adapter truth if needed
}
```

### 6.6.2 Update Subscriptions with Callback (`update()`)

Provide ergonomic, callback-based subscription updates with full atomicity:

```typescript
update(
  mutator: (draft: Set<string>) => void,
  options?: TopicMutateOptions
): Promise<{ added: number; removed: number; total: number }>
```

**Semantics:**

1. Creates a draft `Set<string>` of current subscriptions
2. Calls `mutator(draft)` to modify (e.g., `draft.add()`, `draft.delete()`)
3. Computes delta and applies via atomic `set()` call
4. Returns counts of added/removed/total topics

**Behavior:**

- All validation, normalization, limit checks apply (same as `set()`)
- Full rollback semantics on adapter failure
- Supports cancellation and confirmation options

**Example:**

```typescript
// Atomically update subscriptions
await ctx.topics.update((draft) => {
  draft.delete("room:old");
  draft.add("room:new");
  draft.add("room:announcements");
});
// All changes apply atomically or none at all
```

**vs. `set()`:**

- **`set([...])` — Declarative:** Replace subscriptions with exact desired set
- **`update(mutator)` — Imperative:** Mutate via callback for ergonomics

Both are atomic; choose based on readability for your use case.

### 6.6.3 Await In-Flight Operations (`settle()`)

Block until all in-flight subscription operations settle:

```typescript
settle(
  topic?: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<void>
```

**Parameters:**

- `topic` — Optional: wait for a specific topic. If omitted, waits for all.
- `options.timeoutMs` — Timeout in milliseconds; throws `AbortError` on timeout.
- `options.signal` — `AbortSignal` for cancellation.

**Use cases:**

- **Tests:** Ensure all pending operations complete before assertions
- **Correctness:** Distinguish optimistic state (`.has()`) from settled state (post-`settle()`)
- **Debugging:** Monitor operation settlement across the connection

**Example:**

```typescript
// Optimistic operation (returns immediately)
await ctx.topics.subscribe("room:1");
console.log(ctx.topics.has("room:1")); // true (optimistic)

// Wait for settlement
await ctx.topics.settle("room:1", { timeoutMs: 5000 });
console.log(ctx.topics.localStatus("room:1")); // "settled" (settled)
```

**Guarantees:**

- If `settle()` completes, all in-flight operations have settled (success or error)
- Error handling: If any in-flight operation failed before `settle()` was called, that error was already thrown by the operation itself
- Idempotent: Calling `settle()` multiple times is safe

### 6.6.4 Verify Adapter Truth (`verify()`)

Probe the adapter for the current subscription truth. Useful when you need to distinguish local state from actual adapter state (after failures, failovers, or across different connections).

```typescript
verify(
  topic: string,
  options?: {
    mode?: "strict" | "best-effort";
    signal?: AbortSignal;
  }
): Promise<VerifyResult>
```

**Verification modes:**

- **`"strict"`** — Must verify; throw if adapter lacks capability or verification fails
- **`"best-effort"`** — Try to verify; fall back to local state if adapter doesn't support
- Omitted (default) — Same as not calling verify at all

**Return values (VerifyResult):**

- **`{ kind: "subscribed" }`** — Adapter confirms this connection is subscribed to the topic
- **`{ kind: "unsubscribed" }`** — Adapter confirms this connection is NOT subscribed to the topic
- **`{ kind: "unsupported" }`** — Adapter lacks verification capability (strict mode only)
- **`{ kind: "error"; cause }`** — Transient error from adapter (may retry)
- **`{ kind: "timeout" }`** — Verification operation timed out

**Key difference from `localStatus()`:**

- **`localStatus(topic)`** — Reflects local settlement state (did the last mutation complete locally?)
- **`verify(topic)`** — Checks adapter truth (is this connection actually subscribed according to the adapter?)

**Use cases:**

- Detect adapter drift (subscription failed silently, or was evicted during failover)
- Distributed setups where adapter is remote (Redis, Kafka, etc.)
- Correctness-critical flows requiring adapter confirmation
- Testing adapter behavior and failure modes

**Example with strict mode:**

```typescript
// Subscribe locally
await ctx.topics.subscribe("room:1", { waitFor: "settled" });
console.log(ctx.topics.localStatus("room:1")); // "settled"

// Check adapter truth (strict: errors on unsupported)
const result = await ctx.topics.verify("room:1", { mode: "strict" });
if (result.kind === "subscribed") {
  // Adapter confirms subscription
} else if (result.kind === "unsubscribed") {
  // Adapter says we're NOT subscribed (drift detected!)
  // Re-subscribe or escalate
} else if (result.kind === "error") {
  console.error("Verification error:", result.cause);
  // Retry or handle failure
} else if (result.kind === "timeout") {
  console.error("Verification timed out");
  // Retry or fall back to local state
}
```

**Example with best-effort mode:**

```typescript
// Check adapter truth, fall back to local state
const result = await ctx.topics.verify("room:1", { mode: "best-effort" });
if (result.kind === "subscribed" || result.kind === "unsubscribed") {
  // Verified (exact state from adapter)
  console.log("Verified:", result.kind);
} else if (result.kind === "unsupported") {
  // Adapter doesn't support verification; local state shows:
  console.log("Local state:", ctx.topics.has("room:1"));
} else {
  // Error or timeout; fall back
  console.log("Verification failed:", result);
}
```

**Composition with mutations:**

Use `verify` option in mutation methods to check adapter truth after settlement:

```typescript
// Subscribe and verify in one call
await ctx.topics.subscribe("room:1", {
  waitFor: "settled",
  verify: "best-effort", // Try to verify; fall back to local
});
// On return: subscription is settled and verified (or falls back to local state)

// Strict mode: throw if adapter doesn't support verification
await ctx.topics.subscribe("room:1", {
  waitFor: "settled",
  verify: "strict", // Require adapter support
});
// On return: adapter has confirmed subscription or error was thrown
```

---

### 6.7 Publishing Semantics

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
    console.log(`Delivered to exactly ${result.matchedLocal} subscribers`);
  } else if (result.capability === "estimate") {
    // Lower-bound estimate (polyfill or distributed)
    console.log(`Delivered to ≥${result.matchedLocal} subscribers`);
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
  logger.info(`published to ${result.matchedLocal ?? "?"} subscribers`);
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

### 6.8 Connection Lifecycle & Cleanup

- On connection close, all subscriptions are **automatically removed** by the adapter.
- No subscriptions leak or persist.
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
  logger.info(
    `Published to ${result.matched ?? "?"} subscribers (${result.capability})`,
  );
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

**Recommended Pattern: Atomic Resync using `set()`**

```typescript
const desiredTopics = ["room:123", "system:announcements"];

router.onOpen((ctx) => {
  // Atomically resync to desired set (no manual diffing)
  await ctx.topics.set(desiredTopics);
});

router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  desiredTopics.push(`room:${roomId}`);
  // Update subscriptions atomically
  await ctx.topics.set(desiredTopics);
});

router.on(LeaveRoom, (ctx) => {
  const { roomId } = ctx.payload;
  desiredTopics = desiredTopics.filter((t) => t !== `room:${roomId}`);
  // Atomic resync (adds/removes as needed)
  await ctx.topics.set(desiredTopics);
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
    console.log(`Delivered to ${result.matchedLocal ?? "?"} subscribers`);
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
  logger.debug(`Heartbeat delivered to ${result.matchedLocal ?? "?"} clients`);
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
      `User joined room:${roomId} (matched: ${result.matchedLocal ?? "?"})`,
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
  const result = await ctx.topics.set(desired);

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
) => topics.set(desired, options);

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

- **Per-batch**: Within `subscribeMany()`, `unsubscribeMany()`, `set()`, each topic gets idempotency-checked individually. Already-subscribed/unsubscribed topics are skipped (no validation, no authorization, no adapter call) before the batch processes remaining topics.

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

**Set atomicity:**

`set()` follows the same atomic pattern:

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
- State changes only via `subscribe()`, `unsubscribe()`, `subscribeMany()`, `unsubscribeMany()`, `clear()`, and `set()`.

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

## 15. Adapter Layer Architecture

**See also**: [ADR-023](../adr/023-pubsub-adapter-split.md), [Migration Guide](../../migration/pubsub-adapter-split.md)

### 15.1 Core Responsibility Separation

The pub/sub system separates **two distinct concerns**:

1. **`PubSubDriver`** — Local subscription index + stats
   - Manages per-client topic subscriptions
   - Returns exact (memory) or best-effort (distributed) local subscriber counts
   - Broadcasts router-materialized messages to matching subscribers
   - **Never** consumes broker messages or calls back into router
   - **Examples**: `memoryPubSub()`, `redisPubSub()`, `durableObjectsPubSub()`

2. **`BrokerConsumer`** — Inbound message consumption
   - Consumes messages from external brokers (Redis SUBSCRIBE, Kafka, DO callbacks, etc.)
   - Invokes router/platform callback with `PublishEnvelope`
   - Returns cleanup function for lifecycle management
   - **Never** maintains subscription state or delivers WebSocket frames
   - **Examples**: `redisConsumer()`, `durableObjectsConsumer()`

### 15.2 Why the Split

Combining ingress into the adapter created ambiguity:

- Unclear which methods were local-only vs broker-facing
- Hard to test broker consumption independently from subscription tracking
- Difficult to compose multiple brokers into one deployment
- Blurred line between adapter and platform concerns

The split makes each layer testable, composable, and easier to understand.

### 15.3 Memory Adapter (Unchanged)

Memory adapter is purely local; no ingress needed:

```typescript
import { memoryPubSub } from "@ws-kit/memory";

const adapter = memoryPubSub();
// No broker ingress—all publishes are process-local
```

### 15.4 Distributed Adapters (Redis, Cloudflare DO, Kafka)

Distributed adapters provide both pieces, wired by platform:

```typescript
import { redisPubSub, redisConsumer } from "@ws-kit/redis";

const adapter = redisPubSub(redis); // Local index + Redis egress
const ingress = redisConsumer(redis); // Redis inbound handler

// Platform/router wires them together:
ingress.start((envelope) => {
  // Deliver to local subscribers using adapter.getLocalSubscribers()
  const frame = encodeFrame(envelope);
  for await (const clientId of adapter.getLocalSubscribers(envelope.topic)) {
    sessions.get(clientId)?.send(frame);
  }
});
```

### 15.5 `PublishEnvelope` Format

All adapters receive and produce the same envelope:

```typescript
export interface PublishEnvelope {
  topic: string; // Pre-validated by router
  payload: unknown; // Already schema-validated
  type?: string; // Schema name for telemetry
  meta?: Record<string, unknown>; // Observability/routing hints
}
```

Router owns validation; adapters just fan-out.

### 15.6 `PublishResult` with Capability Levels

Adapters return honest subscriber counts based on confidence level:

```typescript
export type PublishResult =
  | {
      ok: true;
      capability: "exact"; // Memory: exact local count
      matchedLocal: number;
      details?: Record<string, unknown>;
    }
  | {
      ok: true;
      capability: "estimate"; // Lower-bound estimate
      matchedLocal: number;
      details?: Record<string, unknown>;
    }
  | {
      ok: true;
      capability: "unknown"; // Distributed: can't count
      matchedLocal: 0; // Always 0 for safety
      details?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: PublishError; // Canonical error code
      retryable: boolean; // Hint for retry logic
      details?: Record<string, unknown>;
    };
```

**Semantics**:

- **"exact"**: In-memory adapter; matchedLocal is definitive local count
- **"estimate"**: Distributed with subscriber tracking; matchedLocal is lower-bound
- **"unknown"**: Distributed without tracking; matchedLocal=0 means "don't know"

---

## 16. Compliance Checklist (for Adapter Implementers)

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
