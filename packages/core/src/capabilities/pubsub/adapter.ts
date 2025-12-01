// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PublishOptions, PublishResult } from "../../core/types.js";

/**
 * Pub/Sub adapter contract (core-level).
 * Unified interface for subscription index, local fan-out, and optional distributed ingress.
 * Implementations: in-memory, Redis, Kafka, Cloudflare DO, etc.
 *
 * # Design Philosophy
 *
 * **One public interface, optional lifecycle.**
 * - PubSubAdapter is the _only_ interface applications and routers speak to
 * - start?(onRemote) is optional; memory adapters omit it entirely (zero boilerplate)
 * - Distributed adapters implement start() to wire broker consumption
 * - Internal: adapters can compose split concerns (driver + consumer) via withBroker() helper
 *
 * **Adapter Responsibilities (Local)**:
 * - Manage per-client topic subscriptions (subscribe, unsubscribe, subscribeMany, etc.)
 * - Broadcast router-materialized messages to matching subscribers (publish)
 * - Return publish stats (matchedLocal, capability)
 * - Optional: query active topics (listTopics, hasTopic)
 * - Optional: atomic subscription replacement (replace)
 * - Optional: cleanup on shutdown (close)
 *
 * **Router/Platform Responsibilities (Integration)**:
 * - Track connected clients via onOpen/onClose lifecycle hooks (plugin does this)
 * - Deliver messages to WebSocket clients via adapter.getSubscribers() (plugin does this)
 * - Call adapter.start?(onRemote) if present, wiring remote ingress to local delivery
 * - Handle validation, schema registration, message materialization
 * - Enforce policies and authorization via middleware
 *
 * # Design Rationale
 *
 * ## Unified Surface with Optional Lifecycle
 * Why: Eliminates "two disjoint pieces" problem. Users/routers see one thing.
 * Memory adapters skip start() entirely (no ingress needed).
 * Distributed adapters include it to attach broker consumption.
 * Plugin unconditionally calls start?(...) if present; no conditional wiring in user code.
 *
 * ## Composition for Advanced Use Cases
 * Why: Preserve modularity internally without exposing complexity to users.
 * withBroker(driver, consumer?) lets adapter authors split concerns locally.
 * combineBrokers(...) enables multi-broker scenarios (Redis + Kafka replay) cleanly.
 *
 * ## Bulk Operations (subscribeMany, unsubscribeMany, replace)
 * Why: Efficiency and atomicity for multi-topic operations.
 * Single-op loops risk partial state; bulk ops provide all-or-nothing semantics.
 * Optional: adapters can optimize (e.g., Redis pipelines) or default to single loops.
 *
 * ## Envelope Separates Data from Options
 * Why: Cleanly separates "what to broadcast" from "how to broadcast it".
 * Envelope = message data (topic, payload, meta). Options = distribution logic (partitionKey).
 * Payload already validated by router; adapter doesn't need schema descriptor.
 *
 * ## publish() Returns PublishResult (Never Throws for Runtime Conditions)
 * Why: Consistent return type for all outcomes. Success/failure discriminated union.
 * Allows predictable error handling, retry logic, and observability.
 * Throw only for invariants (adapter not ready, internal crashes).
 *
 * ## subscribe/unsubscribe are Idempotent (Promise<void>)
 * Why: Calling twice is safe (no error, no flag). Simplifies error recovery.
 * Throw only on real adapter failure (connection, quota, auth).
 *
 * # Initialization Timing Contract
 *
 * **Platform MUST call router.pubsub.init() after routes are registered and before accepting traffic.**
 * This ensures:
 * - Routes/handlers are ready for incoming messages
 * - Broker consumer doesn't start before handlers
 * - No race conditions on subscription setup
 *
 * Timeline:
 * 1. Create router and register routes/handlers
 * 2. Apply pubsub plugin: router.plugin(withPubSub({ adapter }))
 * 3. Call router.pubsub.init() — starts broker consumer if present
 * 4. Accept external connections
 * 5. On shutdown: call router.pubsub.shutdown() — stops consumer and closes adapter
 *
 * See docs/specs/pubsub.md for detailed semantics and examples.
 */

/**
 * Publish envelope: validated message ready to broadcast.
 *
 * Router owns validation; adapter just fans out to subscribers.
 * Envelope = the message data itself. Options (sharding, confirmLocal, etc.)
 * are separate to keep this focused on "what to broadcast".
 */
export interface PublishEnvelope {
  /**
   * Topic name (pre-validated by router).
   */
  topic: string;

