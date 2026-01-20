// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core/pubsub";

/**
 * Result of a bulk topic replacement operation.
 */
export interface ReplaceResult {
  /** Number of new subscriptions added */
  added: number;
  /** Number of existing subscriptions removed */
  removed: number;
  /** Total subscriptions after replacement */
  total: number;
}

/**
 * Memory adapter with all optional methods implemented.
 */
export interface MemoryPubSubAdapter extends PubSubAdapter {
  hasTopic(topic: string): Promise<boolean>;
  listTopics(): Promise<readonly string[]>;
  replace(
    clientId: string,
    newTopics: Iterable<string>,
  ): Promise<ReplaceResult>;
  dispose(): void;
}

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
 * import { memoryPubSub } from "@ws-kit/memory";
 *
 * const router = createRouter<TContext>()
 *   .plugin(withPubSub({ adapter: memoryPubSub() }));
 *
 * router.on(Message, (ctx) => {
 *   const result = await ctx.publish("room:123", MessageSchema, { text: "Hi" });
 *   if (result.ok) {
 *     console.log(`Matched ${result.matched} subscribers (${result.capability})`);
 *   }
 * });
 * ```
 */
export function memoryPubSub(): MemoryPubSubAdapter {
  // Topic -> Set of client IDs subscribed to that topic
  const topics = new Map<string, Set<string>>();

  // Client -> Set of topics that client is subscribed to
  // Used for efficient cleanup and stats
  const clientTopics = new Map<string, Set<string>>();

  return {
    async publish(
      envelope: PublishEnvelope,
      opts?: PublishOptions,
    ): Promise<PublishResult> {
      // Note: excludeSelf filtering is handled by the pubsub plugin's
      // deliverLocally() via excludeClientId in envelope.meta.
      // Memory adapter returns post-filter count for accurate metrics.
      void opts; // unused - plugin handles excludeSelf

      const subscribers = topics.get(envelope.topic);
      let matched = subscribers?.size ?? 0;

      // Account for excludeSelf in matched count (sender excluded from delivery)
      const excludeId = (envelope.meta as Record<string, unknown>)
        ?.excludeClientId as string | undefined;
      if (excludeId && subscribers?.has(excludeId)) {
        matched -= 1;
      }

      return {
        ok: true,
        capability: "exact", // Memory adapter has exact subscriber count
        matched, // Post-filter count: actual recipients
      };
    },

    async subscribe(clientId: string, topic: string): Promise<void> {
      // Get or create subscriber set for this topic
      const subscribers = topics.get(topic) ?? new Set<string>();
      subscribers.add(clientId);
      topics.set(topic, subscribers);

      // Track client's subscriptions for cleanup
      const clientSubs = clientTopics.get(clientId) ?? new Set<string>();
      clientSubs.add(topic);
      clientTopics.set(clientId, clientSubs);
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
    ): Promise<ReplaceResult> {
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
          const subs = topics.get(topic) ?? new Set<string>();
          subs.add(clientId);
          topics.set(topic, subs);
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

    dispose() {
      topics.clear();
      clientTopics.clear();
    },
  };
}
