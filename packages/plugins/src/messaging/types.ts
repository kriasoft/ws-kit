// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Types for the withMessaging() plugin.
 *
 * Provides fire-and-forget unicast messaging (send) and broadcast messaging (publish).
 */

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
   * Custom metadata to merge into outgoing message meta.
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

/**
 * Messaging plugin capability interface.
 *
 * Provides context methods for fire-and-forget messaging (send, publish).
 * These methods are always available once withMessaging() is applied.
 */
export interface WithMessagingCapability {
  /**
   * Marker for capability-gating in type system.
   * @internal
   */
  readonly messaging: true;
}
