// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { PubSubError } from "./pubsub-error.js";
import type { ServerWebSocket, Topics } from "./types.js";

/**
 * Default topic validation pattern.
 *
 * Allows alphanumeric, colons, underscores, hyphens, dots, slashes. Max 128 chars.
 * Per spec § 5 (Hooks): /^[a-z0-9:_\-/.]{1,128}$/i
 *
 * This is the default; apps can override via usePubSub() middleware.
 */
const DEFAULT_TOPIC_PATTERN = /^[a-z0-9:_\-/.]{1,128}$/i;
const MAX_TOPIC_LENGTH = 128;

/**
 * Default implementation of the Topics interface.
 *
 * Provides per-connection topic subscription state and operations.
 * Wraps the platform adapter's WebSocket.subscribe/unsubscribe methods.
 *
 * **Atomic batch operations**: subscribeMany/unsubscribeMany follow strict 3-phase pattern:
 * 1. Validate all topics (no state mutation, no adapter calls)
 * 2. Call adapter for all topics (no state mutation yet; if any fails, stop here)
 * 3. Mutate internal state (only after all adapters succeed)
 * This guarantees true all-or-nothing semantics per spec § 6.3 & § 12.
 *
 * **Normalization contract**: Topics are expected to be pre-normalized by the caller
 * (e.g., via usePubSub() middleware). This class performs validation but not normalization.
 * See pubsub.md § 6.1 for the full operation order.
 *
 * **Idempotency**: Single subscribe/unsubscribe calls are idempotent (safe to repeat).
 *
 * **Error semantics**: Throws PubSubError on validation, authorization, or adapter failure.
 *
 * @template TData - Connection data type
 */
export class TopicsImpl<
  TData extends { clientId: string } = { clientId: string },
