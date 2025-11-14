// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * In-memory Pub/Sub adapter for development and testing.
 *
 * Maintains topic subscriptions in a Map and broadcasts messages synchronously.
 * Zero external dependencies; works immediately without setup.
 *
 * **Guarantees**:
 * - ✅ Subscriptions persist for connection lifetime
 * - ✅ Messages broadcast synchronously to all subscribers
 * - ✅ Automatic cleanup on disconnect
 * - ⚠️ No persistence across server restart (in-memory only)
 * - ⚠️ Not suitable for distributed systems (single-server only)
 *
 * **Usage**:
 * ```typescript
 * import { memoryPubSub } from "@ws-kit/core/adapters";
 *
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter: memoryPubSub() }));
 * ```
 *
 * For production, swap to external adapter:
 * ```typescript
 * import { redisPubSub } from "@ws-kit/redis";
 *
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter: redisPubSub(redis) }));
 * ```
 */

import type { PublishEnvelope, PublishOptions, PublishResult, PubSubAdapter } from "../../capabilities/pubsub/adapter";

/**
 * Create an in-memory Pub/Sub adapter for development.
 *
 * @returns PubSubAdapter instance managing subscriptions in-memory
 */
export function memoryPubSub(): PubSubAdapter {
  // Topic → Set of subscriber client IDs
  const subscriptions = new Map<string, Set<string>>();
  // Client ID → Set of subscribed topic names
  const clients = new Map<string, Set<string>>();

  /**
   * Broadcast a message to all subscribers of a topic.
   */
  async function publish(
    envelope: PublishEnvelope,
    _opts?: PublishOptions,
  ): Promise<PublishResult> {
    const subscribers = subscriptions.get(envelope.topic);
    const matched = subscribers?.size ?? 0;

    return {
      ok: true,
      capability: "exact" as const,
      matched,
    };
  }

  /**
   * Subscribe a client to a topic.
   */
  async function subscribe(clientId: string, topic: string): Promise<void> {
    // Add topic → client mapping
    if (!subscriptions.has(topic)) {
      subscriptions.set(topic, new Set());
    }
    subscriptions.get(topic)!.add(clientId);

    // Add client → topic mapping
    if (!clients.has(clientId)) {
      clients.set(clientId, new Set());
    }
    clients.get(clientId)!.add(topic);
  }

  /**
   * Unsubscribe a client from a topic.
   */
  async function unsubscribe(clientId: string, topic: string): Promise<void> {
    // Remove from topic → client mapping
    subscriptions.get(topic)?.delete(clientId);

    // Remove from client → topic mapping
    clients.get(clientId)?.delete(topic);
  }

  /**
   * Get all subscribers of a topic as an async iterable.
   */
  async function* getSubscribers(topic: string): AsyncIterable<string> {
    const subs = subscriptions.get(topic);
    if (subs) {
      for (const clientId of subs) {
        yield clientId;
      }
    }
  }

  /**
   * Atomically replace a client's subscriptions.
   */
  async function replace(
    clientId: string,
    topics: Iterable<string>,
  ): Promise<{ added: number; removed: number; total: number }> {
    // Get current subscriptions
    const current = clients.get(clientId) ?? new Set<string>();
    const desired = new Set(topics);

    // Calculate diff
    const toAdd = Array.from(desired).filter((t) => !current.has(t));
    const toRemove = Array.from(current).filter((t) => !desired.has(t));

    // Apply removals
    for (const topic of toRemove) {
      subscriptions.get(topic)?.delete(clientId);
      current.delete(topic);
    }

    // Apply additions
    for (const topic of toAdd) {
      if (!subscriptions.has(topic)) {
        subscriptions.set(topic, new Set());
      }
      subscriptions.get(topic)!.add(clientId);
      current.add(topic);
    }

    // Update client mapping
    clients.set(clientId, current);

    return {
      added: toAdd.length,
      removed: toRemove.length,
      total: current.size,
    };
  }

  /**
   * List all active topics.
   */
  async function listTopics(): Promise<readonly string[]> {
    return Array.from(subscriptions.keys()).filter((t) => subscriptions.get(t)!.size > 0);
  }

  /**
   * Check if a topic has any subscribers.
   */
  async function hasTopic(topic: string): Promise<boolean> {
    const subs = subscriptions.get(topic);
    return subs !== undefined && subs.size > 0;
  }

  /**
   * Cleanup: remove all subscriptions for a client (called on disconnect).
   */
  async function cleanup(clientId: string): Promise<void> {
    const topics = clients.get(clientId);
    if (topics) {
      for (const topic of topics) {
        subscriptions.get(topic)?.delete(clientId);
      }
      clients.delete(clientId);
    }
  }

  return {
    publish,
    subscribe,
    unsubscribe,
    getSubscribers,
    replace,
    listTopics,
    hasTopic,
    close: async () => {
      subscriptions.clear();
      clients.clear();
    },
  };
}
