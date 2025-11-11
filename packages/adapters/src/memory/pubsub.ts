// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubDriver,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core/pubsub";

/**
 * In-memory pub/sub driver: subscription index + local fan-out.
 *
 * Tracks topic subscriptions and broadcasts router-materialized messages.
 * Ideal for single-instance deployments or local testing.
 *
 * For distributed deployments (Redis, Kafka, DO), use a distributed driver.
 * Router handles inbound broker consumption via separate consumer.
 *
 * Usage:
 * ```ts
 * import { memoryPubSub } from "@ws-kit/adapters/memory";
 *
 * const driver = memoryPubSub();
 *
 * // Router calls driver.publish() when broadcasting:
 * const result = await driver.publish(
 *   {
 *     topic: "room:123",
 *     payload: { text: "Hello" },
 *     type: "ChatMessage",
 *     meta: { userId: "123" },
 *   },
 *   { partitionKey: "room:123" },
 * );
 *
 * console.log(`Delivered to ${result.matchedLocal} subscribers`);
 * ```
 */
export function memoryPubSub(): PubSubDriver {
  // Topic -> Set of client IDs subscribed to that topic
  const topics = new Map<string, Set<string>>();

  // Client -> Set of topics that client is subscribed to
  // Used for efficient cleanup and stats
  const clientTopics = new Map<string, Set<string>>();

  return {
    async publish(
      envelope: PublishEnvelope,
      _opts?: PublishOptions,
    ): Promise<PublishResult> {
      const subscribers = topics.get(envelope.topic);
      const matchedLocal = subscribers?.size ?? 0;

      // Router/platform layer handles actual delivery to websockets.
      // Adapter just returns metrics.
      // In a real distributed adapter (Redis, Kafka), publish would
      // broadcast to broker; router would handle inbound consumption.

      return {
        ok: true,
        capability: "exact", // In-memory: we have exact subscriber count
        matchedLocal, // 0 if no subscribers, >0 otherwise
      };
    },

    async subscribe(clientId: string, topic: string): Promise<void> {
      // Get or create subscriber set for this topic
      if (!topics.has(topic)) {
        topics.set(topic, new Set());
      }
      const subscribers = topics.get(topic)!;

      // Add to topic subscribers (idempotent)
      subscribers.add(clientId);

      // Track client's subscriptions for cleanup
      if (!clientTopics.has(clientId)) {
        clientTopics.set(clientId, new Set());
      }
      clientTopics.get(clientId)!.add(topic);
    },

    async unsubscribe(clientId: string, topic: string): Promise<void> {
      const subscribers = topics.get(topic);

      // Remove from topic (idempotent)
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          topics.delete(topic);
        }
      }

      // Remove from client topics
      const clientSubs = clientTopics.get(clientId);
      if (clientSubs) {
        clientSubs.delete(topic);
      }
    },

    async *getLocalSubscribers(topic: string): AsyncIterable<string> {
      const subscribers = topics.get(topic);
      if (subscribers) {
        for (const clientId of subscribers) {
          yield clientId;
        }
      }
    },

    async listTopics(): Promise<readonly string[]> {
      return Object.freeze(Array.from(topics.keys()));
    },

    async hasTopic(topic: string): Promise<boolean> {
      return topics.has(topic) && (topics.get(topic)?.size ?? 0) > 0;
    },
  };
}
