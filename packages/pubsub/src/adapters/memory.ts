// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/pubsub/adapters — implementations of PubSubAdapter interface
 */

import type { PubSubAdapter } from "@ws-kit/core";

/**
 * Create an in-memory pub/sub adapter.
 * Ideal for single-instance deployments or local testing.
 *
 * Tracks subscribers per topic using a Map<topic, Set<clientId>>.
 * Applications responsible for delivering messages to subscribers
 * (this adapter only manages subscription state).
 *
 * Usage:
 * ```ts
 * import { withPubSub, createMemoryAdapter } from "@ws-kit/pubsub";
 *
 * const router = createRouter()
 *   .plugin(withPubSub(createMemoryAdapter()));
 * ```
 */
export function createMemoryAdapter(): PubSubAdapter {
  const topics = new Map<string, Set<string>>();

  return {
    async publish(msg) {
      // In-memory implementation: state is managed, caller handles delivery
      // In a real distributed implementation, this would broadcast to other instances
    },

    async subscribe(clientId: string, topic: string) {
      if (!topics.has(topic)) {
        topics.set(topic, new Set());
      }
      topics.get(topic)?.add(clientId);
    },

    async unsubscribe(clientId: string, topic: string) {
      const subscribers = topics.get(topic);
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          topics.delete(topic);
        }
      }
    },

    listTopics(): readonly string[] {
      return Array.from(topics.keys());
    },

    hasTopic(topic: string): boolean {
      return topics.has(topic) && (topics.get(topic)?.size ?? 0) > 0;
    },
  };
}
