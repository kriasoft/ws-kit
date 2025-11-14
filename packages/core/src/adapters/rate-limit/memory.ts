// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * In-memory rate limiter using token bucket algorithm.
 *
 * Suitable for development, testing, and single-server deployments.
 * Uses per-key mutex locks for atomic token consumption.
 *
 * **Guarantees**:
 * - ✅ Atomic token consumption via mutex locks
 * - ✅ Accurate timing with millisecond precision
 * - ✅ Zero external dependencies
 * - ⚠️ Not suitable for distributed systems (single-server only)
 * - ⚠️ Buckets reset on server restart
 *
 * **Usage**:
 * ```typescript
 * import { memoryRateLimiter } from "@ws-kit/core/adapters";
 *
 * const limiter = memoryRateLimiter({
 *   capacity: 100,
 *   tokensPerSecond: 10,
 * });
 *
 * router.use(rateLimit({ limiter }));
 * ```
 *
 * For production, swap to external adapter:
 * ```typescript
 * import { redisRateLimiter } from "@ws-kit/redis";
 *
 * const limiter = redisRateLimiter(redis, {
 *   capacity: 1000,
 *   tokensPerSecond: 50,
 * });
 * ```
 */

import type { RateLimitDecision, RateLimiter, Policy } from "./types";

interface BucketState {
  tokens: number;
  lastRefillTime: number;
}

/**
 * Create an in-memory rate limiter using token bucket algorithm.
 *
 * @param policy - Token bucket policy (capacity, tokensPerSecond, optional prefix)
 * @returns RateLimiter instance managing buckets in-memory
 */
export function memoryRateLimiter(policy: Policy): RateLimiter {
  // Per-key bucket state
  const buckets = new Map<string, BucketState>();
  // Per-key mutex: prevent concurrent modifications to same bucket
  const locks = new Map<string, Promise<void>>();

  /**
   * Execute a function with a lock for the given key.
   * Ensures atomic bucket updates.
   */
  async function withLock<T>(key: string, fn: () => T): Promise<T> {
    // Wait for any pending operation on this key
    const existingLock = locks.get(key) ?? Promise.resolve();

    // Create new lock
    let resolveLock: () => void;
    const newLock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    locks.set(key, newLock);

    try {
      // Wait for previous lock to complete
      await existingLock;
      // Execute function
      return await Promise.resolve(fn());
    } finally {
      // Release lock
      resolveLock!();
      locks.delete(key);
    }
  }

  /**
   * Refill tokens based on elapsed time.
   * Uses integer arithmetic: tokens = floor(elapsedSeconds * tokensPerSecond)
   */
  function refill(bucket: BucketState, now: number): void {
    const elapsedMs = Math.max(0, now - bucket.lastRefillTime); // Clamp to 0 for non-monotonic clocks
    const elapsedSeconds = elapsedMs / 1000;
    const tokensToAdd = Math.floor(elapsedSeconds * policy.tokensPerSecond);

    bucket.tokens = Math.min(policy.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefillTime = now;
  }

  return {
    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      return withLock(key, () => {
        const now = Date.now();
        const fullKey = policy.prefix ? `${policy.prefix}:${key}` : key;

        // Get or create bucket
        let bucket = buckets.get(fullKey);
        if (!bucket) {
          bucket = { tokens: policy.capacity, lastRefillTime: now };
          buckets.set(fullKey, bucket);
        }

        // Refill based on elapsed time
        refill(bucket, now);

        // Check if cost exceeds capacity (impossible under policy)
        if (cost > policy.capacity) {
          return {
            allowed: false,
            remaining: bucket.tokens,
            retryAfterMs: null, // Impossible; cost always > capacity
          };
        }

        // Try to consume
        if (bucket.tokens >= cost) {
          bucket.tokens -= cost;
          return {
            allowed: true,
            remaining: bucket.tokens,
          };
        }

        // Not enough tokens; calculate retry after
        const tokensNeeded = cost - bucket.tokens;
        const secondsNeeded = tokensNeeded / policy.tokensPerSecond;
        const retryAfterMs = Math.ceil(secondsNeeded * 1000);

        return {
          allowed: false,
          remaining: bucket.tokens,
          retryAfterMs,
        };
      });
    },

    getPolicy(): Policy {
      return { ...policy };
    },

    dispose(): void {
      buckets.clear();
      locks.clear();
    },
  };
}
