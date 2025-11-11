// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Memory adapter implementations for rate limiting and pub/sub.
 *
 * Exports:
 * - `memoryPubSub()` — in-memory pub/sub adapter (subscription registry, no distributed ingress)
 * - `memoryRateLimiter()` — in-memory rate limiter (token bucket algorithm)
 *
 * **Composition Utilities** (for adapter authors):
 * - See `@ws-kit/adapters/compose` for `withBroker()` and `combineBrokers()`
 */

import type { Policy, RateLimitDecision, RateLimiter } from "@ws-kit/core";
import type { PubSubAdapter } from "@ws-kit/core/pubsub";

export { memoryPubSub } from "./pubsub.js";
export type { PubSubAdapter };

/**
 * Simple FIFO async mutex for synchronizing token bucket access.
 *
 * Ensures that only one concurrent operation can modify a bucket,
 * preventing race conditions where multiple requests might double-spend tokens.
 *
 * @internal
 */
class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  /**
   * Acquire the lock, run the function, then release it.
   * If the lock is held, queue the function for later execution.
   */
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.locked = true;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.locked = false;
          const next = this.queue.shift();
          if (next) next();
        }
      };

      if (this.locked) {
        this.queue.push(run);
      } else {
        run();
      }
    });
  }
}

/**
 * Token bucket stored in memory.
 *
 * @internal
 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Clock interface for dependency injection (testing).
 *
 * Allows tests to inject a mock clock for deterministic time-travel testing.
 */
export interface Clock {
  now(): number;
}

/**
 * Memory adapter options.
 */
export interface MemoryRateLimiterOptions {
  /**
   * Optional clock for testing.
   * If not provided, uses Date.now().
   *
   * @example
   * const fakeTime = { current: Date.now() };
   * const limiter = memoryRateLimiter(policy, {
   *   clock: { now: () => fakeTime.current }
   * });
   * fakeTime.current += 1000; // Advance time
   */
  clock?: Clock;
}

/**
 * In-memory rate limiter using token bucket algorithm.
 *
 * Suitable for single-instance deployments (dev, Bun, Node.js).
 * Uses per-key mutex to ensure atomicity.
 *
 * **Token Bucket Algorithm**:
 * 1. Each key has a bucket with `tokens` and `lastRefill` timestamp
 * 2. On each consume(), refill tokens based on elapsed time:
 *    `tokens = min(capacity, tokens + floor(elapsed_seconds × tokensPerSecond))`
 * 3. Check if cost can be satisfied; if not, compute retry time
 * 4. Deduct cost and persist atomically (guarded by mutex)
 *
 * **Atomicity**: Per-key FIFO mutex prevents concurrent modifications.
 *
 * **Clock Handling**:
 * - Each adapter owns its clock (Date.now() or injected for testing)
 * - Adapters tolerate non-monotonic clocks by clamping negative elapsed time to 0
 *
 * @param policy - Rate limit policy (capacity, tokensPerSecond, optional prefix)
 * @param opts - Optional configuration (clock injection for testing)
 * @returns RateLimiter instance
 * @throws Error if policy is invalid (capacity < 1 or tokensPerSecond <= 0)
 *
 * @example
 * ```typescript
 * import { memoryRateLimiter } from "@ws-kit/adapters/memory";
 *
 * const limiter = memoryRateLimiter({
 *   capacity: 10,
 *   tokensPerSecond: 1,
 * });
 *
 * const result = await limiter.consume("user:123", 1);
 * if (!result.allowed) {
 *   console.log(`Retry after ${result.retryAfterMs}ms`);
 * }
 * ```
 */
export function memoryRateLimiter(
  policy: Policy,
  opts?: MemoryRateLimiterOptions,
): RateLimiter {
  // Validate policy at factory creation time
  if (policy.capacity < 1) {
    throw new Error("Rate limit capacity must be ≥ 1");
  }
  if (policy.tokensPerSecond <= 0) {
    throw new Error("tokensPerSecond must be > 0");
  }

  const clock = opts?.clock ?? { now: () => Date.now() };
  const { capacity, tokensPerSecond, prefix } = policy;
  const buckets = new Map<string, TokenBucket>();
  const mutexes = new Map<string, Mutex>();

  // Create an immutable snapshot of the policy for getPolicy()
  // Prevents caller mutations from affecting reported capacity
  const policySnapshot: Policy = Object.freeze({
    capacity,
    tokensPerSecond,
    ...(prefix !== undefined && { prefix }),
  }) as Policy;

  /**
   * Get or create a mutex for the given key.
   */
  function getMutex(key: string): Mutex {
    let mutex = mutexes.get(key);
    if (!mutex) {
      mutex = new Mutex();
      mutexes.set(key, mutex);
    }
    return mutex;
  }

  return {
    getPolicy() {
      return policySnapshot;
    },

    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      // Apply prefix if configured (isolates multiple policies on same backend)
      const prefixedKey = prefix ? `${prefix}${key}` : key;

      const mutex = getMutex(prefixedKey);

      return mutex.lock(async () => {
        const now = clock.now();

        // Initialize or load bucket
        let bucket = buckets.get(prefixedKey);
        if (!bucket) {
          bucket = { tokens: capacity, lastRefill: now };
        }

        // Refill based on elapsed time
        // Clamp negative elapsed to 0 to tolerate non-monotonic clocks (NTP adjustments)
        const elapsed = Math.max(0, (now - bucket.lastRefill) / 1000);

        // Integer arithmetic: accumulate refill per proposal specification
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

          // Persist bucket state
          buckets.set(prefixedKey, bucket);

          return {
            allowed: false,
            remaining: Math.floor(bucket.tokens),
            retryAfterMs,
          };
        }

        // Allowed: deduct cost and persist
        bucket.tokens -= cost;
        buckets.set(prefixedKey, bucket);

        return { allowed: true, remaining: Math.floor(bucket.tokens) };
      });
    },

    dispose() {
      // Clear all state
      buckets.clear();
      mutexes.clear();
    },
  };
}
