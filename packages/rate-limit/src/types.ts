// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Decision result from a rate limiter consume operation.
 *
 * When allowed=true, the operation proceeded.
 * When allowed=false, the operation was blocked; retryAfterMs indicates when to retry (or null if impossible).
 */
export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      remaining: number;
      retryAfterMs: number | null; // null means cost > capacity (impossible under policy)
    };

/**
 * Rate limiter policy configuration.
 *
 * Defines the token bucket parameters: capacity (max tokens) and refill rate.
 * Optional prefix isolates multiple policies sharing the same backend connection.
 */
export interface Policy {
  /** Bucket capacity (positive integer). Maximum tokens available. */
  capacity: number;

  /** Refill rate in tokens per second (positive number).
   * Token bucket uses integer arithmetic:
   * - At each consume(), elapsed seconds × tokensPerSecond tokens are added (floored)
   * - Supports rates ≥ 1 token/sec natively
   * - For sub-1 rates (e.g., 0.1 tok/sec), scale both values: tokensPerSecond: 1, capacity: 10 (represents 0.1×100)
   */
  tokensPerSecond: number;

  /** Optional prefix for key namespacing. Adapters prepend this to all rate limit keys to isolate multiple policies. */
  prefix?: string;
}

/**
 * Rate limiter interface (adapter contract).
 *
 * Each adapter owns the clock and implements atomicity appropriate to its backend:
 * - Memory: per-key FIFO mutex lock
 * - Redis: Lua script with TIME inside (atomic single operation)
 * - Durable Objects: single-threaded per shard with consistent clock
 *
 * Adapters must tolerate non-monotonic clocks (NTP adjustments);
 * clamp negative elapsed time to 0 to avoid invalid states.
 */
export interface RateLimiter {
  /**
   * Atomically consume tokens from a rate limit bucket.
   *
   * @param key - Rate limit key (e.g., "user:123")
   * @param cost - Number of tokens to consume (positive integer)
   * @returns Promise resolving to RateLimitDecision
   */
  consume(key: string, cost: number): Promise<RateLimitDecision>;

  /**
   * Get the policy configuration for this rate limiter.
   * **Required by all adapters.** Used by middleware to report accurate capacity in error responses.
   *
   * @returns Policy object with capacity, tokensPerSecond, and optional prefix
   */
  getPolicy(): Policy;

  /**
   * Optional: cleanup resources (connection, timers, etc.).
   * Called on app shutdown.
   *
   * Adapters may return a Promise for async cleanup (e.g., Redis client disconnection)
   * or void for synchronous cleanup. Both are supported.
   */
  dispose?(): void | Promise<void>;
}
