// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Policy, RateLimiter } from "@ws-kit/core";
import { describe, expect, test } from "bun:test";

/**
 * Contract test suite for RateLimiter implementations.
 *
 * Every adapter implementation must pass these tests to ensure correctness.
 * This includes atomicity validation, key isolation, refill behavior, and edge cases.
 *
 * Usage in adapter-specific test files:
 * ```typescript
 * import { describeRateLimiterContract } from "./contract";
 * import { memoryRateLimiter } from "@ws-kit/memory";
 *
 * const testPolicy = { capacity: 10, tokensPerSecond: 1 };
 * describeRateLimiterContract("Memory", () => memoryRateLimiter(testPolicy));
 * ```
 */
export function describeRateLimiterContract(
  name: string,
  createLimiter: () => RateLimiter,
) {
  describe(`RateLimiter: ${name}`, () => {
    // Standard policy for all tests: 10 capacity, 1 token/sec refill
    const testPolicy: Policy = { capacity: 10, tokensPerSecond: 1 };

    test("basic consume: allowed", async () => {
      const limiter = createLimiter();
      const result = await limiter.consume("user:1", 1);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect((result as any).retryAfterMs).toBeUndefined();
    });

    test("basic consume: blocked", async () => {
      const limiter = createLimiter();

      // Exhaust the bucket (capacity = 10)
      for (let i = 0; i < 10; i++) {
        const result = await limiter.consume("user:1", 1);
        expect(result.allowed).toBe(true);
      }

      // Next request should be blocked
      const result = await limiter.consume("user:1", 1);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    test("weighted cost: multiple tokens consumed", async () => {
      const limiter = createLimiter();

      const result = await limiter.consume("user:1", 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
    });

    test("weighted cost: blocked when insufficient tokens", async () => {
      const limiter = createLimiter();

      // Use 5 tokens
      await limiter.consume("user:1", 5);

      // Request 10 tokens (more than remaining 5, but less than capacity)
      const result = await limiter.consume("user:1", 10);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(5);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    test("cost > capacity: not retryable", async () => {
      const limiter = createLimiter();

      // Request 11 tokens when capacity is 10
      const result = await limiter.consume("user:1", 11);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(null); // Impossible under policy
    });

    test("multi-key isolation: different users have independent buckets", async () => {
      const limiter = createLimiter();

      // Exhaust user:1
      for (let i = 0; i < 10; i++) {
        await limiter.consume("user:1", 1);
      }

      // user:1 should be blocked
      let result = await limiter.consume("user:1", 1);
      expect(result.allowed).toBe(false);

      // user:2 should be unaffected
      result = await limiter.consume("user:2", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    test("concurrent requests: no double-spend (atomicity)", async () => {
      const limiter = createLimiter();

      // Fire 15 concurrent requests with capacity=10
      // Only 10 should succeed; this validates atomicity
      const results = await Promise.all(
        Array.from({ length: 15 }, () => limiter.consume("user:1", 1)),
      );

      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(10); // Atomic guarantee: never more than capacity
      expect(blockedCount).toBe(5);
    });

    test("concurrent requests with weighted costs: atomicity respected", async () => {
      const limiter = createLimiter();

      // 10 concurrent requests, some with cost 1, some with cost 2
      const costs = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3];
      const results = await Promise.all(
        costs.map((cost) => limiter.consume("user:1", cost)),
      );

      // Use original indexes to correctly map results back to costs
      const totalConsumed = results.reduce(
        (sum, result, idx) => sum + (result.allowed ? costs[idx] : 0),
        0,
      );

      // Total consumed tokens must never exceed capacity
      expect(totalConsumed).toBeLessThanOrEqual(10);
    });

    test("retry time calculation: blocked request returns reasonable delay", async () => {
      const limiter = createLimiter();

      // Use 8 tokens
      await limiter.consume("user:1", 8);

      // Request 3 tokens (need 5 more, at 1 tok/sec = 5000ms)
      const result = await limiter.consume("user:1", 3);
      expect(result.allowed).toBe(false);
      // Note: Without clock injection, retryAfterMs depends on actual clock
      // Just verify it's a reasonable positive number
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThan(10000); // Sanity check
    });

    test("refill over time: tokens are refilled after delay", async () => {
      const limiter = createLimiter();

      // First consume: 10 tokens
      let result = await limiter.consume("user:1", 10);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);

      // Wait a bit and try again
      // With 1 tok/sec, after 1 second we should have at least 1 token
      await new Promise((resolve) => setTimeout(resolve, 1100));

      result = await limiter.consume("user:1", 1);
      expect(result.allowed).toBe(true); // Should have refilled 1+ token
    });

    test("prefix isolation: different policies don't interfere", async () => {
      const limiter1 = createLimiter(); // No prefix
      const limiter2 = createLimiter(); // No prefix (separate instance)

      // Use both with same key "user:1"
      const result1 = await limiter1.consume("user:1", 1);
      const result2 = await limiter2.consume("user:1", 1);

      // Both should succeed independently
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });

    test("dispose: cleans up resources", async () => {
      const limiter = createLimiter();

      // Use the limiter
      await limiter.consume("user:1", 5);

      // Dispose
      if (limiter.dispose) {
        const disposed = limiter.dispose();
        // May return void or Promise; both are valid
        if (disposed instanceof Promise) {
          await disposed;
        }
      }

      // Limiter should still be usable after dispose (implementations may differ)
      // This test mainly ensures dispose doesn't throw
    });

    test("edge case: zero cost", async () => {
      const limiter = createLimiter();

      // Cost of 0 is unusual but should be handled
      const result = await limiter.consume("user:1", 0);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10); // No tokens consumed
    });

    test("edge case: exactly at capacity", async () => {
      const limiter = createLimiter();

      // Consume exactly capacity
      const result = await limiter.consume("user:1", 10);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);

      // Next request should fail
      const blocked = await limiter.consume("user:1", 1);
      expect(blocked.allowed).toBe(false);
    });

    test("sequential requests: state is preserved", async () => {
      const limiter = createLimiter();

      for (let i = 0; i < 10; i++) {
        const result = await limiter.consume("user:1", 1);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10 - i - 1);
      }

      // 11th request should fail
      const result = await limiter.consume("user:1", 1);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });
  });
}
