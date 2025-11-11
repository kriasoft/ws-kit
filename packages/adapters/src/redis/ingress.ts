// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { BrokerConsumer, PublishEnvelope } from "@ws-kit/core/pubsub";

/**
 * Redis client interface for consumer (subscription-only operations).
 */
export interface RedisConsumerClient {
  psubscribe(
    pattern: string,
    handler: (message: string, channel: string) => void | Promise<void>,
  ): Promise<() => void>;

  subscribe(
    channel: string,
    handler: (message: string) => void | Promise<void>,
  ): Promise<() => void>;

  unsubscribe(channel: string): Promise<void>;
}

/**
 * Options for Redis consumer.
 */
export interface RedisConsumerOptions {
  /**
   * Channel prefix matching the adapter's prefix.
   * @default ""
   */
  channelPrefix?: string;

  /**
   * Custom decoder for string → PublishEnvelope.
   * @default JSON.parse
   */
  decode?: (data: string) => PublishEnvelope;

  /**
   * Use pattern subscription (PSUBSCRIBE) for all topics.
   * If true, subscribes to `{prefix}*` pattern once.
   * If false, subscribes to topics dynamically as they appear.
   * @default true
   */
  patternSubscribeAll?: boolean;
}

/**
 * Redis broker consumer: consumes messages from Redis pub/sub and invokes handler.
 *
 * **Responsibility**: Subscribe to Redis channels and call `onMessage(envelope)`.
 * **Not responsibility**: Subscription indexing, local delivery, driver state.
 *
 * Works with `redisPubSub()` driver; router/platform wires the delivery:
 * ```ts
 * const driver = redisPubSub(redis);
 * const consumer = redisConsumer(redis);
 *
 * consumer.start((envelope) => {
 *   // router calls deliverLocally(driver, envelope)
 * });
 * ```
 *
 * **Pattern subscription** (default):
 * - Single PSUBSCRIBE to `{prefix}*` covers all topics dynamically
 * - New topics appear immediately without restart
 * - Simpler, fewer subscriptions
 *
 * **Per-topic subscription**:
 * - Subscribe only to topics that have local subscribers
 * - Requires polling or event hooks to track topic changes
 * - More selective, less overhead if few topics
 */
export function redisConsumer(
  redis: RedisConsumerClient,
  opts?: RedisConsumerOptions,
): BrokerConsumer {
  const {
    channelPrefix = "",
    decode = JSON.parse,
    patternSubscribeAll = true,
  } = opts ?? {};

  let unsubscriber: (() => void) | null = null;

  return {
    start(onMessage: (envelope: PublishEnvelope) => void | Promise<void>) {
      if (unsubscriber) {
        throw new Error("[redisConsumer] Already started");
      }

      if (patternSubscribeAll) {
        // Use PSUBSCRIBE to subscribe to all topics matching prefix pattern
        const pattern = `${channelPrefix}*`;

        (async () => {
          try {
            unsubscriber = await redis.psubscribe(pattern, (message) => {
              try {
                const envelope = decode(message);
                onMessage(envelope);
              } catch (err) {
                console.error("[redisIngress] Failed to decode message:", err);
              }
            });
          } catch (err) {
            console.error("[redisConsumer] psubscribe failed:", err);
          }
        })();
      } else {
        // Per-topic subscription: subscribe only to topics as they appear
        // This would require integration with driver or router to track topic changes
        // For now, fall back to pattern subscription
        console.warn(
          "[redisConsumer] Per-topic subscription not yet implemented; using pattern",
        );

        (async () => {
          try {
            unsubscriber = await redis.psubscribe(
              `${channelPrefix}*`,
              (message) => {
                try {
                  const envelope = decode(message);
                  onMessage(envelope);
                } catch (err) {
                  console.error(
                    "[redisConsumer] Failed to decode message:",
                    err,
                  );
                }
              },
            );
          } catch (err) {
            console.error("[redisConsumer] psubscribe failed:", err);
          }
        })();
      }

      return () => {
        if (unsubscriber) {
          unsubscriber();
          unsubscriber = null;
        }
      };
    },
  };
}
