// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Event handler context (after validation plugin adds payload).
 *
 * Extends MinimalContext with:
 * - payload: inferred from schema
 * - send(schema, payload): broadcast to clients
 */

import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { ConnectionData, MinimalContext } from "./base-context";

export interface SendOptions {
  /**
   * Make the send async and wait for a specific condition.
   * - 'drain': Wait for WebSocket send buffer to drain
   * - 'ack': Wait for server-side acknowledgment
   * Default: undefined (fire-and-forget, returns void)
   */
  waitFor?: "drain" | "ack";

  /**
   * Cancel the send operation if this signal is triggered.
   * Gracefully skips sending if aborted before enqueue.
   */
  signal?: AbortSignal;

  /**
   * Custom metadata to merge into response meta.
   * Reserved keys (type, correlationId) cannot be overridden.
   */
  meta?: Record<string, unknown>;

  /**
   * Automatically copy correlationId from inbound request meta to outgoing message.
   * Useful for fire-and-forget acknowledgments without RPC semantics.
   * Default: false (no-op if correlationId not present in inbound meta)
   */
  preserveCorrelation?: boolean;
}

export interface EventContext<
  TContext extends ConnectionData = ConnectionData,
  TPayload = unknown,
> extends MinimalContext<TContext> {
  /**
   * Parsed + validated message payload.
   */
  readonly payload: TPayload;

  /**
   * Send event to current client (1-to-1, fire-and-forget).
   * Available only in event handlers (kind="event").
   *
   * Returns void by default (async enqueue). With {waitFor} option,
   * returns Promise<boolean>: true if condition met, false if timed out.
   */
  send<T extends MessageDescriptor>(
    schema: T,
    payload: any, // InferPayload<T>
    opts?: SendOptions,
  ): void | Promise<boolean>;
}
