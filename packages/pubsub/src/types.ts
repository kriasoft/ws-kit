// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Public type definitions for @ws-kit/pubsub
 */

import type {
  PublishCapability,
  PublishError,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core";
import { isPublishError } from "@ws-kit/core";
import type {
  BrokerConsumer,
  PubSubAdapter,
  PubSubDriver,
  PublishEnvelope,
  StopFn,
} from "@ws-kit/core/pubsub";
import {
  ensurePublishSuccess,
  isPublishSuccess,
  wasDeliveredLocally,
} from "@ws-kit/core/pubsub";
import type { VerifyMode, VerifyResult } from "./core/topics.js";

/**
 * Re-export core types and utilities for convenience.
 */
export type {
  BrokerConsumer,
  PubSubAdapter,
  PubSubDriver,
  PublishCapability,
  PublishEnvelope,
  PublishError,
  PublishOptions,
  PublishResult,
  StopFn,
  VerifyMode,
  VerifyResult,
};

/**
 * Type guards and assertion helpers for PublishResult.
 */
export {
  ensurePublishSuccess,
  isPublishError,
  isPublishSuccess,
  wasDeliveredLocally,
};

/**
 * Options for topic mutation operations (subscribe, unsubscribe, etc).
 * Supports cancellation via AbortSignal and settlement semantics.
 */
export interface TopicMutateOptions {
  /**
   * AbortSignal for cancellation.
   * If aborted before commit phase, operation rejects with AbortError and no state changes occur.
   * If aborted after commit begins, operation completes normally (late aborts ignored).
   */
  signal?: AbortSignal;

  /**
   * Wait for operation settlement semantics.
   * - "optimistic" (default): return immediately after local mutation and adapter enqueue
   * - "settled": wait for adapter settlement; respects timeoutMs and signal
   *
   * Use "settled" for tests and correctness-critical flows that require deterministic
   * settlement before proceeding. Note: "settled" means the operation completed locally
   * and the adapter processed it; use verify() to check adapter truth across failures/failovers.
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
  verify?: VerifyMode;
}

/**
 * Subscription state and operations.
 * Implements ReadonlySet<string> for .has(topic), .size, iteration.
 * All operations are idempotent and use optimistic local updates with rollback on adapter failure.
 */
export interface Topics extends ReadonlySet<string> {
  /**
   * Check if subscribed to a topic.
   * Returns optimistic local view (includes in-flight subscriptions).
   * Adapter may still reject pending operations.
   */
  has(topic: string): boolean;

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
  ): "settled" | "pending-subscribe" | "pending-unsubscribe" | "absent";

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
   * Make subscriptions equal to the provided set.
   * Idempotent: if input set equals current set, returns early (no adapter calls).
   *
   * **Order**: Unsubscribe first (free space) then subscribe (minimize message gaps).
   *
   * @param topics - Desired set of topics (will be deduplicated)
   * @param options - Optional: signal, confirm semantics, etc.
   * @returns { added, removed, total } - Counts of topics changed
   *
   * @example
   * ```typescript
   * // Sync subscription state to desired set
   * const result = await ctx.topics.set(["room:1", "room:2"]);
   * console.log(`Added ${result.added}, removed ${result.removed}`);
   * ```
   */
  set(
    topics: Iterable<string>,
    options?: TopicMutateOptions,
  ): Promise<{ added: number; removed: number; total: number }>;

  /**
   * Remove all current subscriptions.
   * Equivalent to `set([])`.
   *
   * @returns { removed } - Count of subscriptions removed
   */
  clear(options?: TopicMutateOptions): Promise<{ removed: number }>;

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
   * @param options - Optional: signal, confirm semantics, etc.
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
  update(
    mutator: (draft: Set<string>) => void,
    options?: TopicMutateOptions,
  ): Promise<{ added: number; removed: number; total: number }>;

  /**
   * Wait for all in-flight operations to settle.
   * Useful for tests and tooling: ensures all pending operations complete before assertion.
   *
   * **Note**: `has()` returns optimistic state; `settle()` ensures settlement.
   *
   * @param topic - Optional: wait for a specific topic's operations. If omitted, wait for all.
   * @param options - Optional: `timeoutMs` and `signal` for cancellation
   * @returns Promise that resolves when settlement is complete
   *
   * @example
   * ```typescript
   * await ctx.topics.subscribe("room:123");
   * // Maybe still in-flight; assert after settle:
   * await ctx.topics.settle("room:123", { timeoutMs: 5000 });
   * assert(ctx.topics.has("room:123"));
   * ```
   */
  settle(
    topic?: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<void>;

  /**
   * Probe the adapter for current subscription truth.
   *
   * **Key difference from localStatus()**: localStatus() reflects local settlement state;
   * verify() checks adapter truth (useful after failures/failovers or for correctness checks).
   *
   * Returns a discriminated union representing different verification outcomes, allowing
   * precise error handling (retry on error/timeout, fallback on unsupported, etc).
   *
   * @param topic - Topic to verify
   * @param options - Optional: bestEffort (fall back to local has() if capability missing),
   *                  signal (abort)
   * @returns Promise<VerifyResult>
   *   - { kind: "subscribed" }: adapter confirms this connection is subscribed
   *   - { kind: "unsubscribed" }: adapter confirms this connection is NOT subscribed
   *   - { kind: "unsupported" }: adapter lacks verification capability
   *   - { kind: "error"; cause }: transient error from adapter (may retry)
   *   - { kind: "timeout" }: operation timed out
   * @throws AbortError if signal aborts
   *
   * @example
   * ```typescript
   * // Check if subscription is confirmed by the adapter
   * const result = await ctx.topics.verify("room:123");
   * if (isSubscribed(result)) {
   *   console.log("Adapter confirms subscription");
   * } else if (result.kind === "unsubscribed") {
   *   console.log("Adapter confirms NOT subscribed");
   * } else if (result.kind === "unsupported") {
   *   // Fallback to local state
   *   console.log("Subscribed locally:", ctx.topics.has("room:123"));
   * } else if (result.kind === "error") {
   *   console.error("Verification failed:", result.cause);
   * } else {
   *   console.error("Verification timed out");
   * }
   * ```
   */
  verify(
    topic: string,
    options?: {
      mode?: VerifyMode;
      signal?: AbortSignal;
    },
  ): Promise<VerifyResult>;
}

/**
 * Note: PublishOptions is re-exported from @ws-kit/core/pubsub above.
 * Controls distribution logic only: partitionKey (sharding), excludeSelf (filter),
 * signal (cancellation). Message metadata belongs in the envelope, not options.
 */

/**
 * Observe pub/sub operations for testing and instrumentation.
 *
 * @example
 * ```ts
 * const observer = {
 *   onPublish(rec) { console.log(`Published to ${rec.topic}`); },
 *   onSubscribe(info) { console.log(`Client ${info.clientId} subscribed to ${info.topic}`); },
 *   onUnsubscribe(info) { console.log(`Client ${info.clientId} unsubscribed from ${info.topic}`); },
 * };
 *
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter, observer }));
 *
 * // For pre-built routers, tap into observations post-hoc:
 * if (router.pubsub?.tap) {
 *   router.pubsub.tap(observer);
 * }
 * ```
 *
 * @internal
 */
export interface PubSubObserver {
  /**
   * Fired after a message is successfully published to a topic.
   * This event is emitted after the adapter returns, not before.
   */
  onPublish?: (record: {
    /** Topic name */
    topic: string;
    /** Message type/schema name */
    type?: string;
    /** Payload object */
    payload: unknown;
    /** Optional metadata from the message */
    meta: Record<string, unknown> | undefined;
    /** Timestamp of the publish operation */
    timestamp: number;
  }) => void | Promise<void>;

  /**
   * Fired after a client successfully subscribes to a topic.
   */
  onSubscribe?: (info: {
    /** Client ID */
    clientId: string;
    /** Topic name */
    topic: string;
    /** Timestamp of the operation */
    timestamp: number;
  }) => void | Promise<void>;

  /**
   * Fired after a client successfully unsubscribes from a topic.
   */
  onUnsubscribe?: (info: {
    /** Client ID */
    clientId: string;
    /** Topic name */
    topic: string;
    /** Timestamp of the operation */
    timestamp: number;
  }) => void | Promise<void>;
}

/**
 * Configuration options for withPubSub() plugin.
 *
 * Can be used with overloads for backward compatibility:
 * ```ts
 * // Old style (still supported)
 * withPubSub(adapter)
 * withPubSub(adapter, { observer, limits: { ... } })
 *
 * // New style (recommended)
 * withPubSub({ adapter, observer, limits: { ... } })
 * ```
 */
export interface WithPubSubOptions {
  /** PubSub adapter (memory, redis, custom, etc.) */
  adapter: PubSubAdapter;

  /**
   * Optional observer for pub/sub operations (testing, instrumentation).
   * Observers are called after operations complete successfully.
   */
  observer?: PubSubObserver;

  /**
   * Per-connection limits and constraints.
   */
  limits?: {
    /** Maximum number of topics a single client can subscribe to (optional). */
    maxTopicsPerConn?: number;
  };

  /**
   * Topic validation and normalization rules.
   */
  topic?: {
    /**
     * Normalize topic names before use (e.g., lowercase, trim).
     * Applied before validation and subscription.
     */
    normalize?: (topic: string) => string;

    /**
     * Validate topic names; throw or return void to deny.
     * Applied after normalization.
     */
    validate?: (topic: string) => void;
  };

  /**
   * Message delivery behavior and defaults.
   */
  delivery?: {
    /**
     * Default value for excludeSelf option in publish calls (future).
     * Currently excludeSelf returns UNSUPPORTED; this will be the default when implemented.
     */
    excludeSelfDefault?: boolean;
  };
}

/**
 * Policy hooks for pub/sub operations.
 * Used by middleware to apply normalization and authorization.
 */
export interface PubSubPolicyHooks<TContext> {
  /**
   * Normalize a topic name before use (e.g., lowercase, trim whitespace).
   * If not provided, topics are used as-is.
   */
  normalizeTopic?: (
    topic: string,
    ctx: { clientId: string; data: TContext },
  ) => string;

  /**
   * Authorize a subscription or publish operation.
   * If not provided, all operations are allowed.
   * Throw an error to deny the operation.
   */
  authorize?: (
    action: "subscribe" | "unsubscribe" | "publish",
    topic: string,
    ctx: { clientId: string; data: TContext },
  ) => Promise<void> | void;
}

/**
 * Pub/Sub plugin capability marker.
 * Added to context type when withPubSub() plugin is applied.
 * Used for capability-gating in the type system.
 *
 * @internal
 */
export interface WithPubSubCapability {
  /**
   * Marker for capability-gating in Router type system.
   * Ensures publish() and topics only appear in keyof when withPubSub() is applied.
   * @internal
   */
  readonly pubsub: true;
}
