// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core type definitions for router, middleware, and handlers.
 * These types exist at the base level (no validation plugin dependency).
 */

import type { ConnectionData, MinimalContext } from "../context/base-context";
import type { MessageDescriptor } from "../protocol/message-descriptor";

/**
 * Middleware is the same for global and per-route:
 * - Global: registered via router.use()
 * - Per-route: registered via router.route(schema).use()
 *
 * All middleware runs in order (global first, then per-route), before handler.
 *
 * TContext — the per-connection data available on ctx.data.
 */
export type Middleware<TContext extends ConnectionData = ConnectionData> = (
  ctx: MinimalContext<TContext>,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * Event handler: fires when message arrives (fire-and-forget semantics).
 * Available after validation plugin adds payload inference.
 * Can use ctx.send() to broadcast to other clients (requires validation plugin).
 *
 * TContext — the per-connection data available on ctx.data.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type EventHandler<TContext extends ConnectionData = ConnectionData> = (
  ctx: any, // MinimalContext<TContext> + payload (from validation)
) => Promise<void> | void;

/**
 * Options for createRouter. Only heartbeat/limits here; validators/pubsub are plugins.
 */
export interface CreateRouterOptions {
  heartbeat?: {
    intervalMs?: number;
    timeoutMs?: number;
  };
  limits?: {
    maxPending?: number;
    maxPayloadBytes?: number;
  };
  /**
   * Warn if an RPC handler returns without calling ctx.reply() or ctx.error().
   * Default: true in development, false in production.
   */
  warnIncompleteRpc?: boolean;
}

/**
 * Handler registry entry (internal).
 * Tracks middleware chain + handler for each schema.type.
 */
export interface RouteEntry<TContext extends ConnectionData = ConnectionData> {
  schema: MessageDescriptor;
  middlewares: Middleware<TContext>[];
  handler: EventHandler<TContext>;
}

/**
 * Pub/Sub publish options.
 *
 * Controls distribution logic only. Message payload and metadata belong in the
 * envelope, not here. These options affect how the message is delivered.
 */
export interface PublishOptions {
  /**
   * Sharding or routing hint (advisory; adapters may ignore).
   * Useful for Redis Cluster, DynamoDB Streams, consistent hashing, etc.
   * Adapters that don't support partitioning simply ignore this field.
   */
  partitionKey?: string;

  /**
   * Exclude the sender from receiving the published message.
   *
   * **Status**: Not yet implemented end-to-end. Returns `{ok: false, error: "UNSUPPORTED"}`
   * until the feature is complete.
   *
   * **Portable workaround**: Include sender identity in the payload/meta and filter
   * on the subscriber side.
   */
  excludeSelf?: boolean;

  /**
   * Cancellation signal for the publish operation.
   * If aborted before transmission, operation may be cancelled.
   * Adapter behavior is best-effort; no guarantee on partial state.
   * Late aborts (after transmission begins) may be ignored.
   */
  signal?: AbortSignal;

  /**
   * Optional extended metadata for the message.
   * Passed through to the envelope and available to subscribers.
   * Use for observability, routing hints, or app-specific context.
   */
  meta?: Record<string, unknown>;
}

/**
 * Describes the trustworthiness of the subscriber count returned in PublishResult.
 *
 * - `"exact"`: The count is exact and authoritative (e.g., local memory adapter)
 * - `"estimate"`: The count is a lower bound; actual may be higher (e.g., Redis with stale replica)
 * - `"unknown"`: The adapter cannot determine the count and omits the `matched` field
 */
export type PublishCapability = "exact" | "estimate" | "unknown";

/**
 * Canonical error codes for publish operations.
 *
 * The router checks router-level errors before calling the adapter.
 * Adapters must only return adapter-level errors; if an adapter returns
 * a router-level error, it indicates a contract violation.
 *
 * **Router-level errors** (checked before adapter.publish() call):
 * - `VALIDATION`: Payload doesn't match schema (non-retryable; fix payload)
 * - `ACL_PUBLISH`: Authorization hook denied publish (non-retryable; check permissions)
 * - `STATE`: Router/connection not ready (non-retryable; await router ready)
 * - `CONNECTION_CLOSED`: Connection disposed while publishing (retryable; retry after reconnect)
 *
 * **Adapter-level errors** (returned by adapter.publish()):
 * - `BACKPRESSURE`: Adapter send queue full (retryable; reduce send rate or retry with backoff)
 * - `PAYLOAD_TOO_LARGE`: Payload exceeds adapter limit (non-retryable; reduce size)
 * - `UNSUPPORTED`: Feature/option not supported (non-retryable; use alternative approach)
 * - `ADAPTER_ERROR`: Unexpected adapter failure (retryable; may be transient)
 *
 * **Retryability Summary:**
 * - Non-retryable: VALIDATION, ACL_PUBLISH, STATE, PAYLOAD_TOO_LARGE, UNSUPPORTED
 * - Retryable: BACKPRESSURE, CONNECTION_CLOSED, ADAPTER_ERROR
 */
export type PublishError =
  | "VALIDATION"
  | "ACL_PUBLISH"
  | "STATE"
  | "BACKPRESSURE"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED"
  | "ADAPTER_ERROR"
  | "CONNECTION_CLOSED";

/**
 * Result of a publish operation.
 *
 * Never throws for runtime conditions. All expected failures (backpressure, ACL denial, etc.)
 * return `{ok: false}` with an error code and `retryable` hint, enabling result-based error handling.
 *
 * **Success case** (`ok: true`):
 * - `capability`: Trustworthiness of the `matched` count ("exact", "estimate", or "unknown")
 * - `matched`: Subscriber count (omitted if capability is "unknown")
 *
 * **Failure case** (`ok: false`):
 * - `error`: Canonical error code (UPPERCASE) for pattern matching
 * - `retryable`: Whether operation may succeed if retried with backoff
 * - `adapter`: Name of the adapter that rejected (e.g., "redis", "inmemory")
 * - `details`: Structured context about the failure (e.g., { feature: "excludeSelf", limit: 1048576 })
 * - `cause`: Underlying error cause, following Error.cause conventions
 *
 * @example
 * ```ts
 * const result = await ctx.publish("chat:room:1", Message, { text: "hello" });
 *
 * if (result.ok) {
 *   console.log(`Published to ${result.matched ?? "?"} subscribers (${result.capability})`);
 * } else if (result.retryable) {
 *   // Transient error: queue for retry with backoff
 *   retryQueue.push({ topic: "chat:room:1", schema: Message, payload: { text: "hello" } });
 * } else {
 *   // Permanent error: log and skip
 *   logger.error(`Publish failed: ${result.error}`, result.details);
 * }
 * ```
 */
export type PublishResult =
  | {
      ok: true;
      capability: PublishCapability;
      matched?: number;
    }
  | {
      ok: false;
      error: PublishError;
      retryable: boolean;
      adapter?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    };

/**
 * Type guard for checking if a PublishResult contains a specific error.
 *
 * @example
 * ```ts
 * const result = await ctx.publish(topic, Message, payload);
 * if (isPublishError(result, "UNSUPPORTED")) {
 *   console.log("Feature not supported");
 * }
 * ```
 */
export function isPublishError<E extends PublishError>(
  result: PublishResult,
  error: E,
): result is Extract<PublishResult, { ok: false; error: E }> {
  return !result.ok && result.error === error;
}

/**
 * Record of a published message (for observation/testing).
 * Captured by router observers to track pub/sub events.
 */
export interface PublishRecord {
  /**
   * Topic name (e.g., "chat:room:123")
   */
  topic: string;

  /**
   * Message type from the schema descriptor (if available)
   */
  type?: string;

  /**
   * Message payload (only if observer requested it)
   */
  payload?: unknown;

  /**
   * Optional metadata attached to the message
   */
  meta?: Record<string, unknown>;

  /**
   * Client ID if publish originated from a client (undefined if server-initiated)
   */
  clientId?: string;
}

/**
 * Router observer: hooks for testing and monitoring plugins.
 *
 * Register via router.observe() to receive events about publishes, errors, and connections.
 * All callbacks are optional; register only the ones you need.
 *
 * **Safety**:
 * - Callbacks are read-only observers (don't mutate router state)
 * - Called synchronously in registration order
 * - Exceptions are logged and swallowed; other observers still run
 * - Re-entrancy is safe (uses snapshot of observer list)
 *
 * **Use cases**:
 * - Testing: capture publishes and errors for assertions
 * - Monitoring: log events for observability
 * - Metrics: count publishes, connection churn, errors
 */
export interface RouterObserver<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Called when a message is published to a topic.
   * Includes topic, type, payload (if requested), and metadata.
   */
  onPublish?(record: PublishRecord): void;

  /**
   * Called when a client connects.
   * Provides client ID and immutable connection data.
   */
  onConnectionOpen?(clientId: string, data: Readonly<TContext>): void;

  /**
   * Called when a client disconnects.
   * Provides client ID and optional close code/reason.
   */
  onConnectionClose?(
    clientId: string,
    meta?: { code?: number; reason?: string },
  ): void;

  /**
   * Called when an error occurs (validation, handler, middleware, etc.).
   * Provides error and optional context (clientId, message type).
   */
  onError?(err: unknown, meta?: { clientId?: string; type?: string }): void;
}
