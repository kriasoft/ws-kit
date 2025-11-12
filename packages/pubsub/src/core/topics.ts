// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { AbortError, PubSubError } from "./error";
import type { ServerWebSocket, Topics } from "@ws-kit/core";
import { DEFAULT_TOPIC_PATTERN, MAX_TOPIC_LENGTH } from "./constants";

// ============================================================================
// Helper Utilities for Confirmation and Timeout Handling
// ============================================================================

/**
 * Compose an AbortSignal from an optional base signal and timeout.
 * Returns an AbortSignal that aborts when:
 * - The base signal aborts (if provided), OR
 * - The timeout elapses (if timeoutMs is provided)
 */
function composeSignal(base?: AbortSignal, timeoutMs?: number): AbortSignal {
  // No composition needed: no timeout and no base
  if (!timeoutMs && !base) {
    // Return a signal that never aborts
    return new AbortController().signal;
  }

  // Only timeout: create a new controller with timeout
  if (!base && timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    // Track the timeout so cleanup is possible if needed
    (
      controller as unknown as { __timeoutId: ReturnType<typeof setTimeout> }
    ).__timeoutId = timeoutId;
    return controller.signal;
  }

  // Only base: return as-is
  if (!timeoutMs) {
    return base;
  }

  // Both: create a composite controller
  // This controller aborts if either the base aborts or timeout fires
  const composite = new AbortController();

  // Abort on base signal
  if (base.aborted) {
    composite.abort(base.reason);
  } else {
    base.addEventListener("abort", () => {
      if (!composite.signal.aborted) {
        composite.abort(base.reason);
      }
    });
  }

  // Abort on timeout
  const timeoutId = setTimeout(() => {
    if (!composite.signal.aborted) {
      composite.abort(); // Timeout doesn't have a reason; just AbortError
    }
  }, timeoutMs);

  // Store the timeout for cleanup
  (
    composite as unknown as { __timeoutId: ReturnType<typeof setTimeout> }
  ).__timeoutId = timeoutId;

  return composite.signal;
}

/**
 * Await a promise with an AbortSignal.
 * If the signal aborts, the promise is rejected with AbortError (or the abort reason).
 */
function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new AbortError(),
    );
  }

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      signal.addEventListener("abort", () => {
        reject(
          signal.reason instanceof Error ? signal.reason : new AbortError(),
        );
      });
    }),
  ]);
}

/**
 * Validator function for topic validation.
 *
 * Should throw PubSubError with code "INVALID_TOPIC" if the topic is invalid.
 * The error's details object should include a `reason` field indicating the failure category:
 * - "pattern": Topic format doesn't match allowed pattern
 * - "length": Topic exceeds maximum length
 * - Other reason codes are allowed for custom validators
 *
 * @example
 * ```typescript
 * const validator = (topic: string) => {
 *   if (topic.length > 128) {
 *     throw new PubSubError("INVALID_TOPIC", "Too long", { reason: "length", length: topic.length, max: 128 });
 *   }
 *   if (!/^[a-z0-9:_\\-/.]{1,128}$/i.test(topic)) {
 *     throw new PubSubError("INVALID_TOPIC", "Invalid pattern", { reason: "pattern" });
 *   }
 * };
 * ```
 */
export type TopicValidator = (topic: string) => void;

/**
 * Subscription verification mode:
 * - "strict": Fail if verification is unsupported or errors
 * - "best-effort": Fall back to local state if unsupported
 * - "off": Skip verification entirely
 */
export type VerifyMode = "strict" | "best-effort" | "off";

/**
 * Result of verifying a subscription with the adapter.
 *
 * Discriminated union that precisely represents different verification outcomes:
 * - "subscribed": Adapter confirms the connection is subscribed to the topic
 * - "unsubscribed": Adapter confirms the connection is NOT subscribed to the topic
 * - "unsupported": Adapter lacks verification capability (use fallback to local state)
 * - "error": Transient error from adapter (may retry)
 * - "timeout": Verification operation timed out
 */
export type VerifyResult =
  | { kind: "subscribed" }
  | { kind: "unsubscribed" }
  | { kind: "unsupported" }
  | { kind: "error"; cause: unknown }
  | { kind: "timeout" };

/**
 * Convenience helper to check if verification confirms subscription.
 *
 * @example
 * ```typescript
 * const result = await ctx.topics.verify("orders");
 * if (isSubscribed(result)) {
 *   console.log("Confirmed subscribed");
 * } else if (result.kind === "unsupported") {
 *   console.log("Fall back to local state:", ctx.topics.has("orders"));
 * } else if (result.kind === "error") {
 *   console.error("Verification failed:", result.cause);
 * }
 * ```
 */
export function isSubscribed(
  result: VerifyResult,
): result is { kind: "subscribed" } {
  return result.kind === "subscribed";
}

/**
 * Default implementation of the Topics interface.
 *
 * Provides per-connection topic subscription state and operations.
 * Wraps the platform adapter's WebSocket.subscribe/unsubscribe methods.
 *
 * **Adapter-first ordering** (all operations follow the same pattern):
 * 1. Normalize (if provided by middleware)
 * 2. Validate all topics (no state mutation, no adapter calls)
 * 3. Serialize: wait for any in-flight operation on this topic (CRITICAL: before idempotency check)
 * 4. Check idempotency based on current state (after serialization)
 * 5. Check limits and authorization
 * 6. Call adapter(s) for side-effects (no state mutation yet; if any fails, stop here)
 * 7. Mutate internal state (only after all adapters succeed)
 * This guarantees true atomicity and no ghost state per docs/specs/pubsub.md#semantics.
 *
 * **Sequential serialization**: All operations on the same topic are serialized via an in-flight map.
 * If an operation is already in-flight for a topic, subsequent operations MUST wait for it to complete
 * BEFORE checking idempotency. This prevents race conditions where subscribe and unsubscribe interleave.
 * After waiting, idempotency is re-checked since the in-flight operation may have changed state.
 *
 * **Idempotency**: Single subscribe/unsubscribe calls are idempotent (safe to repeat).
 * For subscribe: checked AFTER waiting for in-flight operations (to avoid stale state).
 * For unsubscribe: safe to check early (unsubscribe is idempotent when not subscribed, soft no-op).
 *
 * **Error semantics**: Throws PubSubError on validation, authorization, or adapter failure.
 * No rollback: if adapter call fails, local state remains unchanged.
 *
 * @template TConn - Connection data type
 */
