/**
 * Pub/Sub adapter contract (core-level).
 * Implementations: in-memory, Redis, Kafka, Cloudflare DO, etc.
 *
 * # Layer Responsibility (Critical)
 *
 * **Adapter = subscription index + local fan-out only.**
 * - Tracks per-client topic subscriptions
 * - Broadcasts router-materialized messages to matching subscribers
 * - Returns optional publish stats (matched, deliveredLocal)
 *
 * **Not adapter's job:**
 * - Consume inbound messages from brokers (Redis SUBSCRIBE, Kafka, etc.)
 * - Call back into router
 * - Decode/validate payloads
 * - Handle WebSocket delivery
 *
 * **Router/Platform = orchestrates inbound + delivery.**
 * - Runs broker consumer loops (Redis/Kafka/DO)
 * - Decodes/validates messages using schema registry
 * - Calls `adapter.publish(...)` to fan-out
 * - Delivers to WebSockets subscribing via `ctx.topics`
 *
 * # Design Rationale
 *
 * ## Envelope Separates Data from Options
 * Why: Cleanly separates "what to broadcast" from "how to broadcast it".
 * Envelope = message data (topic, payload, meta). Options = publication metadata (partitionKey, excludeSelf).
 * Payload already validated by router; adapter doesn't need schema descriptor.
 * Type name (string) sufficient for adapter observability/routing.
 *
 * ## publish() Returns PublishResult
 * Why: Consistent return type. PublishResult has optional fields { matched?, deliveredLocal? }
 * allowing adapters to skip stats tracking (return {}) without runtime type narrowing.
 *
 * ## subscribe/unsubscribe Return void (Promise<void>)
 * Why: Throw on real failure (connection, quota, auth). No idempotency flags;
 * calling code doesn't care whether it was new or already subscribed.
 *
 * ## listTopics?/hasTopic? are Optional & Synchronous
 * Why: Many backends can't enumerate topics efficiently (Redis, Kafka). Sync keeps
 * hot paths simple. Caller checks method existence (if present, definitive answer).
 * No capability matrix, no undefined unions.
 *
 * ## meta Instead of headers
 * Why: `meta` is flexible (observability, routing hints, excludeSelf, partition key).
 * Headers are HTTP-specific; meta is transport-agnostic.
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

/**
 * Publication options: how to broadcast and handle delivery.
 *
 * Controls distribution logic only. Message metadata (observability, routing hints)
 * belongs in the envelope, not here.
 */
export interface PublishOptions {
  /**
   * Sharding/routing hint (advisory; adapters may ignore).
   * Useful for Redis Cluster, DynamoDB Streams, consistent hashing, etc.
   */
  partitionKey?: string;

  /**
   * Exclude sender from receiving the published message (best-effort).
   * Not yet implemented in all adapters; use app-level filtering as fallback.
   */
  excludeSelf?: boolean;

  /**
   * Cancellation signal for the publish operation.
   */
  signal?: AbortSignal;
}

/**
 * Indicates how reliable the matched subscriber count is.
 *
 * - `"exact"` — Exact local subscriber count (e.g., MemoryPubSub)
 * - `"estimate"` — Lower-bound estimate (e.g., Node/uWS polyfill)
 * - `"unknown"` — Subscriber count not tracked (e.g., Redis multi-process)
 */
export type PublishCapability = "exact" | "estimate" | "unknown";

/**
 * Error codes for publish() failures.
 *
 * UPPERCASE canonical codes for pattern matching and exhaustive switches.
 * Enables reliable error classification and retry logic across all adapters.
 */
export type PublishError =
  | "VALIDATION" // Schema validation failed (local)
  | "ACL" // authorizePublish hook denied
  | "STATE" // Illegal in current router/connection state
  | "BACKPRESSURE" // Adapter's send queue full
  | "PAYLOAD_TOO_LARGE" // Exceeds adapter limit
  | "UNSUPPORTED" // Option/feature not supported (e.g., excludeSelf)
  | "ADAPTER_ERROR" // Unexpected adapter failure
  | "CONNECTION_CLOSED"; // Connection/router disposed

/**
 * Retryability mapping for publish errors.
 *
 * Each error code has a canonical retryability flag. Applications can use this
 * to decide retry strategy without manual mapping.
 *
 * @internal Reference for router implementation
 */
export const PUBLISH_ERROR_RETRYABLE: Record<PublishError, boolean> = {
  VALIDATION: false, // Won't succeed on retry
  ACL: false, // Authorization won't change
  STATE: false, // Router/adapter not ready
  BACKPRESSURE: true, // Queue might clear
  PAYLOAD_TOO_LARGE: false, // Size won't change
  UNSUPPORTED: false, // Feature won't appear
  ADAPTER_ERROR: true, // Infrastructure might recover
  CONNECTION_CLOSED: true, // Retryable after reconnection
};

/**
 * Result of publishing a message to a channel/topic.
 *
 * Provides honest semantics about what was delivered, since subscriber counts
 * can vary widely across implementations (exact for in-process, estimates for
 * distributed, unknown for some adapters).
 *
 * **publish() never throws for runtime conditions**. All expected failures return
 * `{ok: false}` with an error code. This allows predictable, result-based error handling.
 *
 * **Success semantics**:
 * - `ok: true; capability: "exact"` — Exact recipient count (e.g., MemoryPubSub)
 * - `ok: true; capability: "estimate"` — Lower-bound estimate (e.g., Node/uWS)
 * - `ok: true; capability: "unknown"` — Subscriber count not tracked (matched omitted)
 *
 * **Failure semantics**:
 * - `ok: false` — Delivery failed; use `error` code and `retryable` flag to decide next action
 * - `retryable: true` — Safe to retry after backoff (e.g., BACKPRESSURE, ADAPTER_ERROR)
 * - `retryable: false` — Retrying won't help (e.g., VALIDATION, ACL, STATE)
 * - `details`: Structured context from the adapter (limits, features, diagnostics)
 * - `cause`: Underlying exception for debugging and error chaining
 */
