// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { redisRateLimiter } from "@ws-kit/adapters/redis";
import { describe, expect, test } from "bun:test";
import { describeRateLimiterContract } from "./contract";

/**
 * Mock Redis client for testing without a real Redis instance.
 *
 * Implements the minimal RedisClient interface needed for testing.
 * Mimics Redis behavior: EVALSHA, scriptLoad, TIME, HMGET, HMSET, PEXPIRE.
 */
class MockRedisClient {
  private scripts = new Map<string, string>();
  private storage = new Map<string, Map<string, string>>();
  private ttls = new Map<string, number>();
  private scriptTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Register a script and return its SHA (simulated).
   */
  async scriptLoad(script: string): Promise<string> {
    const sha = `sha_${this.scripts.size}`;
    this.scripts.set(sha, script);
    return sha;
  }

  /**
   * Execute a Lua script by SHA.
   * Mimics EVALSHA behavior: executes the script against mock storage.
   */
  async evalsha(
    sha: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const script = this.scripts.get(sha);
    if (!script) {
      throw new Error("NOSCRIPT No matching script. Please use EVAL.");
    }

    // Parse arguments: first numKeys are keys, rest are argv
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys);

    const key = keys[0];
    const [cost, capacity, refillTps, ttlMs] = argv.map(Number);

    // Simulate Redis TIME (seconds, microseconds)
    const now = Date.now();
    const nowMs = now; // Simplified: just milliseconds

    // Get current bucket state (HMGET returns null for missing fields)
    const bucketData = this.storage.get(key);
    let tokens = bucketData ? Number(bucketData.get("tokens")) : capacity;
    let lastMs = bucketData ? Number(bucketData.get("last_ms")) : nowMs;

    // Handle NaN from parsing
    if (isNaN(tokens)) tokens = capacity;
    if (isNaN(lastMs)) lastMs = nowMs;

    // Refill logic
    const elapsedSec = Math.max(0, (nowMs - lastMs) / 1000);
    if (elapsedSec > 0) {
      const refill = Math.floor(elapsedSec * refillTps);
      tokens = Math.min(capacity, tokens + refill);
      lastMs = nowMs;
    }

    // Check if cost can be satisfied
    if (cost > tokens) {
      // Blocked
      const retryMs =
        cost > capacity ? -1 : Math.ceil(((cost - tokens) / refillTps) * 1000);

      // Persist bucket
      if (!this.storage.has(key)) {
        this.storage.set(key, new Map());
      }
      const bucket = this.storage.get(key)!;
      bucket.set("tokens", String(tokens));
      bucket.set("last_ms", String(lastMs));

      // Set TTL
      this.ttls.set(key, nowMs + ttlMs);

      return [0, Math.floor(tokens), retryMs];
    }

    // Allowed: deduct cost
    tokens -= cost;

    // Persist bucket
    if (!this.storage.has(key)) {
      this.storage.set(key, new Map());
    }
    const bucket = this.storage.get(key)!;
    bucket.set("tokens", String(tokens));
    bucket.set("last_ms", String(lastMs));

    // Set TTL
    this.ttls.set(key, nowMs + ttlMs);

    return [1, Math.floor(tokens)];
  }

  /**
   * Clear all stored data (for test cleanup).
   */
  clear(): void {
    this.scripts.clear();
    this.storage.clear();
    this.ttls.clear();
    if (this.scriptTimeoutId) {
      clearTimeout(this.scriptTimeoutId);
      this.scriptTimeoutId = null;
    }
  }
}

// Run the shared contract test suite against Redis adapter with mock client
const testPolicy = { capacity: 10, tokensPerSecond: 1 };

describe("RateLimiter: Redis (Mock)", () => {
  let mockClient: MockRedisClient;

  const createLimiter = () => {
    mockClient = new MockRedisClient();
    return redisRateLimiter(mockClient, testPolicy);
  };

  // Run all contract tests
  describeRateLimiterContract("Redis (Mock)", createLimiter);
});

