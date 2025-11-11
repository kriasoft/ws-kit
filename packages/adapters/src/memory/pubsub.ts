// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core/pubsub";

/**
 * In-memory pub/sub adapter: subscription index + local fan-out.
 *
 * Unified adapter for single-instance deployments or local testing.
 * Tracks topic subscriptions and broadcasts router-materialized messages.
 *
 * No distributed ingress (no broker consumption), so omits start() entirely (zero boilerplate).
 *
 * For distributed deployments (Redis, Kafka, Cloudflare DO), use distributed adapters.
 *
 * Usage:
 * ```ts
 * import { memoryPubSub } from "@ws-kit/adapters/memory";
 *
 * const router = createRouter<AppData>()
 *   .plugin(withPubSub(memoryPubSub()));
 *
 * router.on(Message, (ctx) => {
 *   const result = await ctx.publish("room:123", MessageSchema, { text: "Hi" });
 *   console.log(`Matched ${result.matchedLocal} local subscribers`);
 * });
 * ```
 */
export function memoryPubSub(): PubSubAdapter {
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
        matchedLocal, // 0 if no subscribers, otherwise > 0
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

    async *getSubscribers(topic: string): AsyncIterable<string> {
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

    async replace(
      clientId: string,
      newTopics: Iterable<string>,
    ): Promise<{ added: number; removed: number; total: number }> {
      // Get current subscriptions
      const currentTopics = clientTopics.get(clientId) ?? new Set<string>();
      const newTopicsSet = new Set(newTopics);

      // Early exit if sets are equal
      if (
        currentTopics.size === newTopicsSet.size &&
        Array.from(currentTopics).every((t) => newTopicsSet.has(t))
      ) {
        return {
          added: 0,
          removed: 0,
          total: currentTopics.size,
        };
      }

      let added = 0;
      let removed = 0;

      // Remove from topics not in newTopicsSet
      for (const topic of currentTopics) {
        if (!newTopicsSet.has(topic)) {
          const subs = topics.get(topic);
          if (subs) {
            subs.delete(clientId);
            if (subs.size === 0) {
              topics.delete(topic);
            }
          }
          removed++;
        }
      }

      // Add to topics not in currentTopics
      for (const topic of newTopicsSet) {
        if (!currentTopics.has(topic)) {
          if (!topics.has(topic)) {
            topics.set(topic, new Set());
          }
          topics.get(topic)!.add(clientId);
          added++;
        }
      }

      // Update client's subscription set
      clientTopics.set(clientId, newTopicsSet);

      return {
        added,
        removed,
        total: newTopicsSet.size,
      };
    },
  };
}
