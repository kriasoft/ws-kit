// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Policy, RateLimitDecision, RateLimiter } from "@ws-kit/core";
import type { BrokerConsumer, PubSubDriver } from "@ws-kit/core/pubsub";

/**
 * Cloudflare Durable Object namespace interface
 * (compatible with Cloudflare Workers environment)
 */
export interface DurableObjectNamespace {
  get(id: DurableObjectId): DurableObjectStub;
  idFromName(name: string): DurableObjectId;
}

// Re-export pub/sub types and factories
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
 * Token bucket stored in Durable Object storage.
 *
 * @internal
 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
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
export function durableObjectRateLimiter(
  namespace: DurableObjectNamespace,
  policy: Policy,
  opts?: DurableObjectRateLimiterOptions,
): RateLimiter {
  // Validate policy at factory creation time
  if (policy.capacity < 1) {
    throw new Error("Rate limit capacity must be ≥ 1");
  }
  if (policy.tokensPerSecond <= 0) {
    throw new Error("tokensPerSecond must be > 0");
  }

  const { capacity, tokensPerSecond, prefix } = policy;
  const shardCount = opts?.shards ?? 128;

  // Validate shard count to prevent invalid DO names
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error("Shard count must be a positive integer");
  }

  // Create immutable policy snapshot for getPolicy()
  const policySnapshot: Policy = Object.freeze({
    capacity,
    tokensPerSecond,
    ...(prefix !== undefined && { prefix }),
  }) as Policy;

  /**
   * FNV-1a hash for deterministic key-to-shard distribution.
   * Fast, simple, and good distribution properties.
   */
  function hashKey(key: string): number {
    let hash = 2166136261; // FNV offset basis (32-bit)
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      // FNV prime (32-bit): (hash * 16777619) >>> 0
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0; // Ensure 32-bit unsigned
  }

  /**
   * Map a rate limit key to a Durable Object shard name.
   */
  function getShardName(key: string): string {
    const shard = hashKey(key) % shardCount;
    return `rate-limiter-${shard}`;
  }

  return {
    getPolicy() {
      return policySnapshot;
    },

    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      // Apply prefix if configured (isolates multiple policies)
      const prefixedKey = prefix ? `${prefix}${key}` : key;

      // Get the Durable Object shard for this key
      const shardName = getShardName(prefixedKey);
      const doId = namespace.idFromName(shardName);
      const stub = namespace.get(doId);

      // Send consume request to the DO shard
      const response = await stub.fetch("https://internal/consume", {
        method: "POST",
        body: JSON.stringify({
          key: prefixedKey,
          cost,
          capacity,
          tokensPerSecond,
        }),
      });

      // Parse and return the decision
      const result = await response.json();
      return result as RateLimitDecision;
    },
  };
}

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
export class RateLimiterDO {
  private state: DurableObjectState;
  private bucketPrefix = "bucket:";
  private alarmScheduled = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Handle incoming consume requests.
   * Single request handler ensures atomicity (single-threaded per shard).
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/consume" && request.method === "POST") {
      try {
        const payload = (await request.json()) as Record<string, unknown>;

        const key = payload.key as string;
        const cost = payload.cost as number;
        const capacity = payload.capacity as number;
        const tokensPerSecond = payload.tokensPerSecond as number;
        const now = Date.now();

        // Load bucket from storage (or initialize if missing)
        const storageKey = this.bucketPrefix + key;
        const stored = await this.state.storage.get<TokenBucket>(storageKey);
        const bucket = stored ?? { tokens: capacity, lastRefill: now };

        // Refill based on elapsed time
        const elapsed = Math.max(0, (now - bucket.lastRefill) / 1000);
        bucket.tokens = Math.min(
          capacity,
          bucket.tokens + Math.floor(elapsed * tokensPerSecond),
        );
        bucket.lastRefill = now;

        // Check if cost can be satisfied
        if (bucket.tokens < cost) {
          // Blocked: compute retry time or null if impossible
          const retryAfterMs =
            cost > capacity
              ? null
              : Math.ceil(((cost - bucket.tokens) / tokensPerSecond) * 1000);

          // Persist bucket
          await this.state.storage.put(storageKey, bucket);

          return Response.json({
            allowed: false,
            remaining: Math.floor(bucket.tokens),
            retryAfterMs,
          });
        }

        // Allowed: deduct cost
        bucket.tokens -= cost;
        await this.state.storage.put(storageKey, bucket);

        // Schedule periodic cleanup (once per shard)
        // Runs hourly to clean up stale buckets (inactive for 24h)
        if (!this.alarmScheduled) {
          this.alarmScheduled = true;
          const alarmMs = Date.now() + 3_600_000; // 1 hour
          await this.state.storage.setAlarm(alarmMs);
        }

        return Response.json({
          allowed: true,
          remaining: Math.floor(bucket.tokens),
        });
      } catch (err) {
        return new Response(`Error: ${err}`, { status: 400 });
      }
    }

    return new Response("Not found", { status: 404 });
  }

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
  async alarm(): Promise<void> {
    const now = Date.now();
    const maxAge = 86_400_000; // 24 hours in milliseconds
    const cutoff = now - maxAge;

    // Cursor-based pagination: process large key sets in batches
    let cursor: string | undefined;
    do {
      const listOptions: { prefix: string; limit: number; cursor?: string } = {
        prefix: this.bucketPrefix,
        limit: 1000, // Process 1k keys per iteration
      };
      if (cursor !== undefined) {
        listOptions.cursor = cursor;
      }

      const batch = await this.state.storage.list<TokenBucket>(listOptions);

      // Delete stale buckets (inactive for 24h)
      for (const [key, bucket] of batch) {
        if (bucket && bucket.lastRefill < cutoff) {
          await this.state.storage.delete(key);
        }
      }

      cursor = (batch as unknown as Record<string, unknown>).cursor as
        | string
        | undefined;
    } while (cursor);

    // Reschedule alarm for next hour
    await this.state.storage.setAlarm(now + 3_600_000);
  }
}
