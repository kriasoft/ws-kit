// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core type definitions for router, middleware, and handlers.
 * These types exist at the base level (no validation plugin dependency).
 */

import type { MinimalContext } from "../context/base-context";
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
export type Middleware<TContext = unknown> = (
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
export type EventHandler<TContext = unknown> = (
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
}

/**
 * Handler registry entry (internal).
 * Tracks middleware chain + handler for each schema.type.
 */
export interface RouteEntry<TContext> {
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
