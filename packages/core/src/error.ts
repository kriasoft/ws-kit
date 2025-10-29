// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Standardized error codes for WebSocket protocol errors.
 *
 * @canonical This enum defines all valid error codes. Use these values,
 * not arbitrary strings, for consistent error handling across handlers.
 *
 * Reference: @docs/specs/error-handling.md#error-code-enum
 */
export enum ErrorCode {
  /** Message isn't valid JSON or lacks required structure */
  INVALID_MESSAGE_FORMAT = "INVALID_MESSAGE_FORMAT",

  /** Message failed schema validation */
  VALIDATION_FAILED = "VALIDATION_FAILED",

  /** No handler registered for this message type */
  UNSUPPORTED_MESSAGE_TYPE = "UNSUPPORTED_MESSAGE_TYPE",

  /** Client isn't authenticated or has invalid credentials */
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",

  /** Client lacks permission for the requested action */
  AUTHORIZATION_FAILED = "AUTHORIZATION_FAILED",

  /** Requested resource doesn't exist */
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",

  /** Client is sending messages too frequently */
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  /** Unexpected server error occurred */
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",

  /** Message payload exceeds maximum allowed size */
  PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE",

  /** Connection heartbeat timeout (no pong response) */
  HEARTBEAT_TIMEOUT = "HEARTBEAT_TIMEOUT",
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

  /** Additional debugging context (varies by error type) */
  context?: Record<string, unknown>;
}

/**
 * WebSocketError: Custom error type for protocol-level errors.
 *
 * Use this for errors that should be logged and potentially sent to clients.
 */
export class WebSocketError extends Error {
  code: ErrorCode;
  context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message?: string,
    context?: Record<string, unknown>,
  ) {
    super(message || code);
    this.name = "WebSocketError";
    this.code = code;
    this.context = context;
  }

  /** Convert to error payload for sending to client */
  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
    };
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
