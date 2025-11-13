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
 * - UNIMPLEMENTED: Feature not supported or deployed
 * - CANCELLED: Call cancelled (client disconnect, timeout abort)
 *
 * Transient errors (retry with backoff):
 * - DEADLINE_EXCEEDED: RPC timed out
 * - RESOURCE_EXHAUSTED: Rate limit, quota, or buffer overflow
 * - UNAVAILABLE: Transient infrastructure error
 * - ABORTED: Concurrency conflict (race condition)
 *
 * Server / evolution:
 * - INTERNAL: Unexpected server error (bug)
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

  /** Unimplemented / feature not supported or deployed */
  UNIMPLEMENTED = "UNIMPLEMENTED",

  /** Cancelled / call cancelled (client disconnect, timeout abort) */
  CANCELLED = "CANCELLED",

  // Transient errors (retry with backoff)
  /** Deadline exceeded / RPC timed out */
  DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED",

  /** Resource exhausted / rate limit, quota, or buffer overflow */
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",

  /** Unavailable / transient infrastructure error */
  UNAVAILABLE = "UNAVAILABLE",

  /** Aborted / concurrency conflict (race condition) */
  ABORTED = "ABORTED",

  // Server / evolution
  /** Internal / unexpected server error (bug) */
  INTERNAL = "INTERNAL",
}

/**
 * Type that captures all valid ErrorCode values.
 *
 * Useful for type narrowing and function overloads.
 */
export type ErrorCodeValue = `${ErrorCode}`;

/**
 * Extensible error code type: standard 13 gRPC-aligned codes + custom domain-specific codes.
 *
 * - Accepts any of the 13 standard codes with full type safety
 * - Accepts custom string literals (e.g. "INVALID_ROOM_NAME") with literal type preservation
 * - Used in wire formats, error payloads, and user code
 *
 * The `(string & {})` pattern allows any string *literal* to pass while maintaining type safety.
 * This is NOT equivalent to plain `string`; it preserves literal types in overloads.
 * (Do not simplify to `ErrorCode | string`; that breaks literal type inference.)
 *
 * @example
 * // Standard codes (type-safe; metadata lookup available)
 * const err1: WsKitError<ErrorCode> = WsKitError.from("INTERNAL", "bug");
 *
 * // Custom codes (literal type preserved; no metadata inference)
 * const err2: WsKitError<"CUSTOM_CODE"> = WsKitError.from("CUSTOM_CODE", "msg");
 *
 * // Unknown code at runtime (still type-safe, type is inferred)
 * const code: string = "ANY_CODE";
 * const err3: WsKitError<string> = WsKitError.from(code, "msg");
 */
export type ExtErrorCode = ErrorCode | (string & {});

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
 *
 * **NOTE**: correlationId is NOT here; it lives in envelope.meta for RPC_ERROR.
 * This keeps the payload type simple and matches actual wire format (see sendErrorEnvelope).
 *
 * **Note on code extensibility**: Payloads accept both standard (gRPC-aligned) and
 * custom domain-specific error codes. For non-standard codes, clients do not infer
 * retryability—only `retryable` and `retryAfterMs` fields are authoritative.
 */
export interface ErrorPayload {
  /** Error code: one of 13 standard gRPC-aligned codes or custom domain-specific code */
  code: ExtErrorCode;

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
   *
   * null signals operation is impossible under policy (non-retryable).
   * Example: operation cost exceeds rate limit capacity; don't retry.
   */
  retryAfterMs?: number | null;
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
 * Generic parameter `C` preserves the exact code type (standard or custom):
 * - `WsKitError<ErrorCode>`: One of 13 standard gRPC-aligned codes (full metadata available)
 * - `WsKitError<"CUSTOM_CODE">`: Custom domain-specific code (literal type preserved)
 * - `WsKitError<string>`: Unknown code type (defaults when type is lost)
 *
 * @example
 * // Create a new error with standard code
 * const error = WsKitError.from("INVALID_ARGUMENT", "Invalid user ID", {
 *   field: "userId",
 *   hint: "User ID must be a positive integer",
 * });
 *
 * @example
 * // Create with custom domain-specific code
 * const customError = WsKitError.from("INVALID_ROOM_NAME", "Room name must be 3-50 chars");
 *
 * @example
 * // Wrap any error with a standard code (preserves original as cause)
 * try {
 *   await queryDatabase(id);
 * } catch (err) {
 *   throw WsKitError.wrap(err, "INTERNAL", "Database query failed");
 *   // If err is already a WsKitError, it's re-wrapped with code "INTERNAL"
 * }
 *
 * @example
 * // Preserve existing WsKitError as-is
 * try {
 *   throwPreviouslyWrapped();
 * } catch (err) {
 *   throw WsKitError.wrap(err); // Returns unchanged if already WsKitError
 * }
 */
export class WsKitError<C extends string = ExtErrorCode> extends Error {
  /** Error code: one of 13 standard gRPC-aligned codes or custom domain-specific code */
  readonly code: C;

