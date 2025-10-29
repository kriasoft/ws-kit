// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Creates a throttled publish function that coalesces rapid message bursts.
 *
 * Useful for scenarios with frequent rapid state changes (e.g., real-time collaboration,
 * live cursors). Instead of sending individual messages immediately, batches them
 * into a single broadcast after a throttle window.
 *
 * @param publish - Publish function from router (e.g., `router.publish`)
 * @param windowMs - Throttle window in milliseconds (default: 50ms)
 * @returns Function that queues messages for throttled publishing
 *
 * @example
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 * const throttledPublish = createThrottledPublish(
 *   router.publish.bind(router),
 *   50 // ms
 * );
 *
 * // Fast state changes
 * throttledPublish("room", { cursor: { x: 10, y: 20 } });
 * throttledPublish("room", { cursor: { x: 11, y: 21 } });
 * throttledPublish("room", { cursor: { x: 12, y: 22 } });
 *
 * // Only one publish after 50ms window with the last message
 * ```
 */
export function createThrottledPublish(
  publish: (channel: string, message: unknown) => Promise<void>,
  windowMs = 50,
): (channel: string, message: unknown) => void {
  const queued = new Map<string, unknown>();
  let scheduled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    scheduled = false;
    timeout = null;

    // Send all queued messages grouped by channel
    const messages = new Map<string, unknown[]>();
    queued.forEach((msg, channel) => {
      const list = messages.get(channel) || [];
      list.push(msg);
      messages.set(channel, list);
    });
    queued.clear();

    // Publish each channel
    for (const [channel, msgs] of messages) {
      const payload =
        msgs.length === 1
          ? msgs[0] // Single message, send as-is
          : { batch: msgs }; // Multiple messages, wrap in batch
      await publish(channel, payload);
    }
  };

  return (channel: string, message: unknown) => {
    queued.set(channel, message);

    if (!scheduled) {
      scheduled = true;
      timeout = setTimeout(flush, windowMs);
    }
  };
}

/**
 * Configuration for throttled broadcast behavior.
 */
export interface ThrottledBroadcastConfig {
  /**
   * Throttle window in milliseconds. Rapid messages within this window
   * are coalesced into a single broadcast.
   *
   * @default 50
   */
  windowMs?: number;

  /**
   * Optional callback when messages are flushed.
   * Useful for logging, metrics, or debugging.
   */
  onFlush?: (channel: string, messageCount: number) => void;
}

/**
 * Advanced version with batching and flushing callbacks.
 *
 * @param publish - Publish function from router
 * @param config - Configuration options
 * @returns Function that queues messages for throttled publishing
 *
 * @example
 * ```typescript
 * const throttledPublish = createAdvancedThrottledPublish(
 *   router.publish.bind(router),
 *   {
 *     windowMs: 50,
 *     onFlush: (channel, count) => {
 *       console.log(`Flushed ${count} messages to ${channel}`);
 *     },
 *   }
 * );
 * ```
 */
export function createAdvancedThrottledPublish(
  publish: (channel: string, message: unknown) => Promise<void>,
  config: ThrottledBroadcastConfig = {},
): (channel: string, message: unknown) => void {
  const { windowMs = 50, onFlush } = config;
  const queued = new Map<string, unknown[]>();
  let scheduled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    scheduled = false;
    timeout = null;

    // Create a copy before clearing (in case flush fails)
    const messages = new Map(queued);
    queued.clear();

    // Publish each channel
    for (const [channel, msgs] of messages) {
      const payload =
        msgs.length === 1
          ? msgs[0] // Single message, send as-is
          : { batch: msgs }; // Multiple messages, wrap in batch

      await publish(channel, payload);
      onFlush?.(channel, msgs.length);
    }
  };

  return (channel: string, message: unknown) => {
    const list = queued.get(channel) || [];
    list.push(message);
    queued.set(channel, list);

    if (!scheduled) {
      scheduled = true;
      timeout = setTimeout(flush, windowMs);
    }
  };
}
