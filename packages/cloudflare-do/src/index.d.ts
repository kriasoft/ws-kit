import type { Policy, RateLimiter } from "@ws-kit/core";
import type { BrokerConsumer, PubSubDriver } from "@ws-kit/core/pubsub";
/**
 * Cloudflare Durable Object namespace interface
 * (compatible with Cloudflare Workers environment)
 */
export interface DurableObjectNamespace {
  get(id: DurableObjectId): DurableObjectStub;
  idFromName(name: string): DurableObjectId;
}
export { durableObjectsPubSub } from "./pubsub.js";
export type { CloudflareDOPubSubOptions } from "./pubsub.js";
export { durableObjectsConsumer } from "./consumer.js";
export type { CloudflareDOConsumerOptions } from "./consumer.js";
export { handleDOPublish } from "./consumer.js";
export type { BrokerConsumer, PubSubDriver };
export interface DurableObjectId {
  readonly id: string;
}
export interface DurableObjectStub {
  fetch(request: Request | string, options?: RequestInit): Promise<Response>;
}
export interface DurableObjectState {
  storage: DurableObjectStorage;
}
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list<T = unknown>(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}
/**
 * Options for Durable Objects rate limiter.
 */
export interface DurableObjectRateLimiterOptions {
  /**
   * Number of shards to distribute rate limit keys across.
   *
   * @default 128
   *
   * Higher shard count distributes load better but creates more Durable Objects.
   * 128 shards is a good balance for most applications.
   */
  shards?: number;
}
/**
 * Distributed rate limiter using Cloudflare Durable Objects.
 *
 * Suitable for Cloudflare Workers deployments. Uses sharding to distribute
 * rate limit keys across multiple Durable Objects for horizontal scalability.
 * Single-threaded per shard ensures atomicity without explicit locking.
 *
 * **Atomicity**: Each shard is single-threaded. All operations on a key are
 * serialized by the Durable Object runtime, preventing race conditions.
 *
 * **Distributed Clock**: Uses `Date.now()` with consistent semantics across
 * all shards (Cloudflare guarantees synchronized clocks).
 *
 * **Sharding**: Uses FNV-1a hash to deterministically map keys to shards.
 * All users with the same key always go to the same shard.
 *
 * **Cleanup**: Mark-and-sweep hourly; deletes buckets inactive for 24h.
 *
 * @param namespace - Durable Object namespace from Cloudflare environment
 * @param policy - Rate limit policy (capacity, tokensPerSecond, optional prefix)
 * @param opts - Optional configuration (shard count)
 * @returns RateLimiter instance
 * @throws Error if policy is invalid (capacity < 1 or tokensPerSecond <= 0)
 *
 * @example
 * ```typescript
 * import { durableObjectRateLimiter } from "@ws-kit/cloudflare-do";
 *
 * export default {
 *   async fetch(request, env) {
 *     const limiter = durableObjectRateLimiter(env.RATE_LIMITER, {
 *       capacity: 200,
 *       tokensPerSecond: 100,
 *     });
 *
 *     const result = await limiter.consume("user:123", 1);
 *     if (!result.allowed) {
 *       return new Response("Rate limited", { status: 429 });
 *     }
 *
 *     // Process request...
 *   },
 * };
 * ```
 */
export declare function durableObjectRateLimiter(
  namespace: DurableObjectNamespace,
  policy: Policy,
  opts?: DurableObjectRateLimiterOptions,
): RateLimiter;
/**
 * Durable Object implementation for rate limiting.
 *
 * Handles token bucket operations atomically (single-threaded per shard).
 * Implements mark-and-sweep cleanup to evict stale buckets.
 *
 * This class should be bound to a Durable Object binding in Cloudflare wrangler.toml:
 *
 * ```toml
 * [[durable_objects.bindings]]
 * name = "RATE_LIMITER"
 * class_name = "RateLimiterDO"
 * ```
 *
 * @internal
 */
export declare class RateLimiterDO {
  private state;
  private bucketPrefix;
  private alarmScheduled;
  constructor(state: DurableObjectState);
  /**
   * Handle incoming consume requests.
   * Single request handler ensures atomicity (single-threaded per shard).
   */
  fetch(request: Request): Promise<Response>;
  /**
   * Alarm handler for periodic cleanup (mark-and-sweep).
   *
   * Scans all buckets in this shard and deletes those inactive for 24h.
   * Cursor-based pagination prevents long pauses on large key sets.
   *
   * **Tier 1 Implementation** (current):
   * - Simple mark-and-sweep: scan all buckets, check lastRefill, delete if old
   * - O(all buckets) per hour, but in 1k-key batches for responsiveness
   * - Suitable for typical deployments
   *
   * **Future Optimization** (Tier 2):
   * - Hourly segmentation: prepend hour to key format, delete only prev hour's keys
   * - O(buckets/hour) per cleanup, but adds format complexity
   */
  alarm(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map
