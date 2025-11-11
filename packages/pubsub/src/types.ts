// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Public type definitions for @ws-kit/pubsub
 */

import type {
  PubSubAdapter,
  BrokerConsumer,
  PubSubDriver,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
  StopFn,
  AdapterPublishError,
  RouterPublishError,
  PublishError,
  PublishCapability,
} from "@ws-kit/core/pubsub";

/**
 * Re-export core types for convenience.
 */
export type {
  PubSubAdapter,
  BrokerConsumer,
  PubSubDriver,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
  StopFn,
  AdapterPublishError,
  RouterPublishError,
  PublishError,
  PublishCapability,
};

/**
 * Options for topic mutation operations (subscribe, unsubscribe, etc).
 * Supports cancellation via AbortSignal.
 */
export interface TopicMutateOptions {
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
export interface Topics extends ReadonlySet<string> {
  /**
   * Subscribe to a topic.
   * Idempotent: subscribing twice to the same topic is a no-op (no error).
   * Throws on validation, authorization, or connection failure.
   */
  subscribe(topic: string, options?: TopicMutateOptions): Promise<void>;

  /**
   * Unsubscribe from a topic.
   * Idempotent: unsubscribing twice or from non-existent topic is a no-op.
   * Throws only on authorization or adapter failure (rare).
   */
  unsubscribe(topic: string, options?: TopicMutateOptions): Promise<void>;

  /**
   * Subscribe to multiple topics in one atomic operation.
   * All succeed or all fail; no partial state changes.
   * Returns count of newly added subscriptions and total subscriptions.
   */
  subscribeMany(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
  ): Promise<{ added: number; total: number }>;

  /**
   * Unsubscribe from multiple topics atomically.
   * Returns count of removed and remaining subscriptions.
   */
  unsubscribeMany(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
  ): Promise<{ removed: number; total: number }>;

  /**
   * Remove all current subscriptions.
   * Returns count of removed subscriptions.
   */
  clear(options?: TopicMutateOptions): Promise<{ removed: number }>;

  /**
   * Atomically replace current subscriptions with a desired set.
   * Idempotent: if input set equals current set, returns early (no adapter calls).
   * Returns counts of topics added, removed, and total subscriptions after operation.
   */
  replace(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
  ): Promise<{ added: number; removed: number; total: number }>;
}

/**
 * Note: PublishOptions is re-exported from @ws-kit/core/pubsub above.
 * Controls distribution logic only: partitionKey (sharding), excludeSelf (filter),
 * signal (cancellation). Message metadata belongs in the envelope, not options.
 */

/**
 * Policy hooks for pub/sub operations.
 * Used by middleware to apply normalization and authorization.
 */
export interface PubSubPolicyHooks<TConn> {
  /**
   * Normalize a topic name before use (e.g., lowercase, trim whitespace).
   * If not provided, topics are used as-is.
   */
  normalizeTopic?: (
    topic: string,
    ctx: { clientId: string; data: TConn },
  ) => string;

  /**
   * Authorize a subscription or publish operation.
   * If not provided, all operations are allowed.
   * Throw an error to deny the operation.
   */
  authorize?: (
    action: "subscribe" | "unsubscribe" | "publish",
    topic: string,
    ctx: { clientId: string; data: TConn },
  ) => Promise<void> | void;
}
