// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client-side error classes for WebSocket operations.
 * See @client.md#error-contract for usage semantics.
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
    public readonly context?: Record<string, unknown>,
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