export class TopicsImpl<
  TConn extends { clientId: string } = { clientId: string },
> implements Topics
{
  private readonly subscriptions = new Set<string>();
  private readonly ws: ServerWebSocket<TConn>;
  private readonly maxTopicsPerConnection: number;
  private readonly customValidator: TopicValidator | undefined;
  private readonly inflight = new Map<string, Promise<void>>();
  // Per-connection lock for fallback set() atomicity (wrapper to avoid reassignment after freeze)
  private readonly setQueue = { current: Promise.resolve() };

  /**
   * Create a Topics instance for managing a connection's subscriptions.
   *
   * @param ws - Platform adapter WebSocket instance for this connection
   * @param maxTopicsPerConnection - Maximum number of topics allowed per connection (default: Infinity)
   * @param customValidator - Optional custom validator function for topic validation.
   *                          If provided, overrides default topic validation.
   *                          See {@link TopicValidator} for signature and error requirements.
   *
   * **Hook injection**: Hooks are NOT injected here. Use router.use(usePubSub(...)) middleware
   * for context-aware authorization, normalization, and lifecycle tracking.
   */
  constructor(
    ws: ServerWebSocket<TConn>,
    maxTopicsPerConnection = Infinity,
    customValidator?: TopicValidator,
  ) {
    this.ws = ws;
    this.maxTopicsPerConnection = maxTopicsPerConnection;
    this.customValidator = customValidator;

    // Ensure Topics instance is immutable at runtime (docs/specs/pubsub.md#topics-invariants).
    // Callers MUST NOT attempt to mutate this object or its properties.
    Object.freeze(this);
  }

  // ============================================================================
  // ReadonlySet<string> Implementation
  // ============================================================================

  has(topic: string): boolean {
    // Optimistic: returns local view (includes in-flight subscriptions).
    // Adapter may still reject the in-flight operation, but local visibility is immediate.
    return this.subscriptions.has(topic);
  }

  get size(): number {
    return this.subscriptions.size;
  }

  forEach(
    callback: (value: string, key: string, set: ReadonlySet<string>) => void,
    thisArg?: unknown,
  ): void {
    // Iterate over a snapshot to avoid surprises if subscriptions mutate during forEach.
    // Must not leak mutable internal Set (docs/specs/pubsub.md#immutability).
    // Pass safe readonly reference to prevent bypassing validation/authorization.
    const snapshot = [...this.subscriptions];
    for (const value of snapshot) {
      callback.call(
        thisArg,
        value,
        value,
        this as unknown as ReadonlySet<string>,
      );
    }
  }

  entries(): SetIterator<[string, string]> {
    // Snapshot prevents surprises if subscriptions mutate during iteration
    const snapshot = new Set(this.subscriptions);
    return snapshot.entries();
  }

  keys(): SetIterator<string> {
    // Snapshot prevents surprises if subscriptions mutate during iteration
    const snapshot = new Set(this.subscriptions);
    return snapshot.keys();
  }

  values(): SetIterator<string> {
    // Snapshot prevents surprises if subscriptions mutate during iteration
    const snapshot = new Set(this.subscriptions);
    return snapshot.values();
  }

  [Symbol.iterator](): SetIterator<string> {
    return this.values();
  }

  [Symbol.toStringTag] = "Topics";

  // ============================================================================
  // Topic Subscription Operations
  // ============================================================================

  async subscribe(
    topic: string,
    options?: {
      signal?: AbortSignal;
      waitFor?: "optimistic" | "settled";
      timeoutMs?: number;
      verify?: VerifyMode;
    },
  ): Promise<void> {
    // Step 1: Validate (use input topic directly; normalization is a middleware concern)
    this.validateTopic(topic);
    const normalizedTopic = topic;

    // Pre-commit cancellation: Check if signal is already aborted (after validation)
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    // Sequential serialization: wait for any in-flight operation on this topic FIRST.
    // This prevents race conditions where subscribe and unsubscribe interleave.
    // CRITICAL: This must happen BEFORE the idempotency check (docs/specs/pubsub.md#order-of-checks-normative)
    // IMPORTANT: Catch rejections to decouple error semantics—this operation's outcome depends on
    // its own work, not failures from previous operations (docs/specs/pubsub.md#concurrency-edge-cases-for-implementers)
    const existing = this.inflight.get(normalizedTopic);
    if (existing) {
      try {
        await existing;
      } catch {
        // Previous operation failed; ignore and re-check current state.
        // This operation's error semantics are independent of prior failures.
      }
    }

    // Idempotency: already subscribed? → no-op (checked AFTER waiting for in-flight)
    // For "settled" mode, if already settled, return quickly (local idempotency only; use verify() if you require adapter truth)
    if (this.subscriptions.has(normalizedTopic)) {
      // If waitFor==="settled" and already settled, idempotency shortcut (fast path)
      if (
        options?.waitFor === "settled" &&
        this.localStatus(normalizedTopic) === "settled"
      ) {
        return; // Already settled; return immediately
      }
      return;
    }

    // Step 2: Check topic limit (authorization is a middleware concern, not core state machine)
    // (docs/specs/pubsub.md#order-of-checks-normative)
    if (this.subscriptions.size >= this.maxTopicsPerConnection) {
      throw new PubSubError(
        "TOPIC_LIMIT_EXCEEDED",
        `Cannot subscribe to more than ${this.maxTopicsPerConnection} topics per connection`,
        {
          limit: this.maxTopicsPerConnection,
          current: this.subscriptions.size,
        },
      );
    }

    // Create the side-effect operation: adapter call first, then local mutation.
    // This ensures atomicity and linearization: no ghost state, no rollback needed.
    // (docs/specs/pubsub.md#adapter-first-ordering)
    const operation = (async () => {
      // Step 3: ADAPTER FIRST - call platform adapter before mutating local state
      try {
        // Check connection state before adapter call (CONNECTION_CLOSED error, spec section 8.8)
        // readyState is a property on native WebSocket objects (1 = OPEN)
        // Only check if readyState exists (mocks in tests may not have it)
        const ws = this.ws as unknown as { readyState?: number };
        if (ws.readyState !== undefined && ws.readyState !== 1) {
          // WebSocket.OPEN = 1
          throw new PubSubError("CONNECTION_CLOSED", "Connection is not open");
        }
        this.ws.subscribe(normalizedTopic); // May throw; local state remains unchanged
      } catch (err) {
        // Re-throw CONNECTION_CLOSED as-is, wrap others as ADAPTER_ERROR
        if (err instanceof PubSubError && err.code === "CONNECTION_CLOSED") {
          throw err;
        }
        throw new PubSubError(
          "ADAPTER_ERROR",
          `Failed to subscribe to topic "${normalizedTopic}"`,
          err,
        );
      }

      // Step 4: MUTATE LOCAL STATE - only after adapter succeeds (post-commit, late aborts ignored)
      this.subscriptions.add(normalizedTopic);

      // Lifecycle hooks are handled by usePubSub() middleware (request-scoped, context-aware)
    })();

    // CRITICAL: Track in-flight operation BEFORE awaiting it.
    // This prevents concurrent calls from both slipping through the inflight check.
    // If another operation checks inflight while this one is running, it will see this promise.
    this.inflight.set(normalizedTopic, operation);
    try {
      // Default behavior: optimistic (await for error handling, but this is consistent with current behavior)
      // For "settled" mode: compose signal with timeout and await
      if (options?.waitFor === "settled") {
        const signal = composeSignal(options?.signal, options?.timeoutMs);
        await awaitWithAbort(operation, signal);
      } else {
        await operation;
      }

      // If verify requested, check adapter truth after settlement
      if (
        options?.waitFor === "settled" &&
        options?.verify &&
        options.verify !== "off"
      ) {
        const verifyResult = await this.verify(normalizedTopic, {
          mode: options.verify,
          signal: options?.signal,
        });
        if (verifyResult.kind === "unsubscribed") {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Subscription to "${normalizedTopic}" failed adapter verification`,
          );
        }
        if (
          verifyResult.kind === "unsupported" &&
          options.verify === "strict"
        ) {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Cannot verify subscription: adapter lacks capability`,
            { code: "VERIFY_UNSUPPORTED" },
          );
        }
        if (verifyResult.kind === "error" && options.verify === "strict") {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Subscription verification error`,
            { cause: verifyResult.cause },
          );
        }
        if (verifyResult.kind === "timeout" && options.verify === "strict") {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Subscription verification timed out`,
          );
        }
      }
    } finally {
      // Only delete if this promise is still the latest for this topic.
      // If a newer operation installed a different promise, leave the map entry.
      if (this.inflight.get(normalizedTopic) === operation) {
        this.inflight.delete(normalizedTopic);
      }
    }
  }

  async unsubscribe(
    topic: string,
    options?: {
      signal?: AbortSignal;
      waitFor?: "optimistic" | "settled";
      timeoutMs?: number;
      verify?: VerifyMode;
    },
  ): Promise<void> {
    // Soft no-op semantics (docs/specs/pubsub.md#idempotency): not subscribed? → return without validation.
    // This matches unsubscribeMany() behavior (phase 1: filter to subscribed, phase 2: validate).
    // Enables safe cleanup in finally blocks without pre-checks.
    const normalizedTopic = topic;
    if (!this.subscriptions.has(normalizedTopic)) {
      return;
    }

    // Step 1: Validate (only if currently subscribed; soft no-op if not)
    this.validateTopic(normalizedTopic);

    // Pre-commit cancellation: Check if signal is already aborted (after validation)
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    // In-flight coalescing: wait for any in-flight subscribe/unsubscribe on this topic.
    // This ensures linearization and prevents duplicate adapter calls.
    // IMPORTANT: Catch rejections to decouple error semantics. If a prior subscribe() failed,
    // this unsubscribe() must still honor soft no-op semantics (docs/specs/pubsub.md#idempotency).
    // (docs/specs/pubsub.md#concurrency-edge-cases-for-implementers)
    const existing = this.inflight.get(normalizedTopic);
    if (existing) {
      try {
        await existing;
      } catch {
        // Previous operation failed; ignore and re-check current state.
        // This operation's error semantics are independent of prior failures.
      }
      // Re-check if still subscribed after waiting (another operation may have removed it)
      if (!this.subscriptions.has(normalizedTopic)) {
        return;
      }
    }

    // Create the side-effect operation: adapter call first, then local mutation.
    // This ensures atomicity and linearization: no ghost state, no rollback needed.
    // (docs/specs/pubsub.md#adapter-first-ordering)
    const operation = (async () => {
      // Step 2: ADAPTER FIRST - call platform adapter before mutating local state
      try {
        this.ws.unsubscribe(normalizedTopic); // May throw; local state remains unchanged
      } catch (err) {
        throw new PubSubError(
          "ADAPTER_ERROR",
          `Failed to unsubscribe from topic "${normalizedTopic}"`,
          err,
        );
      }

      // Step 3: MUTATE LOCAL STATE - only after adapter succeeds (post-commit, late aborts ignored)
      this.subscriptions.delete(normalizedTopic);

      // Lifecycle hooks are handled by usePubSub() middleware (request-scoped, context-aware)
    })();

    // Track in-flight operation
    this.inflight.set(normalizedTopic, operation);
    try {
      // For "settled" mode: compose signal with timeout and await
      if (options?.waitFor === "settled") {
        const signal = composeSignal(options?.signal, options?.timeoutMs);
        await awaitWithAbort(operation, signal);
      } else {
        await operation;
      }

      // If verify requested, check adapter truth after settlement
      if (
        options?.waitFor === "settled" &&
        options?.verify &&
        options.verify !== "off"
      ) {
        const verifyResult = await this.verify(normalizedTopic, {
          mode: options.verify,
          signal: options?.signal,
        });
        if (verifyResult.kind === "subscribed") {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Unsubscription from "${normalizedTopic}" failed adapter verification`,
          );
        }
        if (
          verifyResult.kind === "unsupported" &&
          options.verify === "strict"
        ) {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Cannot verify unsubscription: adapter lacks capability`,
            { code: "VERIFY_UNSUPPORTED" },
          );
        }
        if (verifyResult.kind === "error" && options.verify === "strict") {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Unsubscription verification error`,
            { cause: verifyResult.cause },
          );
        }
        if (verifyResult.kind === "timeout" && options.verify === "strict") {
          throw new PubSubError(
            "ADAPTER_ERROR",
            `Unsubscription verification timed out`,
          );
        }
      }
    } finally {
      // Only delete if this promise is still the latest for this topic.
      // If a newer operation installed a different promise, leave the map entry.
      if (this.inflight.get(normalizedTopic) === operation) {
        this.inflight.delete(normalizedTopic);
      }
    }
  }

  /**
   * Subscribe to multiple topics atomically.
   *
   * **Atomicity guarantee**: All topics succeed or all fail. No partial state changes.
   * If validation or any adapter call fails, the connection state is unchanged.
   *
   * **Deduplication**: Duplicate topics in input are coalesced into unique set.
   * Input: ["room:1", "room:1", "room:2"] → internally processed as 2 unique topics.
   *
   * @param topics - Iterable of topic names to subscribe to
   * @param options - Optional: `signal` for cancellation support, `waitFor` for settlement semantics, `timeoutMs` for timeout
   * @returns { added, total } where added = newly subscribed topics, total = all subscriptions
   * @throws {PubSubError} if any topic fails validation or adapter call
   * @throws {AbortError} if `signal` is aborted before commit (no state change)
   */
  async subscribeMany(
    topics: Iterable<string>,
    options?: {
      signal?: AbortSignal;
      waitFor?: "optimistic" | "settled";
      timeoutMs?: number;
      verify?: VerifyMode;
    },
  ): Promise<{ added: number; total: number }> {
    // Pre-commit cancellation: Check if signal is already aborted
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    const topicArray = Array.from(topics);
    // Normalization is a middleware concern; use input topics directly
    const newTopics = new Set<string>(topicArray); // Deduplicate input

    // Step 1: Validate all topics BEFORE any state mutation or adapter calls.
    // Invariant: If validation fails here, nothing is changed (no adapter calls, no state mutation).
    for (const topic of newTopics) {
      this.validateTopic(topic);
    }

    // Step 2: Check topic limit before any adapter calls (docs/specs/pubsub.md#batch-atomicity).
    // Authorization is a middleware concern; skip here
    // Count topics that would be newly added (not currently subscribed).
    let newCount = 0;
    for (const topic of newTopics) {
      if (!this.subscriptions.has(topic)) {
        newCount++;
      }
    }
    if (this.subscriptions.size + newCount > this.maxTopicsPerConnection) {
      throw new PubSubError(
        "TOPIC_LIMIT_EXCEEDED",
        `Cannot subscribe: would exceed ${this.maxTopicsPerConnection} topics per connection`,
        {
          limit: this.maxTopicsPerConnection,
          current: this.subscriptions.size,
          requested: newCount,
        },
      );
    }

    // Pre-commit cancellation: Check again before commit starts
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    // Step 3: Call adapter for all non-subscribed topics.
    // Track successes for rollback if any topic fails (docs/specs/pubsub.md#batch-atomicity).
    // Invariant: If any adapter call fails, rollback happens before throwing (true atomicity).
    const successfulTopics = new Set<string>();
    try {
      for (const topic of newTopics) {
        if (!this.subscriptions.has(topic)) {
          this.ws.subscribe(topic); // May throw; internal state unchanged
          successfulTopics.add(topic);
        }
      }
    } catch (err) {
      // ROLLBACK: Unsubscribe from all topics we successfully subscribed to
      // This ensures atomicity: if any topic fails, all are rolled back (no partial state).
      const failedRollback = new Set<string>();
      for (const topic of successfulTopics) {
        try {
          this.ws.unsubscribe(topic);
        } catch {
          // Rollback failure: adapter and local state are now divergent.
          // Track failed rollbacks to surface in error details for monitoring.
          failedRollback.add(topic);
        }
      }
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to subscribe to topic(s)`,
        {
          cause: err,
          rollbackFailed: failedRollback.size > 0,
          failedRollbackTopics: Array.from(failedRollback),
        },
      );
    }

    // Step 4: Mutate internal state only after all adapter calls succeed (post-commit, late aborts ignored).
    // Invariant: We only reach here if all validations and adapter calls succeeded.
    // This guarantees atomicity: either all topics are subscribed or none are.
    let added = 0;
    for (const topic of newTopics) {
      if (!this.subscriptions.has(topic)) {
        this.subscriptions.add(topic);
        added++;
      }
    }

    // Lifecycle hooks are handled by usePubSub() middleware (request-scoped, context-aware)

    return { added, total: this.subscriptions.size };
  }

  /**
   * Unsubscribe from multiple topics atomically.
   *
   * **Atomicity guarantee**: All subscribed topics succeed or all fail. No partial state changes.
   * Only topics that are currently subscribed are processed; non-subscribed topics are ignored (soft no-op).
   *
   * **Soft no-op semantics**: Topics not in current subscription set are silently skipped:
   * - No validation error for non-subscribed topics
   * - No adapter calls for non-subscribed topics
   * - Removed count reflects only actually-subscribed topics
   *
   * **Deduplication**: Duplicate topics in input are coalesced into unique set.
   *
   * @param topics - Iterable of topic names to unsubscribe from
   * @param options - Optional: `signal` for cancellation support, `waitFor` for settlement semantics, `timeoutMs` for timeout
   * @returns { removed, total } where removed = actually-unsubscribed topics, total = remaining subscriptions
   * @throws {PubSubError} if any subscribed topic fails validation or adapter call
   * @throws {AbortError} if `signal` is aborted before commit (no state change)
   */
  async unsubscribeMany(
    topics: Iterable<string>,
    options?: {
      signal?: AbortSignal;
      waitFor?: "optimistic" | "settled";
      timeoutMs?: number;
      verify?: VerifyMode;
    },
  ): Promise<{ removed: number; total: number }> {
    // Pre-commit cancellation: Check if signal is already aborted
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    const topicArray = Array.from(topics);
    // Normalization is a middleware concern; use input topics directly
    const uniqueTopics = new Set<string>(topicArray); // Deduplicate input

    // Step 1: Identify subscribed topics only (soft no-op for non-subscribed).
    // Invariant: Topics not in current subscriptions are ignored (per docs/specs/pubsub.md#idempotency).
    // This means: no validation errors for non-subscribed topics, no adapter calls for them.
    const subscribedTopics = new Set<string>();
    for (const topic of uniqueTopics) {
      if (this.subscriptions.has(topic)) {
        subscribedTopics.add(topic);
      }
    }

    // Step 2: Validate only subscribed topics.
    // Invariant: Non-subscribed topics skip validation (soft no-op semantics).
    // If validation fails here, nothing is changed (no adapter calls, no state mutation).
    for (const topic of subscribedTopics) {
      this.validateTopic(topic);
    }

    // Pre-commit cancellation: Check again before commit starts
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    // Step 3: Call adapter for all subscribed topics.
    // Track successes for rollback if any topic fails (docs/specs/pubsub.md#batch-atomicity).
    // Invariant: If any adapter call fails, rollback happens before throwing (true atomicity).
    const successfulTopics = new Set<string>();
    try {
      for (const topic of subscribedTopics) {
        this.ws.unsubscribe(topic); // May throw; internal state unchanged
        successfulTopics.add(topic);
      }
    } catch (err) {
      // ROLLBACK: Re-subscribe to all topics we successfully unsubscribed from
      // This ensures atomicity: if any topic fails, all are rolled back (no partial state).
      const failedRollback = new Set<string>();
      for (const topic of successfulTopics) {
        try {
          this.ws.subscribe(topic);
        } catch {
          // Rollback failure: adapter and local state are now divergent.
          // Track failed rollbacks to surface in error details for monitoring.
          failedRollback.add(topic);
        }
      }
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to unsubscribe from topic(s)`,
        {
          cause: err,
          rollbackFailed: failedRollback.size > 0,
          failedRollbackTopics: Array.from(failedRollback),
        },
      );
    }

    // Step 4: Mutate internal state only after all adapter calls succeed (post-commit, late aborts ignored).
    // Invariant: We only reach here if all validations and adapter calls succeeded.
    // This guarantees atomicity: either all subscribed topics are removed or none are.
    let removed = 0;
    for (const topic of subscribedTopics) {
      this.subscriptions.delete(topic);
      removed++;
    }

    // Lifecycle hooks are handled by usePubSub() middleware (request-scoped, context-aware)

    return { removed, total: this.subscriptions.size };
  }

  /**
   * Remove all current subscriptions atomically.
   * Equivalent to `set([])`.
   *
   * **Atomicity guarantee**: All subscriptions succeed in being removed or all fail.
   * If any adapter call fails, the connection state is unchanged.
   *
   * @param options - Optional: `signal` for cancellation support, `confirm` for settlement semantics, `timeoutMs` for timeout
   * @returns { removed } - Count of subscriptions that were removed
   * @throws {PubSubError} if any adapter call fails
   * @throws {AbortError} if `signal` is aborted before commit (no state change)
   */
  async clear(options?: {
    signal?: AbortSignal;
    waitFor?: "optimistic" | "settled";
    timeoutMs?: number;
    verify?: VerifyMode;
  }): Promise<{ removed: number }> {
    const result = await this.set([], options);
    return { removed: result.removed };
  }

  /**
   * Update subscriptions using a callback that mutates a draft Set.
   * Provides Set-like ergonomics while maintaining atomicity.
   *
   * **How it works**:
   * 1. Creates a draft Set of current subscriptions
   * 2. Calls mutator to modify the draft (draft.add(), draft.delete())
   * 3. Atomically applies the diff via a single `set()` call
   * 4. All validation, normalization, rollback semantics apply
   *
   * @param mutator - Function that mutates the draft Set in-place
   * @param options - Optional: `signal` for cancellation support, `confirm` for settlement semantics, `timeoutMs` for timeout
   * @returns { added, removed, total } - Counts of topics changed
   *
   * @example
   * ```typescript
   * // Update multiple topics atomically
   * await ctx.topics.update(draft => {
   *   draft.add("orders.eu");
   *   draft.delete("orders.us");
   * }, { signal: abortCtrl.signal });
   * ```
   */
  async update(
    mutator: (draft: Set<string>) => void,
    options?: {
      signal?: AbortSignal;
      waitFor?: "optimistic" | "settled";
      timeoutMs?: number;
      verify?: VerifyMode;
    },
  ): Promise<{ added: number; removed: number; total: number }> {
    // Create a draft Set of current subscriptions
    const draft = new Set<string>(Array.from(this.subscriptions));

    // Let caller mutate the draft
    mutator(draft);

    // Apply the final state via set()
    return this.set(draft, options);
  }

  /**
   * Wait for all in-flight operations to settle.
   *
   * Useful for tests and determinism: ensures all pending subscribe/unsubscribe/set/update calls
   * have completed before you assert state.
   *
   * **Note**: `has()` returns optimistic state; `settle()` ensures that state is confirmed
   * by the adapter (or rejected, in which case your error handler caught it).
   *
   * @param topic - Optional: wait for a specific topic's operations. If omitted, wait for all.
   * @param options - Optional: `timeoutMs` for timeout, `signal` for cancellation
   * @returns Promise that resolves when all (or specified topic's) in-flight operations complete.
   *
   * @example
   * ```typescript
   * await ctx.topics.subscribe("room:123");
   * // Maybe still in-flight; assert after settle:
   * await ctx.topics.settle("room:123", { timeoutMs: 5000 });
   * assert(ctx.topics.has("room:123"));
   * ```
   */
  async settle(
    topic?: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<void> {
    const signal = composeSignal(options?.signal, options?.timeoutMs);

    if (topic) {
      // Wait for a specific topic's in-flight operation
      const inFlight = this.inflight.get(topic);
      if (inFlight) {
        await awaitWithAbort(inFlight, signal);
      } else {
        // No in-flight operation, but check if signal is already aborted
        if (signal.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new AbortError();
        }
      }
      return;
    }

    // Wait for all in-flight operations
    const promises = Array.from(this.inflight.values());
    if (promises.length > 0) {
      await awaitWithAbort(Promise.all(promises), signal);
    } else {
      // No in-flight operations, but check if signal is already aborted
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new AbortError();
      }
    }
  }

  /**
   * Get detailed local subscription status (settled, pending, or absent).
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
  ): "settled" | "pending-subscribe" | "pending-unsubscribe" | "absent" {
    const inFlight = this.inflight.has(topic);
    const subscribed = this.subscriptions.has(topic);

    if (inFlight && subscribed) return "pending-subscribe";
    if (inFlight && !subscribed) return "pending-unsubscribe";
    if (subscribed) return "settled";
    return "absent";
  }

  /**
   * Probe the adapter for current subscription truth.
   *
   * Returns a discriminated union representing the adapter's view of subscription state.
   * If adapter doesn't support probing, behavior depends on mode:
   * - "strict": returns "unsupported"
   * - "best-effort": falls back to local has()
   *
   * @param topic - Topic to verify
   * @param options - Optional: mode ("strict" | "best-effort"), signal
   * @returns Promise<VerifyResult>:
   *   - { kind: "subscribed" }: adapter confirms subscribed
   *   - { kind: "unsubscribed" }: adapter confirms NOT subscribed
   *   - { kind: "unsupported" }: adapter lacks capability (strict mode)
   *   - { kind: "error"; cause }: transient error from adapter
   *   - { kind: "timeout" }: operation timed out
   */
  async verify(
    topic: string,
    options?: {
      mode?: "strict" | "best-effort";
      signal?: AbortSignal;
    },
  ): Promise<VerifyResult> {
    // Check if signal is already aborted
    if (options?.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new AbortError();
    }

    try {
      // Check if adapter has verification capability
      // Adapters expose either isSubscribed(clientId, topic) or hasTopic(topic, clientId)
      const wsAdapter = this.ws as unknown as {
        isSubscribed?: (clientId: string, topic: string) => Promise<boolean>;
        hasTopic?: (topic: string, clientId: string) => Promise<boolean>;
      };

      // Create a signal that combines user signal and timeout
      const verifySignal = composeSignal(options?.signal);

      // Try new API first
      if (typeof wsAdapter.isSubscribed === "function") {
        const result = await awaitWithAbort(
          wsAdapter.isSubscribed(this.clientId, topic),
          verifySignal,
        );
        return result ? { kind: "subscribed" } : { kind: "unsubscribed" };
      }

      // Fall back to legacy API
      if (typeof wsAdapter.hasTopic === "function") {
        const result = await awaitWithAbort(
          wsAdapter.hasTopic(topic, this.clientId),
          verifySignal,
        );
        return result ? { kind: "subscribed" } : { kind: "unsubscribed" };
      }

      // Adapter doesn't support verification
      if (options?.mode === "best-effort") {
        // Fall back to local state
        return this.subscriptions.has(topic)
          ? { kind: "subscribed" }
          : { kind: "unsubscribed" };
      }

      return { kind: "unsupported" };
    } catch (err) {
      // Distinguish timeout from other errors
      if (err instanceof AbortError) {
        return { kind: "timeout" };
      }
      return { kind: "error", cause: err };
    }
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Make subscriptions equal to the provided set.
   *
   * Computes the delta (topics to add and remove) and applies it in a single atomic operation.
   * Useful for syncing subscription state to a desired set.
   *
   * **Order of operations (normative):**
   * 1. Normalize and validate all desired topics
   * 2. Authorize all desired topics for subscription
   * 3. Compute delta: toAdd and toRemove
   * 4. Idempotency check: if both empty, return early
   * 5. Check topic limit: currentSize - removed + added <= maxTopicsPerConnection (docs/specs/pubsub.md#set-semantics)
   * 6. Adapter phase: call adapter for all changes (before mutation)
   * 7. Mutate state only after all adapter calls succeed
   * 8. Return counts
   *
   * **Fallback atomicity**: When the underlying WebSocket adapter doesn't support
   * atomic replace(), uses a per-connection lock to serialize the fallback diff + individual ops,
   * preventing race conditions with per-topic operations.
   * Order: unsubscribe first (free space) then subscribe (minimize message gaps).
   *
   * @param topics - Iterable of desired topic names
   * @param options - Optional: `signal` for cancellation support, `waitFor` for settlement semantics, `timeoutMs` for timeout
   * @returns { added, removed, total }
   * @throws PubSubError with code TOPIC_LIMIT_EXCEEDED if resulting size exceeds maxTopicsPerConnection,
   *                       or other codes if validation, authorization, or adapter fails
   * @throws {AbortError} if `signal` is aborted before commit (no state change)
   */
  async set(
    topics: Iterable<string>,
    options?: {
      signal?: AbortSignal;
      waitFor?: "optimistic" | "settled";
      timeoutMs?: number;
      verify?: VerifyMode;
    },
  ): Promise<{ added: number; removed: number; total: number }> {
    // Pre-commit cancellation: Check if signal is already aborted
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    // Step 1: Normalize and validate (normalization is middleware concern; use input directly)
    const topicsArray = Array.from(topics);
    const desiredTopics = new Set<string>(topicsArray); // Deduplicate input

    // Step 2: Validate all desired topics
    // Invariant: If validation fails here, nothing is changed.
    // Authorization is a middleware concern; skip here
    for (const topic of desiredTopics) {
      this.validateTopic(topic);
    }

    // Step 3: Compute delta
    // toAdd = topics not currently subscribed
    // toRemove = current topics not in desired set
    const toAdd = new Set<string>();
    const toRemove = new Set<string>();

    for (const topic of desiredTopics) {
      if (!this.subscriptions.has(topic)) {
        toAdd.add(topic);
      }
    }

    for (const topic of this.subscriptions) {
      if (!desiredTopics.has(topic)) {
        toRemove.add(topic);
      }
    }

    // Step 4: Idempotency check
    // If both delta sets are empty, return early (no-op, no adapter calls)
    if (toAdd.size === 0 && toRemove.size === 0) {
      return { added: 0, removed: 0, total: this.subscriptions.size };
    }

    // Step 5: Check topic limit before any adapter calls (docs/specs/pubsub.md#replace-semantics).
    // Verify: currentSize - removed + added <= maxTopicsPerConnection
    const resultingSize = this.subscriptions.size - toRemove.size + toAdd.size;
    if (resultingSize > this.maxTopicsPerConnection) {
      throw new PubSubError(
        "TOPIC_LIMIT_EXCEEDED",
        `Cannot replace: would exceed ${this.maxTopicsPerConnection} topics per connection`,
        {
          limit: this.maxTopicsPerConnection,
          current: this.subscriptions.size,
          toAdd: toAdd.size,
          toRemove: toRemove.size,
          resulting: resultingSize,
        },
      );
    }

    // Pre-commit cancellation: Check again before commit starts
    if (options?.signal?.aborted) {
      throw new AbortError();
    }

    // If adapter supports replace(), use it directly
    if (typeof this.ws.replace === "function") {
      return this.setWithAdapterSupport(
        toAdd,
        toRemove,
        options?.signal,
        options?.waitFor,
        options?.timeoutMs,
      );
    }

    // Fallback: use per-connection lock to serialize against per-topic ops
    return this.setWithFallback(
      toAdd,
      toRemove,
      options?.signal,
      options?.waitFor,
      options?.timeoutMs,
    );
  }

  /**
   * Set implementation when adapter natively supports replace().
   * Simpler path: optimistic local update + single adapter call.
   * Note: set operations are inherently atomic; waitFor/timeoutMs are accepted for API consistency.
   */
  private async setWithAdapterSupport(
    toAdd: Set<string>,
    toRemove: Set<string>,
    _signal?: AbortSignal,
    _confirm?: "optimistic" | "settled",
    _timeoutMs?: number,
  ): Promise<{ added: number; removed: number; total: number }> {
    const prev = new Set(this.subscriptions);

    // Optimistic local update
    for (const topic of toAdd) {
      this.subscriptions.add(topic);
    }
    for (const topic of toRemove) {
      this.subscriptions.delete(topic);
    }

    try {
      // Call adapter to replace subscriptions
      const replace = this.ws.replace as unknown as (
        topics: string[],
      ) => Promise<void>;
      await replace(Array.from(this.subscriptions));
    } catch (err) {
      // Rollback local state
      this.subscriptions.clear();
      for (const topic of prev) {
        this.subscriptions.add(topic);
      }
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to replace subscriptions`,
        { cause: err },
      );
    }

    return {
      added: toAdd.size,
      removed: toRemove.size,
      total: this.subscriptions.size,
    };
  }

  /**
   * Set implementation when adapter doesn't support replace().
   * Uses per-connection lock to prevent race conditions with per-topic ops.
   * Order: unsubscribe first (free space) then subscribe (minimize gaps).
   * Includes proper rollback with best-effort error recovery.
   * Note: set operations are inherently atomic; waitFor/timeoutMs are accepted for API consistency.
   */
  private async setWithFallback(
    toAdd: Set<string>,
    toRemove: Set<string>,
    signal?: AbortSignal,
    _confirm?: "optimistic" | "settled",
    _timeoutMs?: number,
  ): Promise<{ added: number; removed: number; total: number }> {
    // Wait for previous set operation to complete
    const prevSet = this.setQueue.current;
    let resolveSet!: () => void;
    const nextSet = new Promise<void>((r) => (resolveSet = r));
    this.setQueue.current = nextSet;

    try {
      await prevSet; // Wait for previous set to settle

      // Abort check after waiting
      if (signal?.aborted) {
        throw new AbortError();
      }

      // Stage local state optimistically; save for rollback
      const prev = new Set(this.subscriptions);
      for (const topic of toAdd) {
        this.subscriptions.add(topic);
      }
      for (const topic of toRemove) {
        this.subscriptions.delete(topic);
      }

      // Track successful operations for rollback
      const unsubscribedTopics = new Set<string>();
      const subscribedTopics = new Set<string>();

      try {
        // Fallback: call individual adapter methods in order (unsub first, then sub)
        // This order frees space before adding, reducing transient limit violations

        // Step 1: UNSUBSCRIBE FIRST (free up space)
        for (const topic of toRemove) {
          try {
            this.ws.unsubscribe(topic);
            unsubscribedTopics.add(topic);
          } catch (err) {
            throw new PubSubError(
              "ADAPTER_ERROR",
              `Failed to unsubscribe from topic "${topic}" during set`,
              err,
            );
          }
        }

        // Step 2: SUBSCRIBE SECOND (add new topics to freed space)
        for (const topic of toAdd) {
          try {
            this.ws.subscribe(topic);
            subscribedTopics.add(topic);
          } catch (err) {
            throw new PubSubError(
              "ADAPTER_ERROR",
              `Failed to subscribe to topic "${topic}" during set`,
              err,
            );
          }
        }
      } catch (err) {
        // ROLLBACK: Undo all successful adapter calls IN REVERSE ORDER
        const failedRollback = new Set<string>();

        // Rollback step 1: Unsubscribe newly-added topics (free space first)
        for (const topic of subscribedTopics) {
          try {
            this.ws.unsubscribe(topic);
          } catch {
            failedRollback.add(topic);
          }
        }

        // Rollback step 2: Re-subscribe removed topics (restore removed state)
        for (const topic of unsubscribedTopics) {
          try {
            this.ws.subscribe(topic);
          } catch {
            failedRollback.add(topic);
          }
        }

        // Rollback local state
        this.subscriptions.clear();
        for (const topic of prev) {
          this.subscriptions.add(topic);
        }

        throw new PubSubError("ADAPTER_ERROR", `Failed to set subscriptions`, {
          cause: err,
          rollbackFailed: failedRollback.size > 0,
          failedRollbackTopics: Array.from(failedRollback),
        });
      }

      return {
        added: toAdd.size,
        removed: toRemove.size,
        total: this.subscriptions.size,
      };
    } finally {
      resolveSet();
    }
  }

  /**
   * Validate topic format.
   *
   * If a custom validator is provided, uses it. Otherwise, uses default validation:
   * - Alphanumeric, colons, underscores, hyphens, dots, slashes
   * - Max 128 characters
   *
   * Custom validators are configured via router options (limits.topicPattern, limits.maxTopicLength)
   * and injected at TopicsImpl construction time.
   *
   * Validation errors MUST include `details.reason` field to classify the failure:
   * - "pattern": Topic format invalid (doesn't match pattern)
   * - "length": Topic exceeds max length
   * - Other reasons allowed for custom validators
   *
   * @param topic - Topic name to validate
   * @throws PubSubError with code "INVALID_TOPIC" and details.reason if validation fails
   */
  private validateTopic(topic: string): void {
    // If custom validator is provided, use it (it's responsible for error details.reason)
    if (this.customValidator) {
      this.customValidator(topic);
      return;
    }

    // Default validation with reason fields
    if (!topic || typeof topic !== "string") {
      throw new PubSubError(
        "INVALID_TOPIC",
        "Topic must be a non-empty string",
        { reason: "pattern" },
      );
    }

    if (topic.length > MAX_TOPIC_LENGTH) {
      throw new PubSubError(
        "INVALID_TOPIC",
        `Topic exceeds ${MAX_TOPIC_LENGTH} characters`,
        { reason: "length", length: topic.length, max: MAX_TOPIC_LENGTH },
      );
    }

    if (!DEFAULT_TOPIC_PATTERN.test(topic)) {
      throw new PubSubError(
        "INVALID_TOPIC",
        `Topic format invalid (allowed: a-z0-9:_-/.)`,
        { reason: "pattern", topic },
      );
    }
  }
}