  /** Human-readable error message */
  override readonly message: string;

  /** Additional details safe to expose to clients */
  readonly details: Record<string, unknown>;

  /**
   * Suggested backoff interval for transient errors (ms).
   * null signals operation impossible under policy (don't retry).
   * Used by sendErrorEnvelope to serialize retryAfterMs in payload (ADR-015).
   */
  readonly retryAfterMs?: number | null;

  /**
   * Correlation ID for RPC request tracking and distributed tracing.
   * Used in onError hooks for logging/observability; NOT included in ErrorPayload.
   * The envelope meta contains the correlation ID for RPC_ERROR, not the payload.
   */
  readonly correlationId?: string;

  /** WHATWG standard: original error for debugging (use instanceof Error check) */
  override readonly cause: unknown;

  constructor(
    code: C,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
    retryAfterMs?: number | null,
    correlationId?: string,
  ) {
    super(message);
    this.name = "WsKitError";
    this.code = code;
    this.message = message;
    this.details = details || {};

    // Set optional properties only if provided (handles exactOptionalPropertyTypes)
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs;
    }
    if (correlationId !== undefined) {
      this.correlationId = correlationId;
    }

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
   *
   * Overloaded to preserve code type:
   * - Standard codes get `WsKitError<ErrorCode>` (metadata lookup available)
   * - Custom codes get exact literal type (e.g., `WsKitError<"CUSTOM_CODE">`)
   *
   * **NOTE**: The two overload signatures are required for proper type inference.
   * The `ErrorCode` overload must come first to ensure standard codes match before
   * the generic `<C extends string>` overload. Do not merge into a single signature.
   *
   * @example
   * const err1 = WsKitError.from("INTERNAL", "bug");  // WsKitError<"INTERNAL">
   * const err2 = WsKitError.from("CUSTOM", "msg");    // WsKitError<"CUSTOM">
   */
  static from(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<ErrorCode>;
  static from<C extends string>(
    code: C,
    message: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<C>;
  static from<C extends string>(
    code: C,
    message: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<C> {
    return new WsKitError(
      code,
      message,
      details,
      undefined,
      retryAfterMs,
      correlationId,
    );
  }

  /**
   * Wrap an existing error as a WsKitError, preserving it as the cause.
   *
   * **Preserve behavior**: If the error is already a WsKitError, returns it unchanged
   * (both runtime and type). This maintains the original code type and avoids
   * creating redundant wrapper chains.
   *
   * **Wrap behavior**: If the error is not a WsKitError, creates a new WsKitError
   * with the requested code, setting the original error as cause.
   *
   * Overloaded to preserve code type (standard or custom):
   * - Existing WsKitError: returns as-is with original code type preserved
   * - Standard codes get `WsKitError<ErrorCode>` (metadata lookup available)
   * - Custom codes get exact literal type (e.g., `WsKitError<"CUSTOM_CODE">`)
   *
   * **NOTE**: The overload order is significant:
   * 1. `WsKitError<E>` overload must come first (preserve)
   * 2. Standard and custom code overloads follow (wrap)
   *
   * **With code parameter**: Wraps any error with the requested code, preserving the original as cause.
   * **Without code parameter**: Preserves an existing WsKitError as-is (returns same instance).
   *
   * @example
   * // Preserve existing error (no code provided)
   * const original = WsKitError.from("NOT_FOUND", "User not found");
   * const preserved = WsKitError.wrap(original);  // Type: WsKitError<"NOT_FOUND">, same instance
   *
   * @example
   * // Wrap any error with requested code
   * const err = new Error("Database timeout");
   * const wrapped = WsKitError.wrap(err, "INTERNAL");  // Type: WsKitError<"INTERNAL">
   *
   * @example
   * // Re-wrap existing WsKitError with new code
   * const original = WsKitError.from("NOT_FOUND", "Missing");
   * const retagged = WsKitError.wrap(original, "INTERNAL");  // Type: WsKitError<"INTERNAL">, original as cause
   *
   * @param error The error to wrap (will be set as cause)
   * @param code Optional error code. When provided, creates a new WsKitError with this code (preserving input as cause). When omitted, preserves an existing WsKitError as-is
   * @param message Optional human-readable message (uses error.message if not provided)
   * @param details Optional additional details for client
   * @param retryAfterMs Optional backoff hint for transient errors
   * @param correlationId Optional RPC correlation ID
   */
  static wrap<E extends string>(error: WsKitError<E>): WsKitError<E>;
  static wrap(
    error: unknown,
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<ErrorCode>;
  static wrap<C extends string>(
    error: unknown,
    code: C,
    message?: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<C>;
  static wrap<C extends string>(
    error: unknown,
    code?: C,
    message?: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<string> {
    // If already a WsKitError and no code provided, return unchanged (preserve)
    if (error instanceof WsKitError && code === undefined) {
      return error;
    }

    // Convert to Error if needed
    const originalError =
      error instanceof Error ? error : new Error(String(error));

    const c = code ?? "INTERNAL";

    return new WsKitError(
      c,
      message || originalError.message || String(c),
      details,
      originalError, // Passed as cause (WHATWG standard)
      retryAfterMs,
      correlationId,
    );
  }

  /**
   * Retag an error with a new error code while preserving the original as cause.
   *
   * Creates a **new** WsKitError with the requested code, always setting the input error
   * as the cause (whether it's a WsKitError or regular Error). This is useful for
   * mapping domain-specific errors to standard error codes while maintaining the
   * full error chain for debugging.
   *
   * Equivalent to calling `wrap(error, code, ...)`. Use `retag()` when you always want a new
   * instance with a specific code; use `wrap()` when you want to optionally preserve existing
   * WsKitErrors (call with no code parameter).
   *
   * Overloaded to preserve code type (standard or custom):
   * - Standard codes get `WsKitError<ErrorCode>` (metadata lookup available)
   * - Custom codes get exact literal type (e.g., `WsKitError<"CUSTOM_CODE">`)
   *
   * @example
   * // Map domain-specific error to standard code
   * const dbError = new Error("Connection timeout");
   * const retried = WsKitError.retag(dbError, "UNAVAILABLE", "Database unavailable");
   * // retried.code === "UNAVAILABLE"
   * // retried.cause === dbError
   *
   * @example
   * // Change code of an existing WsKitError (creates new instance, preserves original as cause)
   * const original = WsKitError.from("NOT_FOUND", "User not found");
   * const retagged = WsKitError.retag(original, "INTERNAL", "Unexpected error");
   * // retagged.code === "INTERNAL"
   * // retagged.cause === original (full error chain preserved)
   *
   * @param error The error to retag (will always be set as cause)
   * @param code New error code (standard or custom)
   * @param message Optional human-readable message (uses error.message if not provided)
   * @param details Optional additional details for client
   * @param retryAfterMs Optional backoff hint for transient errors
   * @param correlationId Optional RPC correlation ID
   */
  static retag(
    error: unknown,
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<ErrorCode>;
  static retag<C extends string>(
    error: unknown,
    code: C,
    message?: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<C>;
  static retag<C extends string>(
    error: unknown,
    code: C,
    message?: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number | null,
    correlationId?: string,
  ): WsKitError<C> {
    const cause = error instanceof Error ? error : new Error(String(error));

    return new WsKitError(
      code,
      message || cause.message || String(code),
      details,
      cause,
      retryAfterMs,
      correlationId,
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
    retryAfterMs?: number | null;
    correlationId?: string;
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
      retryAfterMs?: number | null;
      correlationId?: string;
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

    if (this.retryAfterMs !== undefined) {
      result.retryAfterMs = this.retryAfterMs;
    }
    if (this.correlationId !== undefined) {
      result.correlationId = this.correlationId;
    }

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
   * Does NOT include correlationId (belongs in envelope meta for RPC errors).
   * All properties are safe for sending to untrusted clients.
   */
  toPayload(): ErrorPayload {
    const payload: ErrorPayload = {
      code: this.code,
      message: this.message,
    };
    if (Object.keys(this.details).length > 0) {
      payload.details = this.details;
    }
    if (this.retryAfterMs !== undefined) {
      payload.retryAfterMs = this.retryAfterMs;
    }
    return payload;
  }
}

/**
 * Type guard to check if a code is a standard (gRPC-aligned) error code.
 *
 * Useful for determining if a code has built-in metadata (retryability, backoff hints).
 * Custom codes will return false; check error payload's `retryable` field explicitly.
 *
 * @example
 * ```typescript
 * import { isStandardErrorCode, ERROR_CODE_META } from "@ws-kit/core";
 *
 * if (isStandardErrorCode(code)) {
 *   const meta = ERROR_CODE_META[code];
 *   console.log("Retryable:", meta.retryable);
 * } else {
 *   console.log("Custom code; consult error payload's retryable field");
 * }
 * ```
 */
export function isStandardErrorCode(value: string): value is ErrorCode {
  return value in ERROR_CODE_META;
}