> implements Topics
{
  private readonly subscriptions = new Set<string>();
  private readonly ws: ServerWebSocket<TData>;

  constructor(ws: ServerWebSocket<TData>) {
    this.ws = ws;

    // Ensure Topics instance is immutable at runtime (spec § 9. Topics Invariants).
    // Callers MUST NOT attempt to mutate this object or its properties.
    Object.freeze(this);
  }

  // ============================================================================
  // ReadonlySet<string> Implementation
  // ============================================================================

  has(topic: string): boolean {
    return this.subscriptions.has(topic);
  }

  get size(): number {
    return this.subscriptions.size;
  }

  forEach(
    callback: (value: string, key: string, set: Set<string>) => void,
    thisArg?: unknown,
  ): void {
    this.subscriptions.forEach(callback, thisArg);
  }

  entries(): SetIterator<[string, string]> {
    return this.subscriptions.entries();
  }

  keys(): SetIterator<string> {
    return this.subscriptions.keys();
  }

  values(): SetIterator<string> {
    return this.subscriptions.values();
  }

  [Symbol.iterator](): SetIterator<string> {
    return this.subscriptions[Symbol.iterator]();
  }

  [Symbol.toStringTag] = "Topics";

  // ============================================================================
  // Topic Subscription Operations
  // ============================================================================

  async subscribe(topic: string): Promise<void> {
    // Normalize (none by default; apps use usePubSub() middleware)
    // Validate
    this.validateTopic(topic);

    // Idempotency: already subscribed? → no-op
    if (this.subscriptions.has(topic)) {
      return;
    }

    // Mutate state
    this.subscriptions.add(topic);

    // Delegate to platform adapter
    try {
      this.ws.subscribe(topic);
    } catch (err) {
      // Rollback on adapter error
      this.subscriptions.delete(topic);
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to subscribe to topic "${topic}"`,
        err,
      );
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    // Normalize (none by default; apps use usePubSub() middleware)
    // Validate - always validate, even if not subscribed (per spec § 6.2)
    this.validateTopic(topic);

    // Idempotency: not subscribed? → no-op (no error thrown)
    if (!this.subscriptions.has(topic)) {
      return;
    }

    // Mutate state
    this.subscriptions.delete(topic);

    // Delegate to platform adapter
    try {
      this.ws.unsubscribe(topic);
    } catch (err) {
      // Rollback on adapter error
      this.subscriptions.add(topic);
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to unsubscribe from topic "${topic}"`,
        err,
      );
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
   * @returns { added, total } where added = newly subscribed topics, total = all subscriptions
   * @throws {PubSubError} if any topic fails validation or adapter call
   */
  async subscribeMany(
    topics: Iterable<string>,
  ): Promise<{ added: number; total: number }> {
    const topicArray = Array.from(topics);
    const newTopics = new Set<string>(topicArray); // Deduplicate input

    // PHASE 1: Validate all topics BEFORE any state mutation or adapter calls.
    // Invariant: If validation fails here, nothing is changed (no adapter calls, no state mutation).
    for (const topic of newTopics) {
      this.validateTopic(topic);
    }

    // PHASE 2: Call adapter for all non-subscribed topics.
    // Invariant: If any adapter call fails here, state is unchanged (we haven't mutated yet).
    // This is the key to atomicity: adapter calls happen before state mutation.
    try {
      for (const topic of newTopics) {
        if (!this.subscriptions.has(topic)) {
          this.ws.subscribe(topic); // May throw; internal state unchanged
        }
      }
    } catch (err) {
      // Adapter failure: state never mutated, so we can safely throw without cleanup.
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to subscribe to topic(s)`,
        err,
      );
    }

    // PHASE 3: Mutate internal state only after all adapter calls succeed.
    // Invariant: We only reach here if all validations and adapter calls succeeded.
    // This guarantees atomicity: either all topics are subscribed or none are.
    let added = 0;
    for (const topic of newTopics) {
      if (!this.subscriptions.has(topic)) {
        this.subscriptions.add(topic);
        added++;
      }
    }

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
   * @returns { removed, total } where removed = actually-unsubscribed topics, total = remaining subscriptions
   * @throws {PubSubError} if any subscribed topic fails validation or adapter call
   */
  async unsubscribeMany(
    topics: Iterable<string>,
  ): Promise<{ removed: number; total: number }> {
    const topicArray = Array.from(topics);
    const uniqueTopics = new Set<string>(topicArray); // Deduplicate input

    // PHASE 1: Identify subscribed topics only (soft no-op for non-subscribed).
    // Invariant: Topics not in current subscriptions are ignored (per spec § 6.2).
    // This means: no validation errors for non-subscribed topics, no adapter calls for them.
    const subscribedTopics = new Set<string>();
    for (const topic of uniqueTopics) {
      if (this.subscriptions.has(topic)) {
        subscribedTopics.add(topic);
      }
    }

    // PHASE 2: Validate only subscribed topics.
    // Invariant: Non-subscribed topics skip validation (soft no-op semantics).
    // If validation fails here, nothing is changed (no adapter calls, no state mutation).
    for (const topic of subscribedTopics) {
      this.validateTopic(topic);
    }

    // PHASE 3: Call adapter for all subscribed topics.
    // Invariant: If any adapter call fails here, state is unchanged (we haven't mutated yet).
    // This is the key to atomicity: adapter calls happen before state mutation.
    try {
      for (const topic of subscribedTopics) {
        this.ws.unsubscribe(topic); // May throw; internal state unchanged
      }
    } catch (err) {
      // Adapter failure: state never mutated, so we can safely throw without cleanup.
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to unsubscribe from topic(s)`,
        err,
      );
    }

    // PHASE 4: Mutate internal state only after all adapter calls succeed.
    // Invariant: We only reach here if all validations and adapter calls succeeded.
    // This guarantees atomicity: either all subscribed topics are removed or none are.
    let removed = 0;
    for (const topic of subscribedTopics) {
      this.subscriptions.delete(topic);
      removed++;
    }

    return { removed, total: this.subscriptions.size };
  }

  /**
   * Remove all current subscriptions atomically.
   *
   * **Atomicity guarantee**: All subscriptions succeed in being removed or all fail.
   * If any adapter call fails, the connection state is unchanged.
   *
   * @returns { removed } - Count of subscriptions that were removed
   * @throws {PubSubError} if any adapter call fails
   */
  async clear(): Promise<{ removed: number }> {
    const removed = this.subscriptions.size;
    const topicArray = Array.from(this.subscriptions);

    // PHASE 1: Call adapter to unsubscribe from all topics.
    // Invariant: If any adapter call fails here, state is unchanged (we haven't mutated yet).
    // This is the key to atomicity: adapter calls happen before state mutation.
    try {
      for (const topic of topicArray) {
        this.ws.unsubscribe(topic); // May throw; internal state unchanged
      }
    } catch (err) {
      // Adapter failure: state never mutated, so we can safely throw without cleanup.
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to clear subscriptions`,
        err,
      );
    }

    // PHASE 2: Mutate internal state only after all adapter calls succeed.
    // Invariant: We only reach here if all adapter calls succeeded.
    // This guarantees atomicity: either all subscriptions are cleared or none are.
    this.subscriptions.clear();

    return { removed };
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate topic format.
   *
   * Default validation: alphanumeric, colons, underscores, hyphens. Max 128 chars.
   * This can be customized via usePubSub() middleware (future).
   *
   * @param topic - Topic name to validate
   * @throws PubSubError if validation fails
   */
  private validateTopic(topic: string): void {
    if (!topic || typeof topic !== "string") {
      throw new PubSubError(
        "INVALID_TOPIC",
        "Topic must be a non-empty string",
      );
    }

    if (topic.length > MAX_TOPIC_LENGTH) {
      throw new PubSubError(
        "INVALID_TOPIC",
        `Topic exceeds ${MAX_TOPIC_LENGTH} characters`,
        { length: topic.length, max: MAX_TOPIC_LENGTH },
      );
    }

    if (!DEFAULT_TOPIC_PATTERN.test(topic)) {
      throw new PubSubError(
        "INVALID_TOPIC",
        `Topic format invalid (allowed: a-z0-9:_-/.)`,
        { topic },
      );
    }
  }
}
