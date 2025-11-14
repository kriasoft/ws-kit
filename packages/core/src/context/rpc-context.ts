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

export interface ReplyOptions {
  /**
   * Make the reply async and wait for a specific condition.
   * - 'drain': Wait for WebSocket send buffer to drain
   * - 'ack': Wait for server-side acknowledgment
   * Default: undefined (fire-and-forget, returns void)
   */
  waitFor?: "drain" | "ack";

  /**
   * Cancel the reply operation if this signal is triggered.
   * Gracefully skips sending if aborted before enqueue.
   */
  signal?: AbortSignal;

  /**
   * Custom metadata to merge into response meta.
   * Reserved keys (type, correlationId) cannot be overridden.
   */
  meta?: Record<string, unknown>;
}

export interface ProgressOptions extends ReplyOptions {
  /**
   * Rate-limit rapid progress updates (ms between sends).
   * Example: {throttleMs: 100} batches updates; max 10 per second
   * Useful for high-frequency updates (animations, sensor data)
   * Default: undefined (no throttling)
   */
  throttleMs?: number;
}

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
   *
   * Returns void by default (async enqueue). With {waitFor} option,
   * returns Promise<void> (always completes, never rejects).
   */
  reply(payload: TResponse, opts?: ReplyOptions): void | Promise<void>;

  /**
   * Terminal error response (one-shot, symmetric with reply()).
   * Sends application-level error to RPC caller.
   * Only first call to reply() or error() sends; subsequent calls ignored.
   *
   * Returns void by default (async enqueue). With {waitFor} option,
   * returns Promise<void> (always completes, never rejects).
   */
  error<T = unknown>(
    code: string,
    message: string,
    details?: T,
    opts?: ReplyOptions,
  ): void | Promise<void>;

  /**
   * Non-terminal progress update (streaming).
   * Can call multiple times before reply() or error().
   *
   * Returns void by default (async enqueue). With {waitFor} option,
   * returns Promise<void> (always completes, never rejects).
   *
   * Supports {throttleMs} to rate-limit rapid updates (useful for animations/sensor data).
   */
  progress(payload: TResponse, opts?: ProgressOptions): void | Promise<void>;
}
