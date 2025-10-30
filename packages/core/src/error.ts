// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Standardized error codes for WebSocket protocol and RPC errors.
 *
 * @canonical This enum defines all valid error codes. Use these values,
 * not arbitrary strings, for consistent error handling across handlers.
 *
 * Reference: docs/specs/error-handling.md#error-code-enum, ADR-014
 *
 * Covers both standard WebSocket errors and RPC-specific scenarios:
 * - INVALID_ARGUMENT: Schema validation failed or semantic validation failed
 * - DEADLINE_EXCEEDED: RPC request timed out
 * - CANCELLED: Client or peer aborted the request
 * - PERMISSION_DENIED: Authorization check failed (different from AUTH_ERROR for token validation)
 * - NOT_FOUND: Requested resource doesn't exist
 * - CONFLICT: Correlation ID collision or uniqueness constraint violation
 * - RESOURCE_EXHAUSTED: Buffer overflow, rate limits exceeded, or backpressure
 * - UNAVAILABLE: Transient infrastructure error (retriable)
 * - INTERNAL_ERROR: Unexpected server error (unhandled exception, database failure)
 *
 * Plus legacy codes for backwards compatibility:
 * - VALIDATION_ERROR: (deprecated, use INVALID_ARGUMENT)
 * - AUTH_ERROR: (deprecated, use PERMISSION_DENIED for authz, add AUTH_REQUIRED for auth)
 * - RATE_LIMIT: (deprecated, use RESOURCE_EXHAUSTED)
 *
 * See docs/specs/error-handling.md for guidance on error code selection.
 */
export enum ErrorCode {
  // RPC-standard codes (aligned with gRPC where applicable)
  /** Invalid argument / schema validation or semantic validation failed */
  INVALID_ARGUMENT = "INVALID_ARGUMENT",

  /** Deadline exceeded / request timeout */
  DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED",

  /** Request was cancelled by client or peer */
  CANCELLED = "CANCELLED",

  /** Permission denied / authorization failed (after successful auth) */
  PERMISSION_DENIED = "PERMISSION_DENIED",

  /** Requested resource not found (invalid ID, deleted object, missing data) */
  NOT_FOUND = "NOT_FOUND",

  /** Conflict / correlation ID collision or uniqueness constraint violation */
  CONFLICT = "CONFLICT",

  /** Resource exhausted / buffer overflow, rate limits, or backpressure */
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",

  /** Unavailable / transient infrastructure error (retriable) */
  UNAVAILABLE = "UNAVAILABLE",

  /** Unexpected server error (unhandled exception, database failure, external service error) */
  INTERNAL_ERROR = "INTERNAL_ERROR",

  // Legacy codes (deprecated, kept for backwards compatibility)
  /** @deprecated Use INVALID_ARGUMENT instead */
  VALIDATION_ERROR = "VALIDATION_ERROR",

  /** @deprecated Use PERMISSION_DENIED for authz; add separate code for auth failures if needed */
  AUTH_ERROR = "AUTH_ERROR",

  /** @deprecated Use RESOURCE_EXHAUSTED instead */
  RATE_LIMIT = "RATE_LIMIT",
}

/**
 * Type that captures all valid ErrorCode values.
 *
 * Useful for type narrowing and function overloads.
 */
export type ErrorCodeValue = `${ErrorCode}`;

/**
 * Error payload structure for ERROR type messages.
 *
 * This is the standard format for sending errors to clients.
 */
export interface ErrorPayload {
  /** Standard error code */
  code: ErrorCode;

  /** Human-readable error message */
  message?: string;

  /** Additional debugging details (varies by error type) */
  details?: Record<string, unknown>;
}

/**
 * WebSocketError: Custom error type for protocol-level errors.
 *
 * Use this for errors that should be logged and potentially sent to clients.
 */
export class WebSocketError extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message || code);
    this.name = "WebSocketError";
    this.code = code;
    if (details) {
      this.details = details;
    }
  }

  /** Convert to error payload for sending to client */
  toPayload(): ErrorPayload {
    const payload: ErrorPayload = {
      code: this.code,
    };
    if (this.message) {
      payload.message = this.message;
    }
    if (this.details) {
      payload.details = this.details;
    }
    return payload;
  }
}

/**
 * Error message type definition (for schema creation).
 *
 * This is a placeholder; validator-specific adapters (Zod, Valibot)
 * will define the actual ErrorMessage schema.
 */
export interface ErrorMessage {
  type: "ERROR";
  payload: ErrorPayload;
}
