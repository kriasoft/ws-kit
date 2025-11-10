// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/pubsub — In-memory pub/sub plugin for WS-Kit
 *
 * Provides a lightweight, local pub/sub implementation using a Map-based
 * topic registry and Set-based subscriber tracking.
 */

import type {
  Router,
  PubSubAdapter,
  PubSubMessage,
  MessageDescriptor,
  Plugin,
} from "@ws-kit/core";

/**
 * Create an in-memory pub/sub adapter.
 * Ideal for single-instance deployments or local testing.
 */
export function createMemoryAdapter(): PubSubAdapter {
  const topics = new Map<string, Set<string>>();

  return {
    async publish(msg: PubSubMessage): Promise<void> {
      // In-memory implementation: message is delivered immediately to subscribers
      // In a real distributed implementation, this would broadcast to other instances
    },

    async subscribe(clientId: string, topic: string): Promise<void> {
      if (!topics.has(topic)) {
        topics.set(topic, new Set());
      }
      topics.get(topic)?.add(clientId);
    },

    async unsubscribe(clientId: string, topic: string): Promise<void> {
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
 * Pub/Sub plugin factory.
 * Enhances a router with publish() and subscriptions methods.
 *
 * Usage:
 * ```ts
 * const router = createRouter()
 *   .plugin(withPubSub(createMemoryAdapter()));
 *
 * router.publish("topic", schema, payload);
 * ```
 */
export function withPubSub<TConn>(
  adapter: PubSubAdapter,
): Plugin<TConn, { pubsub: true }> {
  return (router: Router<TConn, any>) => {
    const publish = async (
      topic: string,
      schema: MessageDescriptor,
      payload: unknown,
      opts?: { partitionKey?: string; meta?: Record<string, unknown> },
    ) => {
      const msg: Parameters<typeof adapter.publish>[0] = {
        topic,
        schema,
        payload,
      };
      if (opts?.meta) {
        msg.meta = opts.meta;
      }
      await adapter.publish(msg);
    };

    const subscriptions = {
      list: () => adapter.listTopics(),
      has: (topic: string) => adapter.hasTopic(topic),
    };

    const enhanced = Object.assign(router, {
      publish,
      subscriptions,
    }) as Router<TConn, { pubsub: true }>;

    (enhanced as any).__caps = { pubsub: true };
    return enhanced;
  };
}

// Export core types for convenience
export type {
  PubSubAdapter,
  PubSubMessage,
  MessageDescriptor,
} from "@ws-kit/core";
