// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
  StopFn,
} from "@ws-kit/core/pubsub";
import { memoryPubSub } from "@ws-kit/memory";
import type { RedisConsumerClient } from "./consumer.js";

/**
 * Redis client interface (minimal subset required for pub/sub).
 */
export interface RedisClient {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * Extended Redis client interface with duplicate() capability.
 * node-redis and ioredis both support this pattern.
 */
export interface RedisClientWithDuplicate extends RedisClient {
  duplicate(): RedisConsumerClient & {
    connect(): Promise<void>;
    quit(): Promise<string>;
  };
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

  /**
   * Explicit subscriber client for broker integration.
   *
   * **When omitted** (recommended for most users):
   * If the publisher client supports `duplicate()`, a subscriber connection
   * is created automatically during `router.pubsub.init()` and cleaned up
   * on shutdown. This is the simplest and safest pattern.
   *
   * **When provided** (advanced use cases):
   * Use a separate subscriber for read replicas, different auth, or
   * custom retry strategies. Must be a different connection than publisher.
   *
   * @example
   * ```ts
   * // Simple (auto-subscriber via duplicate)
   * const redis = createClient({ url: REDIS_URL });
   * await redis.connect();
   * const adapter = redisPubSub(redis);
   *
   * // Advanced (explicit subscriber for read replica)
   * const pub = createClient({ url: REDIS_URL });
   * const sub = createClient({ url: REDIS_REPLICA_URL });
   * await Promise.all([pub.connect(), sub.connect()]);
   * const adapter = redisPubSub(pub, { subscriber: sub });
   * ```
   */
  subscriber?: RedisConsumerClient;
}

/**
 * Redis pub/sub adapter: subscription index + broker publish + broker consume.
 *
 * Maintains a local subscription index and broadcasts messages via Redis.
 * When subscriber capability is available, includes `start()` for distributed
 * deployments - the plugin calls `start(deliverLocally)` during `router.pubsub.init()`.
 *
 * **Subscriber handling**:
 * - If `subscriber` option is provided, uses it directly (distributed mode)
 * - If omitted and client supports `duplicate()`, auto-creates subscriber (distributed mode)
 * - If omitted and no `duplicate()`, `start()` is omitted (local-only mode with Redis egress)
 *
 * **Capability**: Returns `capability: "unknown"` since Redis Pub/Sub cannot
 * reliably count global subscribers across all instances.
 *
 * @example
 * ```ts
 * // Simple: auto-subscriber (90% of users)
 * const redis = createClient({ url: REDIS_URL });
 * await redis.connect();
 * const adapter = redisPubSub(redis);
 * await router.pubsub.init(); // Connects subscriber automatically
 *
 * // Advanced: explicit subscriber (read replicas, different auth)
 * const pub = createClient({ url: REDIS_URL });
 * const sub = createClient({ url: REDIS_REPLICA_URL });
 * await Promise.all([pub.connect(), sub.connect()]);
 * const adapter = redisPubSub(pub, { subscriber: sub });
 * ```
 */
export function redisPubSub(
  redis: RedisClient,
  opts?: RedisPubSubOptions,
): PubSubAdapter {
  const {
    channelPrefix = "",
    encode = JSON.stringify,
    decode = JSON.parse,
    subscriber: explicitSubscriber,
  } = opts ?? {};

  // Fail-fast: subscriber must be a different connection
  if (explicitSubscriber && explicitSubscriber === (redis as unknown)) {
    throw new Error(
      "[redisPubSub] subscriber must be a separate connection " +
        "(Redis pub/sub requires two connections)",
    );
  }

  // Maintain local subscription index
  const local = memoryPubSub();

  const channelFor = (topic: string): string => `${channelPrefix}${topic}`;

  // Track auto-created subscriber for cleanup
  let autoSubscriber:
    | (RedisConsumerClient & { quit(): Promise<string> })
    | null = null;
  let unsubscriber: (() => void) | null = null;

  // start() is conditionally included based on subscriber capability
  const startFn = async (
    onRemote: (envelope: PublishEnvelope) => void | Promise<void>,
  ): Promise<StopFn> => {
    if (unsubscriber) {
      throw new Error("[redisPubSub] Already started");
    }

    // Resolve subscriber: explicit > auto-duplicate > error
    let subscriber: RedisConsumerClient;

    if (explicitSubscriber) {
      subscriber = explicitSubscriber;
    } else if (
      "duplicate" in redis &&
      typeof (redis as RedisClientWithDuplicate).duplicate === "function"
    ) {
      // Auto-create subscriber via duplicate()
      // Set autoSubscriber BEFORE connect so cleanup happens on failure
      const duplicated = (redis as RedisClientWithDuplicate).duplicate();
      autoSubscriber = duplicated;
      try {
        await duplicated.connect();
      } catch (err) {
        // Clean up on connect failure
        try {
          await autoSubscriber.quit();
        } catch {
          // Ignore quit errors during cleanup
        }
        autoSubscriber = null;
        throw err;
      }
      subscriber = duplicated;
    } else {
      throw new Error(
        "[redisPubSub] No subscriber provided and Redis client doesn't support duplicate(). " +
          "Pass a separate subscriber connection: redisPubSub(publisher, { subscriber })",
      );
    }

    // Use PSUBSCRIBE to subscribe to all topics matching prefix pattern
    // Await subscription to guarantee broker readiness before init() returns
    const pattern = `${channelPrefix}*`;

    try {
      unsubscriber = await subscriber.psubscribe(pattern, (message) => {
        let envelope: PublishEnvelope;
        try {
          envelope = decode(message);
        } catch (err) {
          console.error("[redisPubSub] Failed to decode message:", err);
          return;
        }
        // Use .then() to convert sync throws to rejections, separating from decode errors
        void Promise.resolve()
          .then(() => onRemote(envelope))
          .catch((err) => {
            console.error("[redisPubSub] Error in delivery callback:", err);
          });
      });
    } catch (err) {
      // Clean up auto-created subscriber on psubscribe failure
      if (autoSubscriber) {
        try {
          await autoSubscriber.quit();
        } catch {
          // Ignore quit errors during cleanup
        }
        autoSubscriber = null;
      }
      throw err;
    }

    return async () => {
      if (unsubscriber) {
        unsubscriber();
        unsubscriber = null;
      }

      // Clean up auto-created subscriber
      if (autoSubscriber) {
        try {
          await autoSubscriber.quit();
        } catch {
          // Ignore quit errors during shutdown
        }
        autoSubscriber = null;
      }
    };
  };

  return {
    async publish(
      envelope: PublishEnvelope,
      opts?: PublishOptions,
    ): Promise<PublishResult> {
      // excludeSelf filtering is handled by the pubsub plugin's deliverLocally()
      // via excludeClientId in envelope.meta. Adapter forwards full envelope to broker
      // so receiving instances can filter. Internal fields are stripped before
      // WebSocket serialization in deliverLocally(), not here.
      void opts;

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

    // Include start() only when subscriber capability exists (explicit or via duplicate())
    // When start() is present, init() MUST be called; otherwise messages won't be delivered
    ...((explicitSubscriber ||
      ("duplicate" in redis &&
        typeof (redis as RedisClientWithDuplicate).duplicate ===
          "function")) && { start: startFn }),
  };
}
