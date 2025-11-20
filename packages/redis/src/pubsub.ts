// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubDriver,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core/pubsub";
import { memoryPubSub } from "@ws-kit/memory";

/**
 * Redis client interface (minimal subset required for pub/sub).
 */
export interface RedisClient {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * Options for Redis pub/sub driver.
 */
export interface RedisPubSubOptions {
  /**
   * Channel prefix for all pub/sub messages.
   * Useful for isolating multiple deployments on the same Redis instance.
   * @default ""
   */
  channelPrefix?: string;

  /**
   * Custom encoder for PublishEnvelope → string.
   * @default JSON.stringify
   */
  encode?: (envelope: PublishEnvelope) => string;

  /**
   * Custom decoder for string → PublishEnvelope.
   * @default JSON.parse
   */
  decode?: (data: string) => PublishEnvelope;
}

/**
 * Redis pub/sub driver: subscription index + broker publish.
 *
 * Maintains a local subscription index and broadcasts messages to Redis.
 * Router/platform is responsible for consuming inbound broker messages via BrokerConsumer.
 *
 * **Capability**: Returns `capability: "unknown"` since Redis Pub/Sub cannot
 * reliably count global subscribers across all instances.
 *
 * Usage:
 * ```ts
 * import { redisPubSub, redisConsumer } from "@ws-kit/redis";
 * import { createClient } from "redis";
 *
 * const redis = createClient();
 * const driver = redisPubSub(redis);
 * const consumer = redisConsumer(redis);
 *
 * // Wire consumer to router delivery
 * consumer.start((envelope) => deliverLocally(driver, envelope));
 * ```
 */
export function redisPubSub(
  redis: RedisClient,
  opts?: RedisPubSubOptions,
): PubSubDriver {
  const {
    channelPrefix = "",
    encode = JSON.stringify,
    decode = JSON.parse,
  } = opts ?? {};

  // Maintain local subscription index
  const local = memoryPubSub();

  const channelFor = (topic: string): string => `${channelPrefix}${topic}`;

  return {
    async publish(
      envelope: PublishEnvelope,
      opts?: PublishOptions,
    ): Promise<PublishResult> {
      // Redis pub/sub is distributed and can't track per-instance senders.
      // Reject excludeSelf to guide users toward explicit filtering in handlers.
      if (opts?.excludeSelf === true) {
        return {
          ok: false,
          error: "UNSUPPORTED",
          retryable: false,
          adapter: "RedisPubSub",
          details: {
            feature: "excludeSelf",
            reason: "Distributed adapter has no sender context",
          },
        };
      }

      // Publish to broker (fire-and-forget style; errors are async)
      const channel = channelFor(envelope.topic);
      const message = encode(envelope);

      try {
        await redis.publish(channel, message);
      } catch (err) {
        // Log error but don't fail the entire publish
        console.error(`[redisPubSub] publish to ${channel} failed:`, err);
      }

      // Return capability only (Redis can't reliably count global subscribers)
      return {
        ok: true,
        capability: "unknown", // Distributed adapter: can't know global count
      };
    },

    subscribe: (clientId: string, topic: string): Promise<void> =>
      local.subscribe(clientId, topic),

    unsubscribe: (clientId: string, topic: string): Promise<void> =>
      local.unsubscribe(clientId, topic),

    getSubscribers: (topic: string): AsyncIterable<string> =>
      local.getSubscribers(topic),

    ...(local.listTopics && { listTopics: local.listTopics.bind(local) }),

    ...(local.hasTopic && { hasTopic: local.hasTopic.bind(local) }),
  } as PubSubDriver;
}
