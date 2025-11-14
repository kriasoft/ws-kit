// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * RPC handler context (after validation plugin adds payload + response inference).
 *
 * Extends MinimalContext with:
 * - payload: inferred from schema.request
 * - reply(payload): terminal response
 * - progress(payload): non-terminal update
 */

import type { ConnectionData, MinimalContext } from "./base-context";

export interface RpcContext<
  TContext extends ConnectionData = ConnectionData,
  TPayload = unknown,
  TResponse = unknown,
> extends MinimalContext<TContext> {
  /**
   * Parsed + validated RPC request payload.
   */
  readonly payload: TPayload;

  /**
   * Terminal response (one-shot).
   * Closes the RPC exchange.
   */
  reply(payload: TResponse): Promise<void>;

  /**
   * Terminal error response (one-shot, symmetric with reply()).
   * Sends application-level error to RPC caller.
   * Only first call to reply() or error() sends; subsequent calls ignored.
   */
  error<T = unknown>(code: string, message: string, details?: T): Promise<void>;

  /**
   * Non-terminal progress update (streaming).
   * Can call multiple times before reply() or error().
   */
  progress(payload: TResponse): Promise<void>;
}
