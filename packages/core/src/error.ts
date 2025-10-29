// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Standardized error codes for WebSocket protocol errors.
 *
 * @canonical This enum defines all valid error codes. Use these values,
 * not arbitrary strings, for consistent error handling across handlers.
 *
 * Reference: docs/specs/error-handling.md#error-code-enum
 *
 * Standard codes are limited to the most common error scenarios:
 * - VALIDATION_ERROR: Message format or schema validation failed
 * - AUTH_ERROR: Authentication or authorization failed
 * - INTERNAL_ERROR: Unexpected server error occurred
 * - NOT_FOUND: Requested resource doesn't exist
 * - RATE_LIMIT: Client exceeded rate limits
 *
 * Applications can use these codes for any relevant error condition.
 * See docs/specs/error-handling.md for guidance on error code selection.
 */
export enum ErrorCode {
  /** Message failed schema validation (JSON parse, type check, structure, field validation) */
  VALIDATION_ERROR = "VALIDATION_ERROR",

  /** Client authentication failed (invalid credentials, missing token, expired session) or authorization failed (insufficient permissions) */
  AUTH_ERROR = "AUTH_ERROR",

  /** Unexpected server error (unhandled exception, database failure, external service error) */
  INTERNAL_ERROR = "INTERNAL_ERROR",

  /** Requested resource not found (invalid ID, deleted object, missing data) */
  NOT_FOUND = "NOT_FOUND",

  /** Client exceeded rate limits (too many messages, too frequent requests, quota exceeded) */
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
