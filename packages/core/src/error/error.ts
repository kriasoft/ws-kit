/**
 * WsKitError: type-safe error wrapper.
 *
 * Semantics:
 * - wrap(err, code) preserves type safety
 * - Never narrows error codes (immutable)
 * - If err is already WsKitError, return as-is or clone with new code
 * - Never mutates
 */

import type { ErrorCode, WsKitErrorData } from "./codes";
import { getErrorMetadata } from "./codes";

export class WsKitError<E extends ErrorCode = ErrorCode> extends Error {
  readonly code: E;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: E, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.retryable = getErrorMetadata(code).retryable;
  }

  /**
   * Wrap unknown error with a code (preserves type safety).
   */
  static wrap<E extends ErrorCode>(
    err: unknown,
    code?: E,
    details?: Record<string, unknown>,
  ): WsKitError<E | ErrorCode> {
    const base =
      err instanceof WsKitError
        ? err
        : new WsKitError("INTERNAL" as ErrorCode, String(err));

    if (code && code !== base.code) {
      return new WsKitError(code, String(err), details);
    }
    return base as WsKitError<E | ErrorCode>;
  }

  /**
   * Clone with new code (never mutate).
   */
  with<E2 extends ErrorCode>(opts: {
    code?: E2;
    details?: Record<string, unknown>;
  }): WsKitError<E2 | E> {
    return new WsKitError(
      opts.code ?? this.code,
      this.message,
      opts.details ?? this.details,
    ) as WsKitError<E2 | E>;
  }

  toJSON(): WsKitErrorData {
    const result: WsKitErrorData = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) {
      result.details = this.details;
    }
    return result;
  }
}