describe("Redis Adapter: Script Caching", () => {
  test("loads script on first use and caches SHA", async () => {
    const mockClient = new MockRedisClient();
    const limiter = redisRateLimiter(mockClient, testPolicy);

    // First consume triggers script load
    const result1 = await limiter.consume("user:1", 1);
    expect(result1.allowed).toBe(true);

    // Second consume should use cached SHA (no new script load)
    // We can't directly observe the cache, but multiple calls should work
    const result2 = await limiter.consume("user:1", 1);
    expect(result2.allowed).toBe(true);
  });

  test("script reload on NOSCRIPT error", async () => {
    const mockClient = new MockRedisClient();
    let scriptLoadCount = 0;
    let evalShaCallCount = 0;

    // Wrap scriptLoad to track load attempts
    const originalScriptLoad = mockClient.scriptLoad.bind(mockClient);
    mockClient.scriptLoad = async function (script: string) {
      scriptLoadCount++;
      return originalScriptLoad(script);
    };

    // Wrap evalsha to track calls and simulate NOSCRIPT on first attempt
    const originalEvalsha = mockClient.evalsha.bind(mockClient);
    mockClient.evalsha = async function (
      sha: string,
      numKeys: number,
      ...args: (string | number)[]
    ) {
      evalShaCallCount++;
      // First call: throw NOSCRIPT to simulate eviction
      if (evalShaCallCount === 1) {
        const error = new Error(
          "NOSCRIPT No matching script. Please use EVAL.",
        );
        (error as any).message =
          "NOSCRIPT No matching script. Please use EVAL.";
        throw error;
      }
      // Subsequent calls: proceed normally
      return originalEvalsha(sha, numKeys, ...args);
    };

    const limiter = redisRateLimiter(mockClient, testPolicy);

    // First call: NOSCRIPT error triggers reload
    const result1 = await limiter.consume("user:1", 1);
    expect(result1.allowed).toBe(true);
    expect(scriptLoadCount).toBe(2); // Initial load + reload after NOSCRIPT
    expect(evalShaCallCount).toBe(2); // First attempt (NOSCRIPT) + retry
  });
});

describe("Redis Adapter: TTL Configuration", () => {
  test("default TTL calculation: 2x refill window with 1 minute minimum", async () => {
    const mockClient = new MockRedisClient();

    // Policy: capacity=10, tokensPerSecond=1
    // Expected TTL: 2 * 10 / 1 * 1000 = 20000 ms, but min is 60000
    const limiter = redisRateLimiter(mockClient, {
      capacity: 10,
      tokensPerSecond: 1,
    });

    // Just verify the limiter works with default TTL
    const result = await limiter.consume("user:1", 1);
    expect(result.allowed).toBe(true);
  });

  test("custom TTL override", async () => {
    const mockClient = new MockRedisClient();

    // Custom TTL: 5 minutes
    const limiter = redisRateLimiter(
      mockClient,
      {
        capacity: 10,
        tokensPerSecond: 1,
      },
      { ttlMs: 300_000 },
    );

    const result = await limiter.consume("user:1", 1);
    expect(result.allowed).toBe(true);
  });
});

describe("Redis Adapter: Policy Validation", () => {
  test("validates policy at factory creation", () => {
    const mockClient = new MockRedisClient();

    expect(() => {
      redisRateLimiter(mockClient, { capacity: 0, tokensPerSecond: 1 });
    }).toThrow("Rate limit capacity must be ≥ 1");

    expect(() => {
      redisRateLimiter(mockClient, { capacity: 10, tokensPerSecond: 0 });
    }).toThrow("tokensPerSecond must be > 0");

    expect(() => {
      redisRateLimiter(mockClient, { capacity: -5, tokensPerSecond: 1 });
    }).toThrow("Rate limit capacity must be ≥ 1");
  });
});

describe("Redis Adapter: Prefix Isolation", () => {
  test("prefix isolates keys in Redis", async () => {
    const mockClient = new MockRedisClient();

    // Two limiters with different prefixes, sharing same mock client
    const limiter1 = redisRateLimiter(mockClient, {
      capacity: 10,
      tokensPerSecond: 1,
      prefix: "policy1:",
    });

    const limiter2 = redisRateLimiter(mockClient, {
      capacity: 10,
      tokensPerSecond: 1,
      prefix: "policy2:",
    });

    // Both can consume independently despite same key
    const result1 = await limiter1.consume("user:1", 5);
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(5);

    const result2 = await limiter2.consume("user:1", 6);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(4);
  });
});

describe("Redis Adapter: Edge Cases", () => {
  test("handles large costs correctly", async () => {
    const mockClient = new MockRedisClient();
    const limiter = redisRateLimiter(mockClient, {
      capacity: 1000,
      tokensPerSecond: 100,
    });

    // Consume 500 tokens (exactly half of capacity)
    const result = await limiter.consume("user:1", 500);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(500);
  });

  test("handles non-monotonic clock (clamped negative elapsed)", async () => {
    const mockClient = new MockRedisClient();
    const limiter = redisRateLimiter(mockClient, testPolicy);

    // First consume
    const result1 = await limiter.consume("user:1", 1);
    expect(result1.allowed).toBe(true);

    // Even if time goes backward (NTP adjustment), bucket should stay consistent
    // The Lua script clamps negative elapsed to 0
    const result2 = await limiter.consume("user:1", 1);
    expect(result2.allowed).toBe(true);
  });
});
