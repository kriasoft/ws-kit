// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Public type definitions for @ws-kit/pubsub
 */

import type {
  PubSubAdapter as CorePubSubAdapter,
  PubSubMessage as CorePubSubMessage,
  MessageDescriptor,
  MinimalContext,
} from "@ws-kit/core";

/**
 * Re-export core types for convenience.
 */
export type {
  CorePubSubAdapter as PubSubAdapter,
  CorePubSubMessage as PubSubMessage,
  MinimalContext,
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
 * Options for publishing a message.
 */
export interface PublishOptions {
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
   * Exclude the sender from receiving the published message.
   * Note: Not yet implemented in all adapters; portable pattern is to include
   * sender identity in payload and filter on subscriber side.
   */
  excludeSelf?: boolean;
}

/**
 * Result of a publish operation.
 */
export interface PublishResult {
  /**
   * Whether the adapter successfully handled the publish request.
   */
  ok: boolean;

  /**
   * If ok=false, the error code or message.
   */
  error?: string;

  /**
   * Approximate subscriber count (if known by adapter).
   */
  subscribers?: number;
}

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
