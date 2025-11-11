// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PubSubAdapter } from "@ws-kit/core";

/**
 * In-memory pub/sub adapter using a topic subscription registry.
 *
 * Ideal for single-instance deployments or local testing.
 * Tracks subscribers per topic using a Map<topic, Set<clientId>>.
 * Applications are responsible for delivering messages to subscribers
 * (this adapter only manages subscription state).
 *
 * **Scope**: Subscriptions are stored only in memory on this instance.
 * Not suitable for multi-process deployments without a distributed adapter.
 *
 * Usage:
 * ```ts
 * import { memoryPubSub } from "@ws-kit/adapters/memory";
 *
 * const adapter = memoryPubSub();
 * // Use with Topics API or custom pub/sub layer
 * ```
 */
export function memoryPubSub(): PubSubAdapter {
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

/**
 * Create an in-memory pub/sub adapter.
 * @deprecated Use {@link memoryPubSub} instead.
 */
export const createMemoryAdapter = memoryPubSub;
