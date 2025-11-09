// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { PubSubError } from "./pubsub-error.js";
import type { ServerWebSocket, Topics, WebSocketData } from "./types.js";

/**
 * Default topic validation pattern.
 *
 * Allows alphanumeric, colons, underscores, hyphens. Max 128 chars.
 * Per spec § 5 (Hooks): /^[a-z0-9:_\-]{1,128}$/i
 *
 * This is the default; apps can override via usePubSub() middleware.
 */
const DEFAULT_TOPIC_PATTERN = /^[a-z0-9:_\-]+$/i;
const MAX_TOPIC_LENGTH = 128;

/**
 * Default implementation of the Topics interface.
 *
 * Provides per-connection topic subscription state and operations.
 * Wraps the platform adapter's WebSocket.subscribe/unsubscribe methods.
 *
 * **Idempotency**: subscribe/unsubscribe calls are safe to repeat.
 * **Batch atomicity**: subscribeMany/unsubscribeMany validate all before mutating.
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

  [Symbol.iterator](): IterableIterator<string> {
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
    // Early membership check (idempotency → soft no-op)
    // If not subscribed, return successfully without validation or hooks
    if (!this.subscriptions.has(topic)) {
      return;
    }

    // If subscribed, validate topic format before mutating
    this.validateTopic(topic);

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

  async subscribeMany(
    topics: Iterable<string>,
  ): Promise<{ added: number; total: number }> {
    const topicArray = Array.from(topics);
    const newTopics = new Set<string>();

    // Step 1: Validate all topics BEFORE mutating any state (atomic)
    for (const topic of topicArray) {
      this.validateTopic(topic);
      newTopics.add(topic); // Deduplicate
    }

    // Step 2: Subscribe each topic (idempotent per topic)
    let added = 0;
    const failed: string[] = [];

    for (const topic of newTopics) {
      if (!this.subscriptions.has(topic)) {
        try {
          this.subscriptions.add(topic);
          this.ws.subscribe(topic);
          added++;
        } catch (err) {
          failed.push(topic);
        }
      }
    }

    // If any subscriptions failed, attempt rollback and throw
    if (failed.length > 0) {
      for (const topic of newTopics) {
        if (this.subscriptions.has(topic)) {
          this.subscriptions.delete(topic);
          try {
            this.ws.unsubscribe(topic);
          } catch {
            // Ignore rollback errors; state is already inconsistent
          }
        }
      }
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to subscribe to ${failed.length} topic(s): ${failed.join(", ")}`,
        { failed },
      );
    }

    return { added, total: this.subscriptions.size };
  }

  async unsubscribeMany(
    topics: Iterable<string>,
  ): Promise<{ removed: number; total: number }> {
    const topicArray = Array.from(topics);
    const uniqueTopics = new Set<string>(topicArray); // Deduplicate input

    let removed = 0;
    const failed: string[] = [];

    // Unsubscribe each topic (soft no-op for non-subscribed, validate if subscribed)
    for (const topic of uniqueTopics) {
      if (this.subscriptions.has(topic)) {
        try {
          // Validate topic before mutating (only when subscribed)
          this.validateTopic(topic);
          this.subscriptions.delete(topic);
          this.ws.unsubscribe(topic);
          removed++;
        } catch (err) {
          failed.push(topic);
        }
      }
    }

    // If any unsubscriptions failed, attempt rollback and throw
    if (failed.length > 0) {
      for (const topic of uniqueTopics) {
        if (!this.subscriptions.has(topic)) {
          this.subscriptions.add(topic);
          try {
            this.ws.subscribe(topic);
          } catch {
            // Ignore rollback errors
          }
        }
      }
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to unsubscribe from ${failed.length} topic(s): ${failed.join(", ")}`,
        { failed },
      );
    }

    return { removed, total: this.subscriptions.size };
  }

  async clear(): Promise<{ removed: number }> {
    const removed = this.subscriptions.size;
    const topicArray = Array.from(this.subscriptions);

    try {
      for (const topic of topicArray) {
        this.ws.unsubscribe(topic);
      }
      this.subscriptions.clear();
    } catch (err) {
      // Rollback: re-add all topics (best effort)
      for (const topic of topicArray) {
        this.subscriptions.add(topic);
        try {
          this.ws.subscribe(topic);
        } catch {
          // Ignore rollback errors
        }
      }
      throw new PubSubError(
        "ADAPTER_ERROR",
        `Failed to clear subscriptions`,
        err,
      );
    }

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
        `Topic format invalid (allowed: a-z0-9:_-)`,
        { topic },
      );
    }
  }
}
