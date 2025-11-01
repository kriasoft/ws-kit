// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client-side error classes for WebSocket operations.
 * See @docs/specs/client.md#error-contract for usage semantics.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: { path: string[]; message: string }[],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export class ServerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServerError";
  }
}

export class ConnectionClosedError extends Error {
  constructor() {
    super("Connection closed before reply");
    this.name = "ConnectionClosedError";
  }
}

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

/**
 * Standard RPC error codes for type narrowing (per ADR-015, gRPC-aligned).
 *
 * Can be extended by applications with custom codes as needed.
 *
 * Terminal errors (don't auto-retry):
 * - UNAUTHENTICATED: Missing or invalid authentication
 * - PERMISSION_DENIED: Authenticated but insufficient permissions
 * - INVALID_ARGUMENT: Input validation failed
 * - FAILED_PRECONDITION: Stateful precondition not met
 * - NOT_FOUND: Resource does not exist
 * - ALREADY_EXISTS: Uniqueness or idempotency violation
 * - ABORTED: Concurrency conflict (race condition)
 *
 * Transient errors (retry with backoff):
 * - DEADLINE_EXCEEDED: RPC timed out
 * - RESOURCE_EXHAUSTED: Rate limit, quota, or buffer overflow
 * - UNAVAILABLE: Transient infrastructure error
 *
 * Server/evolution:
 * - UNIMPLEMENTED: Feature not supported or deployed
 * - INTERNAL: Unexpected server error (unhandled exception)
 * - CANCELLED: Call cancelled (client disconnect, abort)
 */
export type RpcErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENT"
  | "FAILED_PRECONDITION"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "ABORTED"
  | "DEADLINE_EXCEEDED"
  | "RESOURCE_EXHAUSTED"
  | "UNAVAILABLE"
  | "UNIMPLEMENTED"
  | "INTERNAL"
  | "CANCELLED"
  | string;

/**
 * RPC error from server (request/response pattern failure).
 *
 * Thrown by client.request() when server sends RPC_ERROR.
 * Includes error code, details, and retry hints.
 *
 * Supports type narrowing via generic parameter:
 * ```typescript
 * try {
 *   await client.request(Query, payload);
 * } catch (e) {
 *   if (e instanceof RpcError) {
 *     if (e.code === "RESOURCE_EXHAUSTED") {
 *       // Type-narrowed: retryAfterMs is present
 *       await sleep(e.retryAfterMs ?? 100);
 *     }
 *   }
 * }
 * ```
 */
export class RpcError<TCode extends RpcErrorCode = RpcErrorCode> extends Error {
  constructor(
    message: string,
    public readonly code: TCode,
    public readonly details?: unknown,
    public readonly retryable?: boolean,
    public readonly retryAfterMs?: number,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * Connection disconnected during RPC request.
 *
 * Thrown when socket closes while request is in-flight and no idempotencyKey
 * is provided (or reconnect window expires without reconnecting).
 *
 * If idempotencyKey is present, client will auto-resend on reconnect within
 * the resendWindowMs (default 5000). This error is only thrown if reconnect
 * happens too late or idempotencyKey is not set.
 */
export class WsDisconnectedError extends Error {
  constructor(message = "WebSocket disconnected") {
    super(message);
    this.name = "WsDisconnectedError";
  }
}
