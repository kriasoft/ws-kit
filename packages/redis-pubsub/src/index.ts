/**
 * @ws-kit/redis-pubsub - Redis PubSub adapter
 *
 * Optional Redis-based PubSub adapter providing:
 * - createRedisPubSub() factory returning PubSub implementation
 * - Cross-process broadcasting for multi-server deployments
 * - Connection pooling and automatic reconnection with exponential backoff
 * - Channel namespace support for multi-tenancy
 * - Works with any platform adapter (Bun, Cloudflare, Node.js, etc.)
 *
 * Example usage:
 *
 * ```typescript
 * import { createZodRouter } from "@ws-kit/zod";
 * import { createBunAdapter } from "@ws-kit/bun";
 * import { createRedisPubSub } from "@ws-kit/redis-pubsub";
 *
 * const router = createZodRouter({
 *   platform: createBunAdapter(),
 *   pubsub: createRedisPubSub({ url: "redis://localhost:6379" }),
 * });
 * ```
 */

import { RedisPubSub } from "./pubsub.js";
import type { RedisPubSubOptions } from "./types.js";

export { RedisPubSub };
export type { RedisPubSubOptions, MessageHandler } from "./types.js";
export {
  RedisPubSubError,
  RedisConnectionError,
  RedisPublishError,
  RedisSubscribeError,
  SerializationError,
  DeserializationError,
} from "./errors.js";

/**
 * Create a Redis-based PubSub adapter
 *
 * @param options Configuration options for Redis connection and behavior
 * @returns A PubSub instance implementing cross-process broadcasting
 *
 * @example
 * ```typescript
 * // Basic usage with URL
 * const pubsub = createRedisPubSub({ url: "redis://localhost:6379" });
 *
 * // With host/port
 * const pubsub = createRedisPubSub({ host: "localhost", port: 6379 });
 *
 * // With namespace for multi-tenancy
 * const pubsub = createRedisPubSub({
 *   url: "redis://localhost:6379",
 *   namespace: "myapp:prod",
 * });
 *
 * // With pre-configured Redis client
 * import { createClient } from "redis";
 * const redisClient = createClient({ url: "redis://localhost:6379" });
 * await redisClient.connect();
 * const pubsub = createRedisPubSub({ client: redisClient });
 * ```
 */
export function createRedisPubSub(options?: RedisPubSubOptions) {
  return new RedisPubSub(options);
}
