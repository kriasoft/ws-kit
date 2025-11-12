// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Pub/Sub context methods (added by withPubSub plugin).
 *
 * Only available when withPubSub() is plugged.
 * Provides broadcast and subscription management APIs.
 */

import type { MessageDescriptor } from "../protocol/message-descriptor";

export interface PubSubContext<TContext = unknown> {
  /**
   * Publish message to a topic (broadcast to all subscribers).
   * Only available when withPubSub() plugin is installed.
   *
   * @param topic - Topic name
   * @param schema - Message schema for type name and validation
   * @param payload - Message payload (should match schema)
   * @param opts - Optional: partitionKey for sharding, signal for cancellation
   */
  publish(
    topic: string,
    schema: MessageDescriptor,
    payload: any,
    opts?: {
      partitionKey?: string;
      signal?: AbortSignal;
    },
  ): Promise<void>;

  /**
   * Topic subscription utilities.
   * Only available when withPubSub() plugin is installed.
   */
  readonly topics: {
    /**
     * Subscribe to a topic.
     */
    subscribe(topic: string): Promise<void>;

    /**
     * Unsubscribe from a topic.
     */
    unsubscribe(topic: string): Promise<void>;

    /**
     * Check if currently subscribed to a topic.
     */
    has(topic: string): boolean;
  };
}