  /**
   * Payload: already validated by router against schema.
   * Unknown type; safe to pass through adapters.
   */
  payload: unknown;

  /**
   * Optional schema type name (for observability/telemetry).
   * Router includes this if available; adapter uses for logging/routing hints.
   */
  type?: string;

  /**
   * Optional metadata: observability, routing hints, etc.
   */
  meta?: Record<string, unknown>;
}

// Import canonical types from router layer (single source of truth)
export type {
  PublishCapability,
  PublishError,
  PublishOptions,
  PublishResult,
} from "../../core/types.js";

/**
 * For adapter implementations that need to store intermediate state or map
 * internal errors to canonical PublishError codes.
 *
 * @internal Use only in adapter implementations; never export publicly.
 */
export const PUBLISH_ERROR_RETRYABLE: Record<string, boolean> = {
  // Canonical error codes from core/types.ts
  VALIDATION: false, // Won't succeed on retry
  ACL_PUBLISH: false, // Authorization won't change
  STATE: false, // Router/adapter not ready
  BACKPRESSURE: true, // Queue might clear
  PAYLOAD_TOO_LARGE: false, // Size limit won't change
  UNSUPPORTED: false, // Feature won't appear
  CONNECTION_CLOSED: true, // Retryable after reconnection
  ADAPTER_ERROR: true, // Infrastructure might recover
};

/**
 * Type alias for split driver implementations.
 * Internal: used by adapter authors for modularity (e.g., memory, Redis driver).
 * External: compose via withBroker() to create unified PubSubAdapter.
 */
export interface PubSubDriver {
  publish(
    envelope: PublishEnvelope,
    opts?: PublishOptions,
  ): Promise<PublishResult>;
  subscribe(clientId: string, topic: string): Promise<void>;
  unsubscribe(clientId: string, topic: string): Promise<void>;
  getSubscribers(topic: string): AsyncIterable<string>;
  replace?(
    clientId: string,
    topics: Iterable<string>,
  ): Promise<{ added: number; removed: number; total: number }>;
  listTopics?(): Promise<readonly string[]>;
  hasTopic?(topic: string): Promise<boolean>;
  close?(): Promise<void>;
}

/**
 * Teardown function type: stop/cleanup helper.
 * Can be sync or async (e.g., closing connections, flushing buffers).
 */
export type StopFn = () => void | Promise<void>;

/**
 * Unified Pub/Sub adapter: subscription index + local fan-out + optional distributed ingress.
 *
 * **The only interface routers and applications speak to.**
 * Clean, lean surface: no split concerns exposed to users.
 *
 * **For simple adapters** (memory): Implement all required methods, omit start() (no ingress).
 * **For distributed adapters** (Redis, Kafka, DO): Implement required + start(onRemote)
 * to wire broker consumption into local delivery.
 *
 * **Responsibility (Local)**:
 * - Manage per-client topic subscriptions
 * - Broadcast router-materialized messages to matching subscribers
 * - Return structured results: success with capability + matched (if knowable), or failure with error code
 * - Optional: atomically replace subscriptions, enumerate topics, cleanup resources
 *
 * **Router's Responsibility (Integration)**:
 * - Call adapter.start?(onRemote) if present, wiring remote messages into router
 * - Handle message validation, schema registration, materialization
 * - Deliver to WebSocket clients via adapter.getSubscribers()
 */
export interface PubSubAdapter {
  /**
   * Broadcast a message to subscribers of a topic.
   *
   * **Never throws for runtime conditions** (backpressure, unavailability, etc).
   * Returns discriminated union result: `{ok: true, capability, matched?, details?}`
   * on success, or `{ok: false, error, retryable, details?}` on failure.
   *
   * **Success (`ok: true`):**
   * - `capability`: "exact", "estimate", or "unknown" (trustworthiness of `matched` field)
   * - `matched`: Subscriber count (present only if capability is not "unknown")
   * - `details`: Adapter-specific telemetry (shard ID, partition, timings, etc.)
   *
   * **Failure (`ok: false`):**
   * - `error`: Canonical error code from PublishError enum
   * - `retryable`: true if safe to retry with backoff, false if permanent
   * - `adapter`: Adapter name (for diagnostics)
   * - `details`: Context (limits, features, diagnostics)
   * - `cause`: Underlying error cause (if applicable)
   *
   * Throw only for invariant violations (adapter not initialized, internal crashes).
   * If topic has no subscribers, return `{ok: true, capability: "exact", matched: 0}`.
   *
   * @param envelope - Router-materialized: { topic, payload, type?, meta? }
   * @param opts - Publication options (partitionKey, excludeSelf, etc.)
   * @returns PublishResult: success or failure with structured semantics and retry hints
   * @throws Only on invariant/adapter-internal violations
   */
  publish(
    envelope: PublishEnvelope,
    opts?: PublishOptions,
  ): Promise<PublishResult>;