/**
 * Create a topic validator from pattern and maxTopicLength options.
 *
 * Used by the router to inject custom validation into TopicsImpl instances.
 * The validator checks length first, then pattern, to ensure consistent error reporting.
 *
 * @param pattern - Regular expression to validate topic format
 * @param maxTopicLength - Maximum allowed topic length in characters
 * @returns Validator function that throws PubSubError on invalid topics
 *
 * @internal Used by router to create injected validators for TopicsImpl
 */
export function createTopicValidator(
  pattern?: RegExp,
  maxTopicLength?: number,
): TopicValidator | undefined {
  // If neither pattern nor maxTopicLength are customized, return undefined to use defaults
  if (!pattern && maxTopicLength === undefined) {
    return undefined;
  }

  // Use provided values or defaults
  const finalPattern = pattern ?? DEFAULT_TOPIC_PATTERN;
  const finalMaxLength = maxTopicLength ?? MAX_TOPIC_LENGTH;

  return (topic: string) => {
    // Basic type check (always enforced)
    if (!topic || typeof topic !== "string") {
      throw new PubSubError(
        "INVALID_TOPIC",
        "Topic must be a non-empty string",
        { reason: "pattern" },
      );
    }

    // Check length first (before pattern, for clear error reporting)
    if (topic.length > finalMaxLength) {
      throw new PubSubError(
        "INVALID_TOPIC",
        `Topic exceeds ${finalMaxLength} characters`,
        { reason: "length", length: topic.length, max: finalMaxLength },
      );
    }

    // Check pattern
    if (!finalPattern.test(topic)) {
      throw new PubSubError("INVALID_TOPIC", `Topic format invalid`, {
        reason: "pattern",
        topic,
      });
    }
  };
}
