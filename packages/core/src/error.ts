// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Standardized error codes for WebSocket protocol and RPC errors.
 *
 * @canonical This enum defines all valid error codes. Use these values,
 * not arbitrary strings, for consistent error handling across handlers.
 *
 * Reference: ADR-015 (Unified RPC API Design), aligned with gRPC conventions
 *
 * Terminal errors (don't retry):
 * - UNAUTHENTICATED: Auth token missing, expired, or invalid
 * - PERMISSION_DENIED: Authenticated but lacks rights (authZ)
 * - INVALID_ARGUMENT: Input validation or semantic violation
 * - FAILED_PRECONDITION: State requirement not met
 * - NOT_FOUND: Target resource absent
 * - ALREADY_EXISTS: Uniqueness or idempotency replay violation
 * - ABORTED: Concurrency conflict (race condition)
 *
 * Transient errors (retry with backoff):
 * - DEADLINE_EXCEEDED: RPC timed out
 * - RESOURCE_EXHAUSTED: Rate limit, quota, or buffer overflow
 * - UNAVAILABLE: Transient infrastructure error
 *
 * Server / evolution:
 * - UNIMPLEMENTED: Feature not supported or deployed
 * - INTERNAL: Unexpected server error (bug)
 * - CANCELLED: Call cancelled (client disconnect, timeout abort)
 *
 *
 * See ADR-015 and docs/specs/error-handling.md for guidance.
 */
export enum ErrorCode {
  // Terminal errors (don't retry)
  /** Not authenticated / auth token missing, expired, or invalid */
  UNAUTHENTICATED = "UNAUTHENTICATED",

  /** Permission denied / authenticated but lacks rights (authZ) */
  PERMISSION_DENIED = "PERMISSION_DENIED",

  /** Invalid argument / input validation or semantic violation */
  INVALID_ARGUMENT = "INVALID_ARGUMENT",

  /** Failed precondition / state requirement not met */
  FAILED_PRECONDITION = "FAILED_PRECONDITION",

  /** Not found / target resource absent */
  NOT_FOUND = "NOT_FOUND",

  /** Already exists / uniqueness or idempotency replay violation */
  ALREADY_EXISTS = "ALREADY_EXISTS",

  /** Aborted / concurrency conflict (race condition) */
  ABORTED = "ABORTED",

  // Transient errors (retry with backoff)
  /** Deadline exceeded / RPC timed out */
  DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED",

  /** Resource exhausted / rate limit, quota, or buffer overflow */
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",

  /** Unavailable / transient infrastructure error */
  UNAVAILABLE = "UNAVAILABLE",

  // Server / evolution
  /** Unimplemented / feature not supported or deployed */
  UNIMPLEMENTED = "UNIMPLEMENTED",

  /** Internal / unexpected server error (bug) */
  INTERNAL = "INTERNAL",

  /** Cancelled / call cancelled (client disconnect, timeout abort) */
  CANCELLED = "CANCELLED",
}

/**
 * Type that captures all valid ErrorCode values.
 *
 * Useful for type narrowing and function overloads.
 */
export type ErrorCodeValue = `${ErrorCode}`;

/**
 * Metadata for error codes: retryability, backoff hints, wire format rules.
 *
 * This is the source of truth for:
 * - Which codes are retryable (and how clients should backoff)
 * - Whether retryAfterMs is required, optional, or forbidden in the wire format
 *
 * Reference: docs/specs/error-handling.md (authoritative error code table)
 */
export interface ErrorCodeMetadata {
  /** Whether code is retryable. "maybe" = server must decide (e.g., INTERNAL) */
  retryable: boolean | "maybe";

  /** Human-readable description of this error code */
  description: string;

  /** Suggested backoff interval in ms (informational; for docs/defaults) */
  suggestBackoffMs?: number;

  /** Rule for retryAfterMs presence on the wire */
  retryAfterMsRule: "forbidden" | "optional" | "required";
}

/**
 * Authoritative error code metadata (13 gRPC-aligned codes).
 *
 * Used by:
 * - Server: when sending errors, validates retryAfterMs per rule
 * - Clients: when parsing errors, infers retryable and backoff strategy
 * - Specs: documents retry semantics for each code
 */
export const ERROR_CODE_META: Record<ErrorCode, ErrorCodeMetadata> = {
  // Terminal errors (do not retry)
  [ErrorCode.UNAUTHENTICATED]: {
    retryable: false,
    description: "Auth token missing, expired, or invalid",
    retryAfterMsRule: "forbidden",
  },
  [ErrorCode.PERMISSION_DENIED]: {
    retryable: false,
    description: "Authenticated but lacks rights (authZ)",
    retryAfterMsRule: "forbidden",
  },
  [ErrorCode.INVALID_ARGUMENT]: {
    retryable: false,
    description: "Input validation or semantic violation",
    retryAfterMsRule: "forbidden",
  },
  [ErrorCode.FAILED_PRECONDITION]: {
    retryable: false,
    description: "State requirement not met",
    retryAfterMsRule: "forbidden",
  },
  [ErrorCode.NOT_FOUND]: {
    retryable: false,
    description: "Target resource absent",
    retryAfterMsRule: "forbidden",
  },
  [ErrorCode.ALREADY_EXISTS]: {
    retryable: false,
    description: "Uniqueness or idempotency replay violation",
    retryAfterMsRule: "forbidden",
  },
  [ErrorCode.UNIMPLEMENTED]: {
    retryable: false,
    description: "Feature not supported or deployed",
    retryAfterMsRule: "forbidden",
  },

  // Transient errors (retry with backoff)
  [ErrorCode.DEADLINE_EXCEEDED]: {
    retryable: true,
    description: "RPC timed out",
    suggestBackoffMs: 50,
    retryAfterMsRule: "optional",
  },
  [ErrorCode.RESOURCE_EXHAUSTED]: {
    retryable: true,
    description: "Rate limit, quota, or buffer overflow",
    suggestBackoffMs: 100,
    retryAfterMsRule: "optional",
  },
  [ErrorCode.UNAVAILABLE]: {
    retryable: true,
    description: "Transient infrastructure error",
    suggestBackoffMs: 100,
    retryAfterMsRule: "optional",
  },

  // Server / evolution
  [ErrorCode.ABORTED]: {
    retryable: true,
    description: "Concurrency conflict (race condition)",
    suggestBackoffMs: 50,
    retryAfterMsRule: "optional",
  },
  [ErrorCode.INTERNAL]: {
    retryable: "maybe",
    description: "Unexpected server error (bug); retryability is app-specific",
    suggestBackoffMs: 200,
    retryAfterMsRule: "optional",
  },
  [ErrorCode.CANCELLED]: {
    retryable: false,
    description: "Call cancelled (client disconnect, timeout abort)",
    retryAfterMsRule: "forbidden",
  },
};

/**
 * Error payload structure for ERROR type messages.
 *
 * This is the standard format for sending errors to clients.
 * Used in both non-RPC ERROR and RPC_ERROR messages (unified envelope).
 */
export interface ErrorPayload {
  /** Standard error code (one of 13 gRPC-aligned codes) */
  code: ErrorCode;

  /** Human-readable error message */
  message?: string;

  /** Additional debugging details (varies by error type) */
  details?: Record<string, unknown>;

  /**
   * Whether the error is retryable.
   * If omitted, clients infer from ERROR_CODE_META.
   * If present, overrides inferred value.
   */
  retryable?: boolean;

  /**
   * Suggested backoff interval in ms before retry (for transient errors).
   * Only present if retryable=true and server has a specific backoff hint.
   * Per ERROR_CODE_META, rule varies by error code:
   * - "forbidden": must be absent
   * - "optional": may be absent (client uses default backoff)
   * - "required": should be present (server enforces)
   */
  retryAfterMs?: number;
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
 * Follows WHATWG Error standard with `cause` for error chaining, while preserving
 * `code` and `details` for protocol-level error handling.
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
 * // Wrap an existing error (preserves original as cause)
 * try {
 *   await queryDatabase(id);
 * } catch (err) {
 *   throw WsKitError.wrap(err, "INTERNAL", "Database query failed");
 * }
 */
export class WsKitError extends Error {
  /** Error code (one of ErrorCode values) */
  code: string;

  /** Human-readable error message */
  override message: string;

  /** Additional details safe to expose to clients */
  details: Record<string, unknown>;

  /** WHATWG standard: original error for debugging (use instanceof Error check) */
  override cause: unknown;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message);
    this.name = "WsKitError";
    this.code = code;
    this.message = message;
    this.details = details || {};

    // Set WHATWG standard cause (Node 16.9+, modern browsers)
    if (cause !== undefined) {
      this.cause = cause;
    }

    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WsKitError);
    }
  }

  /** Convenience accessor: returns cause if it's an Error, otherwise undefined */
  get originalError(): Error | undefined {
    return this.cause instanceof Error ? this.cause : undefined;
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
   * Wrap an existing error as a WsKitError, preserving it as the cause.
   *
   * If the error is already a WsKitError, returns it as-is.
   * This is useful when catching unknown errors and wanting to preserve the stack trace
   * while providing structured error information.
   *
   * @param error The error to wrap (will be set as cause)
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
      originalError, // Passed as cause (WHATWG standard)
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
   * Includes cause and stack trace for internal debugging.
   * Use toPayload() for client transmission instead.
   */
  toJSON(): {
    code: string;
    message: string;
    details: Record<string, unknown>;
    stack: string | undefined;
    cause?:
      | {
          name: string;
          message: string;
          stack: string | undefined;
        }
      | string;
  } {
    const result: {
      code: string;
      message: string;
      details: Record<string, unknown>;
      stack: string | undefined;
      cause?:
        | {
            name: string;
            message: string;
            stack: string | undefined;
          }
        | string;
    } = {
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack,
    };

    if (this.cause) {
      result.cause =
        this.cause instanceof Error
          ? {
              name: this.cause.name,
              message: this.cause.message,
              stack: this.cause.stack,
            }
          : String(this.cause);
    }

    return result;
  }

  /**
   * Create an error payload for client transmission.
   *
   * Does NOT include cause, stack trace, or other debug information.
   */
  toPayload(): ErrorPayload {
    const payload: ErrorPayload = {
      code: (this.code as ErrorCode) || ErrorCode.INTERNAL,
      message: this.message,
    };
    if (Object.keys(this.details).length > 0) {
      payload.details = this.details;
    }
    return payload;
  }
}
