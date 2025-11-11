// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/pubsub plugin — adds pub/sub capability to router
 */

import type {
  Router,
  Plugin,
  MessageDescriptor,
  PubSubAdapter,
} from "@ws-kit/core";

/**
 * Pub/Sub plugin factory.
 * Enhances a router with publish() and subscriptions methods.
 *
 * Usage:
 * ```ts
 * const router = createRouter()
 *   .plugin(withPubSub(createMemoryAdapter()));
 *
 * router.on(Message, (ctx) => {
 *   ctx.publish("topic", schema, payload);
 *   await ctx.topics.subscribe("room:123");
 * });
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
      const msg: any = {
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
