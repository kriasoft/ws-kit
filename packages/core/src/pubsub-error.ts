// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Pub/Sub error codes.
 *
 * Canonical error codes for topic subscription and publication operations.
 * Unified taxonomy for consistent pattern-matching across subscribe/publish paths.
 *
 * See docs/specs/pubsub.md#error-models for details.
 */
export type PubSubErrorCode =
  | "ACL_SUBSCRIBE" // Denied by authorizeSubscribe() hook
  | "INVALID_TOPIC" // Failed validation or pattern check
  | "TOPIC_LIMIT_EXCEEDED" // Connection hit maxTopicsPerConnection quota
  | "CONNECTION_CLOSED" // Connection closed; cannot subscribe/publish
  | "ADAPTER_ERROR"; // Catch-all for adapter-specific errors

/**
 * Structured context for ACL failures.
 *
 * Provides details about subscription/publication authorization denials
 * without expanding the core error code taxonomy.
 */
export type PubSubAclDetails = {
  /** Operation that was denied (mirrors error code) */
  op: "subscribe" | "publish";
  /** HTTP-like semantics: "unauthorized" (401) vs "forbidden" (403) */
  kind?: "unauthorized" | "forbidden";
  /** Machine-readable hint for why authorization failed */
  reason?: string;
  /** Policy ID or name that was applied */
  policy?: string;
  /** Offending topic if relevant */
  topic?: string;
};

/**
 * Error thrown by pub/sub operations when validation, authorization, or connection errors occur.
 *
 * Pub/Sub operations throw `PubSubError` to signal exceptional conditions:
 * - Subscription state mutations (subscribe, unsubscribe, subscribeMany, unsubscribeMany)
 * - These are expected failures that require explicit error handling
 * - Errors indicate issues with topic validity, authorization, or connection state
 *
 * In contrast, `publish()` operations return a `PublishResult` (never throw).
 *
 * @example
 * ```typescript
 * try {
 *   await ctx.topics.subscribe("admin:logs");
 * } catch (err) {
 *   if (err instanceof PubSubError) {
 *     switch (err.code) {
 *       case "ACL_SUBSCRIBE":
 *         ctx.error("PERMISSION_DENIED", "You cannot subscribe to this topic");
 *         break;
 *       case "INVALID_TOPIC":
 *         ctx.error("INVALID_ARGUMENT", `Invalid topic format: ${err.message}`);
 *         break;
 *       case "CONNECTION_CLOSED":
 *         ctx.error("UNAVAILABLE", "Connection is closed");
 *         break;
 *       default:
 *         ctx.error("INTERNAL", "Subscription failed", { code: err.code });
 *     }
 *   }
 * }
 * ```
 *
 * @internal Vendor-specific: see PUBLISH_ERROR_RETRYABLE for publish() error semantics
 */
export class PubSubError extends Error {
  /**
   * Canonical error code (UPPERCASE) for pattern matching.
   *
   * Use this in switch statements or exhaustive type checking.
   * For related PublishResult errors, see PublishError type.
   */
  readonly code: PubSubErrorCode;

  /**
   * Optional adapter-specific context.
   *
   * Examples:
   * - Validation error details (which field, why)
   * - Adapter limits (max topics per connection, timeout values)
   * - Underlying system error for ADAPTER_ERROR
   *
   * Adapters may use this to provide debugging information without
   * exposing internal error objects directly.
   */
  readonly details?: unknown;

  /**
   * Create a new PubSubError.
   *
   * @param code - Canonical error code (see PubSubErrorCode)
   * @param message - Optional human-readable error description
   * @param details - Optional adapter-specific context (limits, validation details, etc.)
   */
  constructor(code: PubSubErrorCode, message?: string, details?: unknown) {
    super(message || code);
    this.code = code;
    this.details = details;
    this.name = "PubSubError";

    // Maintain proper stack trace for where our error was thrown (in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PubSubError);
    }
  }
}
