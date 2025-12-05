// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Event handler context (after validation plugin adds payload).
 *
 * Extends MinimalContext with:
 * - payload: inferred from schema
 * - send(schema, payload): send to current connection (1-to-1)
 */

import type { MessageDescriptor } from "../protocol/message-descriptor.js";
import type { InferPayload } from "../protocol/schema.js";
import type { ConnectionData, MinimalContext } from "./base-context.js";

// -----------------------------------------------------------------------------
// SendOptions: Split into Sync/Async for type-safe return values
//
// Design: Using separate interfaces (SendOptionsSync vs SendOptionsAsync) allows
// TypeScript to infer the correct return type based on `waitFor` presence.
// A single interface with `void | Promise<boolean>` would force runtime checks.
// See ADR-030 for sync-first rationale.
// -----------------------------------------------------------------------------

/**
 * Base options shared by sync and async send operations.
 */
export interface SendOptionsBase {
  /**
   * Cancel the send operation if this signal is triggered.
   * Gracefully skips sending if aborted before enqueue.
   */
  signal?: AbortSignal;

  /**
   * Custom metadata to merge into outgoing message meta.
   * Reserved keys (type, correlationId) cannot be overridden.
   */
  meta?: Record<string, unknown>;

  /**
   * Automatically copy correlationId from inbound request meta to outgoing message.
   * Useful for fire-and-forget acknowledgments without RPC semantics.
   * Default: false (no-op if correlationId not present in inbound meta)
   */
  inheritCorrelationId?: boolean;
}

/**
 * Options for fire-and-forget send (returns void).
 */
export interface SendOptionsSync extends SendOptionsBase {
  waitFor?: undefined;
}

/**
 * Options for async send with backpressure (returns Promise<boolean>).
 */
export interface SendOptionsAsync extends SendOptionsBase {
  /**
   * Make the send async and wait for a specific condition.
   * - 'drain': Wait for WebSocket send buffer to drain
   * - 'ack': Wait for server-side acknowledgment
   */
  waitFor: "drain" | "ack";
}

/**
 * Union type for implementations that handle both sync/async paths.
 * Consumers should use the specific interfaces for proper return type inference.
 */
export type SendOptions = SendOptionsSync | SendOptionsAsync;

export interface EventContext<
  TContext extends ConnectionData = ConnectionData,
  TPayload = unknown,
> extends MinimalContext<TContext> {
  /**
   * Parsed + validated message payload.
   */
  readonly payload: TPayload;

  /**
   * Send message to current client (1-to-1, unicast).
   *
   * Overloaded for type-safe return values:
   * - Without `waitFor`: returns void (fire-and-forget)
   * - With `waitFor`: returns Promise<boolean> (backpressure-aware)
   */
  send<T extends MessageDescriptor>(
    schema: T,
    payload: InferPayload<T>,
    opts?: SendOptionsSync,
  ): void;
  send<T extends MessageDescriptor>(
    schema: T,
    payload: InferPayload<T>,
    opts: SendOptionsAsync,
  ): Promise<boolean>;
}
