// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Pub/Sub context methods (added by withPubSub plugin).
 *
 * Only available when withPubSub() is plugged.
 * Provides broadcast and subscription management APIs.
 */

import type { MessageDescriptor } from "../protocol/message-descriptor.js";
import type { PublishOptions, PublishResult } from "../core/types.js";

export interface PubSubContext {
  /**
   * Publish message to a topic (broadcast to all subscribers).
   * Only available when withPubSub() plugin is installed.
   *
   * **Never throws for runtime conditions** (backpressure, validation failure, etc).
   * Returns a discriminated union result:
   * - Success: `{ok: true, capability, matched?}` — Message delivered
   * - Failure: `{ok: false, error, retryable}` — Delivery failed with recoverable info
   *
   * @param topic - Topic name
   * @param schema - Message schema for type name and validation
   * @param payload - Message payload (should match schema)
   * @param opts - Optional publication options (partitionKey, excludeSelf, meta)
   * @returns PublishResult: discriminated union of success or failure
   */
  publish(
    topic: string,
    schema: MessageDescriptor,
    payload: unknown,
    opts?: PublishOptions,
  ): Promise<PublishResult>;

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