  /**
   * Subscribe a client to a topic.
   * Idempotent: calling twice is safe (no error).
   *
   * Throw only on real adapter failure.
   *
   * @param clientId - Unique connection identifier
   * @param topic - Topic name (pre-validated by router)
   * @throws On adapter failure
   */
  subscribe(clientId: string, topic: string): Promise<void>;

  /**
   * Unsubscribe a client from a topic.
   * Idempotent: calling for non-subscribed topic is safe (no error).
   *
   * Throw only on real adapter failure.
   *
   * @param clientId - Unique connection identifier
   * @param topic - Topic name
   * @throws On adapter failure
   */
  unsubscribe(clientId: string, topic: string): Promise<void>;

  /**
   * Get local subscribers for a topic as an async iterable.
   * Router uses this to stream messages to subscribers with backpressure support.
   *
   * Implementations should yield subscriber IDs lazily to avoid materializing
   * large subscriber lists. Router iterates and applies per-subscriber backpressure.
   *
   * @param topic - Topic name
   * @returns Async iterable of client IDs subscribed to this topic (empty if none)
   * @throws On adapter failure
   */
  getSubscribers(topic: string): AsyncIterable<string>;

  /**
   * Atomically replace a client's subscriptions with a new set.
   * Returns immediately (no-op) if the new set equals the current set.
   * All-or-nothing semantics: either all succeed or all fail.
   *
   * Optional: adapters can optimize (e.g., Redis pipelines) or default to single loops.
   *
   * @param clientId - Client identifier
   * @param topics - New subscription set (replaces current)
   * @returns Counts: { added, removed, total }
   * @throws On adapter failure
   */
  replace?(
    clientId: string,
    topics: Iterable<string>,
  ): Promise<{ added: number; removed: number; total: number }>;

  /**
   * List all active topics in this process (optional).
   * Check `adapter.listTopics` before calling; if present, returns definitive array.
   *
   * Async: allows efficient enumeration for distributed adapters.
   * If your adapter can't enumerate efficiently, simply don't implement this method.
   *
   * @returns Array of topic names (empty = no topics)
   * @throws On adapter failure
   */
  listTopics?(): Promise<readonly string[]>;

  /**
   * Check if a topic has any subscribers (optional).
   * Check `adapter.hasTopic` before calling; if present, returns definitive boolean.
   *
   * Async: allows efficient querying for distributed adapters.
   * If your adapter can't query efficiently, simply don't implement this method.
   *
   * @param topic - Topic name
   * @returns true if topic has ≥1 subscriber, false if none
   * @throws On adapter failure
   */
  hasTopic?(topic: string): Promise<boolean>;

  /**
   * Lifecycle hook: start consuming from distributed broker (optional).
   * Called by router/plugin at initialization if present.
   * Enables distributed adapters (Redis, Kafka, DO) to wire broker → local delivery.
   *
   * Memory adapters omit this entirely (no ingress, zero boilerplate).
   *
   * **Contract**:
   * - Invoke onRemote(envelope) for each message received from broker
   * - Return a teardown function (sync or async) to stop consuming and cleanup
   * - If onRemote throws, log and continue (don't crash the consumer loop)
   * - Only throw from start() for real failures (e.g., broker auth failed)
   *
   * @param onRemote - Callback: invokes local delivery for each remote message
   * @returns Teardown function (sync or async) to stop consuming and cleanup
   * @throws On broker connection failure or authentication error
   */
  start?(
    onRemote: (envelope: PublishEnvelope) => void | Promise<void>,
  ): StopFn | Promise<StopFn>;

  /**
   * Close/dispose adapter resources (optional).
   * Called during router shutdown to clean up broker connections, subscriptions, etc.
   *
   * @throws On cleanup failure
   */
  close?(): Promise<void>;
}

