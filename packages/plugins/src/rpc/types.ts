// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Types for the withRpc() plugin.
 *
 * Provides request-response (RPC) messaging with streaming support via reply(),
 * error(), and progress() context methods.
 *
 * See ADR-030 for design rationale (sync-first for unicast, one-shot semantics).
 */

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
   * Reserved keys (correlationId) cannot be overridden.
   */
  meta?: Record<string, unknown>;

  /**
   * Whether to validate the outgoing payload.
   * Only used by validator plugins (withZod, withValibot).
   * Default: uses plugin validateOutgoing setting.
   * @internal
   */
  validate?: boolean;
}

export interface ProgressOptions extends ReplyOptions {
  /**
   * Rate-limit rapid progress updates (ms between sends).
   * Example: {throttleMs: 100} batches updates; max 10 per second.
   * Useful for high-frequency updates (animations, sensor data).
   * Default: undefined (no throttling)
   */
  throttleMs?: number;
}

/**
 * RPC plugin capability interface.
 *
 * Provides context methods for request-response (RPC) messaging with streaming.
 * These methods are only available in RPC handlers and require the validation plugin.
 */
export interface WithRpcCapability {
  /**
   * Marker for capability-gating in type system.
   * @internal
   */
  readonly __caps: { rpc: true };
}
