// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Policy, RateLimitDecision, RateLimiter } from "@ws-kit/core";
import type { BrokerConsumer, PubSubDriver } from "@ws-kit/core/pubsub";

/**
 * Redis client interface (compatible with redis, ioredis, etc.)
 *
 * Supports both rate limiting and pub/sub operations.
 */
export interface RedisClient {
  // Rate limiting
  evalsha(
    sha: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  scriptLoad(script: string): Promise<string>;

  // Pub/sub
  publish?(channel: string, message: string): Promise<number>;
  psubscribe?(
    pattern: string,
    handler: (message: string, channel: string) => void | Promise<void>,
  ): Promise<() => void>;
  subscribe?(
    channel: string,
    handler: (message: string) => void | Promise<void>,
  ): Promise<() => void>;
  unsubscribe?(channel: string): Promise<void>;
}

// Re-export pub/sub types and factories
export { redisPubSub } from "./pubsub.js";
export type { RedisPubSubOptions } from "./pubsub.js";
export { redisConsumer } from "./ingress.js";
export type { RedisConsumerOptions } from "./ingress.js";
export type { BrokerConsumer, PubSubDriver };

/**
 * Options for Redis rate limiter.
 */
export interface RedisRateLimiterOptions {
  /**
   * Optional TTL for rate limit buckets in milliseconds.
   *
   * Default: `max(2 * capacity / tokensPerSecond * 1000, 60_000)` milliseconds
   *
   * This represents the time needed for the bucket to fully refill twice from empty,
   * with a minimum of 1 minute. Idle keys expire automatically; active keys stay fresh.
   *
   * @example
   * // Override default TTL to 2 minutes
   * { ttlMs: 120_000 }
   */
  ttlMs?: number;
}

/**
 * Distributed rate limiter using Redis and Lua scripts.
 *
 * Suitable for multi-pod production deployments. Uses Lua scripts for atomic
 * token bucket mutations on the server side, preventing race conditions across
 * concurrent requests in different pods.
 *
 * **Atomicity**: Single EVALSHA call to Redis executes the entire token bucket
 * algorithm atomically. No race window between read and write.
 *
 * **Distributed Clock**: Uses `redis.call('TIME')` for server-authoritative time.
 * All pods see the same clock, ensuring consistent rate limiting across deployments.
 *
 * **TTL and Cleanup**: Calls `PEXPIRE` on every `consume()` to auto-evict stale buckets.
 * Default TTL is `max(2 * capacity / tokensPerSecond * 1000, 60_000)` milliseconds.
 *
 * **Script Caching**: Preloads Lua script on first use via `SCRIPT LOAD`.
 * On `NOSCRIPT` error (script evicted), reloads and retries.
 *
 * @param client - Redis client instance (e.g., from redis library)
 * @param policy - Rate limit policy (capacity, tokensPerSecond, optional prefix)
 * @param opts - Optional configuration (TTL override)
 * @returns RateLimiter instance
 * @throws Error if policy is invalid (capacity < 1 or tokensPerSecond <= 0)
 *
 * @example
 * ```typescript
 * import { createClient } from "redis";
 * import { redisRateLimiter } from "@ws-kit/adapters/redis";
 *
 * const client = createClient({ url: "redis://localhost:6379" });
 * await client.connect();
 *
 * const limiter = redisRateLimiter(client, {
 *   capacity: 200,
 *   tokensPerSecond: 100,
 * });
 *
 * const result = await limiter.consume("user:123", 1);
 * if (!result.allowed) {
 *   console.log(`Retry after ${result.retryAfterMs}ms`);
 * }
 * ```
 */
export function redisRateLimiter(
  client: RedisClient,
  policy: Policy,
  opts?: RedisRateLimiterOptions,
): RateLimiter {
  // Validate policy at factory creation time
  if (policy.capacity < 1) {
    throw new Error("Rate limit capacity must be ≥ 1");
  }
  if (policy.tokensPerSecond <= 0) {
    throw new Error("tokensPerSecond must be > 0");
  }

  const { capacity, tokensPerSecond, prefix } = policy;

  // Calculate default TTL: time for bucket to refill twice, minimum 1 minute
  // Allows long-idle users to come back and refill, then auto-evict
  // Always round up to ensure integer milliseconds for PEXPIRE
  const keyTtlMs =
    opts?.ttlMs ??
    Math.max(Math.ceil(((2 * capacity) / tokensPerSecond) * 1000), 60_000);

  // Create immutable policy snapshot for getPolicy()
  const policySnapshot: Policy = Object.freeze({
    capacity,
    tokensPerSecond,
    ...(prefix !== undefined && { prefix }),
  }) as Policy;

  let scriptSha = "";
  let scriptLoadingPromise: Promise<string> | null = null;

  // Lua script for atomic token bucket operations
  // All operations happen atomically in Redis, preventing race conditions
  const luaScript = `
    local key = KEYS[1]
    local cost = tonumber(ARGV[1])        -- cost in tokens (positive integer; validated by middleware)
    local capacity = tonumber(ARGV[2])    -- capacity in tokens (positive integer; validated at factory)
    local refillTps = tonumber(ARGV[3])   -- refill rate in tokens/sec (positive integer; validated at factory)
    local ttlMs = tonumber(ARGV[4])       -- key expiry in milliseconds

    -- Get server time atomically (inside Lua, guarantees consistency)
    local timeResult = redis.call('TIME')
    local nowMs = tonumber(timeResult[1]) * 1000 + math.floor(tonumber(timeResult[2]) / 1000)

    -- Fetch current bucket state (returns empty table if key doesn't exist)
    local vals = redis.call('HMGET', key, 'tokens', 'last_ms')
    local tokens = tonumber(vals[1])
    local last_ms = tonumber(vals[2])

    -- Initialize bucket if missing
    if not tokens then
      tokens = capacity
      last_ms = nowMs
    end

    -- Refill based on elapsed time using integer arithmetic
    -- Formula: refill = floor(elapsed_seconds * tokensPerSecond)
    -- This ensures integer accumulation and supports sub-1 token/sec rates via scaling.
    -- Example: { capacity: 50, tokensPerSecond: 10 } represents 5.0 cap, 1.0 refill
    local elapsed_sec = math.max(0, (nowMs - last_ms) / 1000)
    if elapsed_sec > 0 then
      local refill = math.floor(elapsed_sec * refillTps)
      tokens = math.min(capacity, tokens + refill)
      last_ms = nowMs
    end

    -- Check if cost can be satisfied
    if cost > tokens then
      -- Blocked: compute retry time in milliseconds
      -- If cost > capacity, return -1 (impossible under policy; non-retryable)
      local retry_ms
      if cost > capacity then
        retry_ms = -1
      else
        local deficit = cost - tokens
        retry_ms = math.ceil((deficit / refillTps) * 1000)
      end
      redis.call('HMSET', key, 'tokens', tokens, 'last_ms', last_ms)
      redis.call('PEXPIRE', key, ttlMs)
      -- Return: [allowed, remaining, retryMs]
      return { 0, math.floor(tokens), retry_ms }
    end

    -- Allowed: deduct cost
    tokens = tokens - cost
    redis.call('HMSET', key, 'tokens', tokens, 'last_ms', last_ms)
    redis.call('PEXPIRE', key, ttlMs)
    -- Return: [allowed, remaining]
    return { 1, math.floor(tokens) }
  `;

  /**
   * Ensure Lua script is loaded in Redis.
   * Handles caching and automatic reload on NOSCRIPT error.
   */
  async function ensureScriptLoaded(): Promise<string> {
    if (scriptSha) return scriptSha;

    // Another coroutine is already loading; wait for it
    if (scriptLoadingPromise) {
      return scriptLoadingPromise;
    }

    // Load script and cache the SHA
    scriptLoadingPromise = (async () => {
      try {
        scriptSha = (await client.scriptLoad(luaScript)) as string;
        return scriptSha;
      } finally {
        scriptLoadingPromise = null;
      }
    })();

    return scriptLoadingPromise;
  }

  return {
    getPolicy() {
      return policySnapshot;
    },

    async consume(key: string, cost: number): Promise<RateLimitDecision> {
      // Apply prefix if configured (isolates multiple policies on same backend)
      const prefixedKey = prefix ? `${prefix}${key}` : key;

      // Ensure script is loaded before executing
      const sha = await ensureScriptLoaded();

      try {
        // Execute token bucket mutation atomically
        const result = (await client.evalsha(
          sha,
          1, // numKeys
          prefixedKey,
          cost,
          capacity,
          tokensPerSecond,
          keyTtlMs,
        )) as number[];

        const allowed = result[0] === 1;
        const remaining = result[1] as number;

        // Build return object based on allowed/blocked status
        if (allowed) {
          return {
            allowed: true,
            remaining,
          };
        }

        // Blocked: result[2] contains retry milliseconds or -1 if impossible
        const retryResult = result[2] as number;
        const retryAfterMs = retryResult === -1 ? null : retryResult;
        return {
          allowed: false,
          remaining,
          retryAfterMs,
        };
      } catch (err: unknown) {
        const error = err as Record<string, unknown>;

        // Script evicted from Redis; reload and retry once
        if (
          typeof error.message === "string" &&
          error.message.includes("NOSCRIPT")
        ) {
          scriptSha = ""; // Invalidate cache
          return this.consume(key, cost);
        }

        throw err;
      }
    },
  };
}