/**
 * Broker consumer for distributed pub/sub systems.
 * Separate from PubSubDriver to maintain clean responsibility separation.
 *
 * **Responsibility**: Consume messages from broker and invoke handler for each.
 * **Not responsibility**: Subscription indexing, local delivery, encoding.
 *
 * **Usage**: Compose with driver via `withBroker(driver, consumer)` to create unified adapter:
 * ```ts
 * const driver = createRedisDriver(redis);
 * const consumer = createRedisConsumer(redis);
 * const adapter = withBroker(driver, consumer);
 * ```
 *
 * Memory drivers never need consumer (all publishes are local).
 * Distributed drivers (Redis, Kafka, Cloudflare DO) provide both driver + consumer.
 *
 * # Lifecycle Policy
 *
 * ## start()
 *
 * - **When to call**: Platform/router calls once during initialization, before accepting client connections.
 * - **What to do**: Establish broker connection, begin consuming messages from subscribed topics.
 * - **Return value**: A stop function (can be sync or async). See contract below.
 * - **Throw**: Only for real broker failures (auth, connection timeout, lost). Plugin logs and rethrows.
 * - **Handler errors**: If onMessage throws, log and continue; do not crash the consumer loop.
 *
 * ## Stop Function (returned by start())
 *
 * - **Signature**: `() => void | Promise<void>` (may be sync or async)
 * - **When called**: Platform/router calls during shutdown, after rejecting new clients.
 * - **Safety**: MUST be idempotent; safe to call multiple times (only executes once).
 * - **Cleanup**: Close broker connections, stop consuming, flush pending messages if applicable.
 * - **Throw**: Log and tolerate; shutdown should not fail if a consumer has trouble.
 *
 * ## Handler (onMessage callback)
 *
 * - **When called**: For each remote publish received from the broker.
 * - **What it does**: Router delivers the message to local subscribers (via adapter.getSubscribers).
 * - **If it throws**: Log error and continue; do not crash the consumer loop. Consumer decides if retry is possible.
 * - **Contract**: Handlers must handle their own errors and signal back to consumer if needed (not part of this API).
 */
export interface BrokerConsumer {
  /**
   * Start consuming broker messages and invoke handler for each.
   *
   * Handler is invoked with the same PublishEnvelope that the driver.publish()
   * receives, allowing router to treat local and remote publishes identically.
   *
   * **Contract**:
   * - Initialize broker connections/subscriptions (may be async).
   * - Begin consuming messages and invoke onMessage for each.
   * - Return a teardown function (sync or async) to stop consuming and cleanup.
   * - If onMessage throws, log and continue; do not crash the consumer loop.
   * - Only throw from start() for real broker failures (auth, connection, etc).
   *
   * **Stop function requirements**:
   * - Must be idempotent; safe to call multiple times.
   * - May be sync `() => void` or async `() => Promise<void>`.
   * - Plugin normalizes both via `await Promise.resolve(stop())`.
   * - If stop returns undefined/falsy, plugin treats as no-op.
   *
   * @param onMessage - Invoked for each remote publish from broker (may throw; swallowed by plugin)
   * @returns Teardown function (sync or async) to stop consuming and cleanup
   * @throws On broker connection/auth failure (propagated by plugin)
   */
  start(
    onMessage: (envelope: PublishEnvelope) => void | Promise<void>,
  ): StopFn | Promise<StopFn>;
}

/**
 * Type guard: narrows PublishResult to success type.
 * Useful for exhaustive type checking and early returns.
 *
 * @example
 * const result = await adapter.publish(...);
 * if (isPublishSuccess(result)) {
 *   console.log(`Capability: ${result.capability}, Matched: ${result.matched ?? "unknown"}`);
 * }
 */
export function isPublishSuccess(
  result: PublishResult,
): result is Extract<PublishResult, { ok: true }> {
  return result.ok === true;
}

/**
 * Assertion helper: throws if publish failed.
 * Converts result-based error handling to thrown exceptions (useful for strict error handling).
 *
 * @example
 * const result = await adapter.publish(...);
 * ensurePublishSuccess(result); // throws if !ok
 * console.log(`Capability: ${result.capability}`);
 */
export function ensurePublishSuccess(
  result: PublishResult,
): asserts result is Extract<PublishResult, { ok: true }> {
  if (!isPublishSuccess(result)) {
    const err = new Error(`[pubsub] ${result.error}`) as Error & {
      retryable: boolean;
      details?: Record<string, unknown>;
    };
    err.retryable = result.retryable;
    if (result.details !== undefined) {
      err.details = result.details;
    }
    throw err;
  }
}

/**
 * Convenience: checks if message was delivered to at least one local subscriber.
 * Returns true only if matched is present and > 0 (i.e., confirmed delivery to at least one subscriber).
 *
 * @example
 * const result = await adapter.publish(...);
 * if (wasDeliveredLocally(result)) {
 *   console.log("Someone was listening");
 * }
 */
export function wasDeliveredLocally(result: PublishResult): boolean {
  return isPublishSuccess(result) && (result.matched ?? 0) > 0;
}
