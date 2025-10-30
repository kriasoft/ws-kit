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

/**
 * WsKitError: Standardized error object for structured error handling.
 *
 * Includes code, message, details for client transmission, and originalError
 * for internal debugging without exposing to clients.
 *
 * This enables better error parsing and integration with observability tools
 * like ELK, Sentry, etc.
 *
 * @example
 * // Create a new error
 * const error = WsKitError.from("INVALID_ARGUMENT", "Invalid user ID", {
 *   field: "userId",
 *   hint: "User ID must be a positive integer",
 * });
 *
 * @example
 * // Wrap an existing error
 * try {
 *   await queryDatabase(id);
 * } catch (err) {
 *   throw WsKitError.wrap(err, "INTERNAL_ERROR", "Database query failed");
 * }
 */
export class WsKitError extends Error {
  /** Error code (one of ErrorCode values) */
  code: string;

  /** Human-readable error message */
  override message: string;

  /** Additional details safe to expose to clients */
  details: Record<string, unknown>;

  /** Original error, preserved for internal debugging/logging */
  originalError: Error | undefined;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    originalError?: Error,
  ) {
    super(message);
    this.name = "WsKitError";
    this.code = code;
    this.message = message;
    this.details = details || {};
    this.originalError = originalError;

    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WsKitError);
    }
  }

  /**
   * Create a new WsKitError with given code, message, and details.
   */
  static from(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): WsKitError {
    return new WsKitError(code, message, details);
  }

  /**
   * Wrap an existing error as a WsKitError, preserving the original for debugging.
   *
   * If the error is already a WsKitError, returns it as-is.
   * This is useful when catching unknown errors and wanting to preserve the stack trace
   * while providing structured error information.
   *
   * @param error The error to wrap
   * @param code Error code for client transmission
   * @param message Optional human-readable message (uses error.message if not provided)
   * @param details Optional additional details for client
   */
  static wrap(
    error: unknown,
    code: string,
    message?: string,
    details?: Record<string, unknown>,
  ): WsKitError {
    // If already a WsKitError, return as-is
    if (error instanceof WsKitError) {
      return error;
    }

    // Convert to Error if needed
    const originalError =
      error instanceof Error ? error : new Error(String(error));

    return new WsKitError(
      code,
      message || originalError.message || code,
      details,
      originalError,
    );
  }

  /**
   * Type guard to check if a value is a WsKitError.
   */
  static isWsKitError(value: unknown): value is WsKitError {
    return value instanceof WsKitError;
  }

  /**
   * Serialize to plain object for structured logging (ELK, Sentry, etc).
   *
   * Includes the original error's stack trace when available.
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
            stack: this.originalError.stack,
          }
        : undefined,
      stack: this.stack,
    };
  }

  /**
   * Create an error payload for client transmission.
   *
   * Does NOT include the original error or stack trace.
   */
  toPayload(): ErrorPayload {
    const payload: ErrorPayload = {
      code: (this.code as ErrorCode) || ErrorCode.INTERNAL_ERROR,
      message: this.message,
    };
    if (Object.keys(this.details).length > 0) {
      payload.details = this.details;
    }
    return payload;
  }
}
