// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/pubsub plugin — adds pub/sub capability to router
 *
 * Wraps adapter, validates topics, delegates to subscription management.
 * Router constructs PublishEnvelope (topic, payload, type) and PublishOptions,
 * then calls adapter.publish(envelope, options) for fan-out.
 */

import type { Router, Plugin, MessageDescriptor } from "@ws-kit/core";
import type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
} from "@ws-kit/core/pubsub";

/**
 * Pub/Sub plugin factory.
 * Enhances a router with publish() and subscriptions helper.
 *
 * Router's responsibility:
 * - Construct PublishEnvelope (topic, payload, type name)
 * - Construct PublishOptions (partitionKey, excludeSelf, signal)
 * - Call adapter.publish(envelope, options) to broadcast
 * - Orchestrate inbound message handling (if distributed broker)
 *
 * Adapter's responsibility:
 * - Track per-client topic subscriptions
 * - Fan-out to matching subscribers
 * - Return publish stats (matched, deliveredLocal)
 *
 * Usage:
 * ```ts
 * const router = createRouter()
 *   .plugin(withPubSub(createMemoryAdapter()));
 *
 * router.on(Message, (ctx) => {
 *   const result = await ctx.publish("topic", schema, payload);
 *   if (result.ok) {
 *     console.log(`Matched ${result.matchedLocal} local subscribers`);
 *   }
 *
 *   await ctx.topics.subscribe("room:123");
 * });
 * ```
 */
export function withPubSub<TConn>(
  adapter: PubSubAdapter,
): Plugin<TConn, { pubsub: true }> {
  return (router: Router<TConn, any>) => {
    /**
     * Publish message to a topic.
     * Router materializes the message; adapter broadcasts.
     *
     * @param topic - Topic name (validation is middleware responsibility)
     * @param schema - Message schema (for router observability and type name)
     * @param payload - Validated payload (may include meta from message schema)
     * @param opts - Optional: partitionKey (sharding hint), signal (cancellation)
     * @returns PublishResult with optional matched/deliveredLocal counts
     * @throws On adapter failure
     */
    const publish = async (
      topic: string,
      schema: MessageDescriptor,
      payload: unknown,
      opts?: {
        partitionKey?: string;
        signal?: AbortSignal;
      },
    ) => {
      // Construct envelope: the message itself
      const envelope: PublishEnvelope = {
        topic,
        payload,
        type: schema.type || schema.name, // Schema name for observability
      };

      // Construct options: distribution logic only (meta belongs in envelope)
      const publishOpts: PublishOptions | undefined = opts
        ? {
            partitionKey: opts.partitionKey,
            signal: opts.signal,
          }
        : undefined;

      const result = await adapter.publish(envelope, publishOpts);
      return result;
    };

    /**
     * Convenience helpers for querying subscription state.
     */
    const subscriptions = {
      /**
       * List all active topics in this process.
       */
      list: () => {
        if (adapter.listTopics) {
          return adapter.listTopics();
        }
        return [];
      },

      /**
       * Check if a topic has active subscribers.
       */
      has: (topic: string) => {
        if (adapter.hasTopic) {
          return adapter.hasTopic(topic);
        }
        return false;
      },
    };

    const enhanced = Object.assign(router, {
      publish,
      subscriptions,
    }) as Router<TConn, { pubsub: true }>;

    (enhanced as any).__caps = { pubsub: true };
    return enhanced;
  };
}
