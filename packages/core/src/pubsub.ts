// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PubSub } from "./types";

/**
 * In-memory Pub/Sub implementation suitable for testing and single-server deployments.
 *
 * Uses a Map-based channel registry with handler arrays. Broadcasts are
 * synchronous and immediate.
 *
 * **Scope**: Messages published on one MemoryPubSub instance are only received
 * by subscribers on the same instance. Not suitable for multi-process deployments.
 *
 * **Use when**:
 * - Testing WebSocket router behavior
 * - Single Bun server (no horizontal scaling)
 * - Cloudflare Durable Object per-instance (not cross-shard)
 *
 * **Don't use for**:
 * - Multi-process deployments (use RedisPubSub instead)
 * - Applications requiring persistence (use platform-specific adapters)
 */
export class MemoryPubSub implements PubSub {
  private channels = new Map<
    string,
    Set<(message: unknown) => void | Promise<void>>
  >();

  /**
   * Publish a message to a channel.
   *
   * All subscribers to this channel receive the message immediately.
   * If a handler throws, the error is logged but doesn't stop other handlers.
   *
   * @param channel - Channel name
   * @param message - Message to publish
   */
  async publish(channel: string, message: unknown): Promise<void> {
    const handlers = this.channels.get(channel);
    if (!handlers) return;

    const promises: Promise<void>[] = [];

    for (const handler of handlers) {
      try {
        const result = handler(message);
        if (result instanceof Promise) {
          promises.push(
            result.catch((err) => {
              console.error(
                `Error in PubSub handler for channel "${channel}":`,
                err,
              );
            }),
          );
        }
      } catch (err) {
        console.error(`Error in PubSub handler for channel "${channel}":`, err);
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Subscribe to a channel.
   *
   * The handler will be called for each message published to this channel.
   * A single handler can be subscribed multiple times.
   *
   * @param channel - Channel name
   * @param handler - Handler function to call for each message
   */
  subscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    let handlers = this.channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channels.set(channel, handlers);
    }

    handlers.add(handler);
  }

  /**
   * Unsubscribe from a channel.
   *
   * Removes the handler from the subscriber list. If the handler was
   * subscribed multiple times, only one subscription is removed.
   *
   * @param channel - Channel name
   * @param handler - Handler function to remove
   */
  unsubscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    const handlers = this.channels.get(channel);
    if (handlers) {
      handlers.delete(handler);

      // Clean up empty channel sets
      if (handlers.size === 0) {
        this.channels.delete(channel);
      }
    }
  }

  /**
   * Clear all subscriptions from all channels.
   *
   * Useful for cleanup in testing or when resetting state.
   */
  clear(): void {
    this.channels.clear();
  }

  /**
   * Get the number of subscribers for a channel.
   *
   * Useful for debugging and testing.
   *
   * @param channel - Channel name
   * @returns Number of subscribers
   */
  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}