export type PublishResult =
  | {
      ok: true;
      /** Indicates reliability of matched count: "exact" / "estimate" / "unknown" */
      capability: PublishCapability;
      /** Matched subscriber count. Semantics depend on capability. undefined if "unknown". */
      matched?: number;
      /** Adapter-specific telemetry (e.g., shard, partition, cluster node, timings). */
      details?: Record<string, unknown>;
    }
  | {
      ok: false;
      /** Canonical error code (UPPERCASE) for pattern matching and switches */
      error: PublishError;
      /** Whether safe to retry after backoff (true for transient, false for permanent) */
      retryable: boolean;
      /** Name of the adapter that rejected (e.g., "redis", "inmemory") */
      adapter?: string;
      /** Structured context from adapter (limits, features, diagnostics) */
      details?: Record<string, unknown>;
      /** Underlying error cause, following Error.cause conventions */
      cause?: unknown;
    };

/**
 * Pub/Sub adapter: subscription index + local fan-out primitive.
 *
 * Responsibility:
 * - Manage per-client topic subscriptions
 * - Broadcast router-materialized messages to matching subscribers
 * - Return structured results (success with capability level, or failure with error code)
 *
 * Not responsible for:
 * - Consuming broker messages (Redis SUBSCRIBE, Kafka consumer)
 * - Calling back into router
 * - Decoding/validating payloads
 * - WebSocket delivery
 */
export interface PubSubAdapter {
  /**
   * Broadcast a message to subscribers of a topic.
   *
   * **Never throws for runtime conditions** (backpressure, unavailability, etc).
   * Returns discriminated union result: `{ok: true, capability, matched?, details?}`
   * on success, or `{ok: false, error, retryable, ...}` on failure.
   *
   * Throw only for invariant violations (adapter not initialized, internal crashes).
   * If topic has no subscribers, return `{ok: true, capability: "exact", matched: 0}`.
   *
   * @param envelope - Router-materialized: { topic, payload, type?, meta? }
   * @param opts - Publication options (partitionKey, excludeSelf, signal, etc.)
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
   * List all active topics in this process (optional).
   * Check `adapter.listTopics` before calling; if present, returns definitive array.
   *
   * Synchronous: for hot paths. If your adapter can't enumerate efficiently,
   * simply don't implement this method.
   *
   * @returns Array of topic names (empty = no topics)
   * @throws On adapter failure
   */
  listTopics?(): readonly string[];

  /**
   * Check if a topic has any subscribers (optional).
   * Check `adapter.hasTopic` before calling; if present, returns definitive boolean.
   *
   * Synchronous: for hot paths. If your adapter can't query efficiently,
   * simply don't implement this method.
   *
   * @param topic - Topic name
   * @returns true if topic has ≥1 subscriber, false if none
   * @throws On adapter failure
   */
  hasTopic?(topic: string): boolean;
}

/**
 * Type guard: narrows PublishResult to success type.
 * Useful for exhaustive type checking and early returns.
 *
 * @example
 * const result = await adapter.publish(...);
 * if (isPublishSuccess(result)) {
 *   console.log(`Matched ${result.matched} subscribers`);
 * }
 */
export function isPublishSuccess(
  result: PublishResult,
): result is Extract<PublishResult, { ok: true }> {
  return result.ok === true;
}

/**
 * Type guard: narrows PublishResult to failure type.
 *
 * @example
 * const result = await adapter.publish(...);
 * if (isPublishError(result)) {
 *   if (result.retryable) {
 *     // retry with backoff
 *   } else {
 *     // log and move on
 *   }
 * }
 */
export function isPublishError(
  result: PublishResult,
): result is Extract<PublishResult, { ok: false }> {
  return result.ok === false;
}

/**
 * Assertion helper: throws if publish failed, extracting cause for debugging.
 * Converts result-based error handling to thrown exceptions (useful for strict error handling).
 *
 * @example
 * const result = await adapter.publish(...);
 * ensurePublishSuccess(result); // throws if !ok
 * console.log(`Delivered to ${result.matched} subscribers`);
 */
export function ensurePublishSuccess(
  result: PublishResult,
): asserts result is Extract<PublishResult, { ok: true }> {
  if (!isPublishSuccess(result)) {
    const err = new Error(`[pubsub] ${result.error}`);
    (err as any).retryable = result.retryable;
    (err as any).adapter = result.adapter;
    (err as any).details = result.details;
    if (result.cause) {
      (err as any).cause = result.cause;
    }
    throw err;
  }
}

/**
 * Convenience: checks if message was delivered to at least one local subscriber.
 * Returns true only for exact capability with matched > 0.
 *
 * @example
 * const result = await adapter.publish(...);
 * if (wasDeliveredLocally(result)) {
 *   console.log("Someone was listening");
 * }
 */
export function wasDeliveredLocally(result: PublishResult): boolean {
  return (
    isPublishSuccess(result) &&
    result.capability === "exact" &&
    (result.matched ?? 0) > 0
  );
}
