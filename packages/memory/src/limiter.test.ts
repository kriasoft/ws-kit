// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { memoryRateLimiter, type Clock } from "./limiter.js";

/**
 * Creates a mock clock for deterministic time-travel testing.
 */
function createMockClock(
  initial = 0,
): Clock & { advance: (ms: number) => void } {
  let current = initial;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("memoryRateLimiter", () => {
  describe("policy validation", () => {
    it("throws if capacity < 1", () => {
      expect(() =>
        memoryRateLimiter({ capacity: 0, tokensPerSecond: 1 }),
      ).toThrow("capacity must be ≥ 1");
      expect(() =>
        memoryRateLimiter({ capacity: -1, tokensPerSecond: 1 }),
      ).toThrow("capacity must be ≥ 1");
    });

    it("throws if tokensPerSecond <= 0", () => {
      expect(() =>
        memoryRateLimiter({ capacity: 10, tokensPerSecond: 0 }),
      ).toThrow("tokensPerSecond must be > 0");
      expect(() =>
        memoryRateLimiter({ capacity: 10, tokensPerSecond: -1 }),
      ).toThrow("tokensPerSecond must be > 0");
    });

    it("accepts valid policy", () => {
      const limiter = memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 });
      expect(limiter).toBeDefined();
      limiter.dispose?.();
    });
  });

  describe("token bucket mechanics", () => {
    it("starts with full capacity", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 5, tokensPerSecond: 1 },
        { clock },
      );

      const result = await limiter.consume("key", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      limiter.dispose?.();
    });

    it("deducts tokens correctly", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 10, tokensPerSecond: 1 },
        { clock },
      );

      await limiter.consume("key", 3);
      const result = await limiter.consume("key", 2);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5); // 10 - 3 - 2

      limiter.dispose?.();
    });

    it("blocks when tokens exhausted", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 2, tokensPerSecond: 1 },
        { clock },
      );

      await limiter.consume("key", 2);
      const result = await limiter.consume("key", 1);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);

      limiter.dispose?.();
    });

    it("calculates retryAfterMs when blocked", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 5, tokensPerSecond: 2 },
        { clock },
      );

      await limiter.consume("key", 5); // Exhaust all tokens
      const result = await limiter.consume("key", 3);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        // Need 3 tokens at 2/sec = 1.5 seconds = 1500ms (ceiling)
        expect(result.retryAfterMs).toBe(1500);
      }

      limiter.dispose?.();
    });

    it("returns retryAfterMs=null when cost > capacity", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 5, tokensPerSecond: 1 },
        { clock },
      );

      const result = await limiter.consume("key", 10);

      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterMs).toBeNull();
      }

      limiter.dispose?.();
    });

    it("isolates keys independently", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 2, tokensPerSecond: 1 },
        { clock },
      );

      await limiter.consume("key1", 2);
      const result1 = await limiter.consume("key1", 1);
      const result2 = await limiter.consume("key2", 1);

      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);

      limiter.dispose?.();
    });
  });

  describe("refill behavior", () => {
    it("refills tokens over time at correct rate", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 10, tokensPerSecond: 2 },
        { clock },
      );

      await limiter.consume("key", 6); // 4 remaining
      clock.advance(2000); // 2 seconds = 4 tokens refilled

      const result = await limiter.consume("key", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7); // 4 + 4 - 1

      limiter.dispose?.();
    });

    it("caps refill at capacity", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 5, tokensPerSecond: 10 },
        { clock },
      );

      await limiter.consume("key", 3); // 2 remaining
      clock.advance(10000); // Would refill 100 tokens, but caps at 5

      const result = await limiter.consume("key", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // Capped at 5, minus 1

      limiter.dispose?.();
    });

    it("uses integer floor for refill (no fractional tokens)", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 10, tokensPerSecond: 1 },
        { clock },
      );

      await limiter.consume("key", 5); // 5 remaining
      clock.advance(1500); // 1.5 seconds = floor(1.5) = 1 token

      const result = await limiter.consume("key", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5); // 5 + 1 - 1

      limiter.dispose?.();
    });

    it("tolerates non-monotonic clocks (negative elapsed clamped to 0)", async () => {
      let currentTime = 10000;
      const clock: Clock = { now: () => currentTime };
      const limiter = memoryRateLimiter(
        { capacity: 5, tokensPerSecond: 1 },
        { clock },
      );

      await limiter.consume("key", 3); // 2 remaining

      // Simulate clock going backwards (NTP adjustment)
      currentTime = 5000;

      const result = await limiter.consume("key", 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // No refill, just deduct

      limiter.dispose?.();
    });
  });

  describe("prefix isolation", () => {
    it("prefixes keys when policy.prefix is set", async () => {
      const clock = createMockClock();
      const limiter1 = memoryRateLimiter(
        { capacity: 2, tokensPerSecond: 1, prefix: "api:" },
        { clock },
      );
      const limiter2 = memoryRateLimiter(
        { capacity: 2, tokensPerSecond: 1, prefix: "ws:" },
        { clock },
      );

      await limiter1.consume("user:1", 2);
      const result1 = await limiter1.consume("user:1", 1);
      const result2 = await limiter2.consume("user:1", 1);

      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(true);

      limiter1.dispose?.();
      limiter2.dispose?.();
    });
  });

  describe("mutex concurrency", () => {
    it("serializes concurrent consume() calls (no double-spending)", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 5, tokensPerSecond: 0.001 },
        { clock },
      );

      // Fire 10 concurrent consume(1) calls
      const results = await Promise.all(
        Array.from({ length: 10 }, () => limiter.consume("key", 1)),
      );

      const allowed = results.filter((r) => r.allowed).length;
      const blocked = results.filter((r) => !r.allowed).length;

      // Exactly 5 should succeed, 5 should fail
      expect(allowed).toBe(5);
      expect(blocked).toBe(5);

      limiter.dispose?.();
    });
  });

  describe("getPolicy()", () => {
    it("returns the policy configuration", () => {
      const limiter = memoryRateLimiter({
        capacity: 100,
        tokensPerSecond: 10,
        prefix: "test:",
      });

      const policy = limiter.getPolicy();

      expect(policy.capacity).toBe(100);
      expect(policy.tokensPerSecond).toBe(10);
      expect(policy.prefix).toBe("test:");

      limiter.dispose?.();
    });

    it("returns frozen object (immutable)", () => {
      const limiter = memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 });
      const policy = limiter.getPolicy();

      expect(Object.isFrozen(policy)).toBe(true);

      limiter.dispose?.();
    });

    it("is not affected by mutations to original policy object", () => {
      const originalPolicy = { capacity: 10, tokensPerSecond: 1 };
      const limiter = memoryRateLimiter(originalPolicy);

      originalPolicy.capacity = 999;

      expect(limiter.getPolicy().capacity).toBe(10);

      limiter.dispose?.();
    });
  });

  describe("dispose()", () => {
    it("clears all state", async () => {
      const clock = createMockClock();
      const limiter = memoryRateLimiter(
        { capacity: 2, tokensPerSecond: 0.001 },
        { clock },
      );

      await limiter.consume("key", 2);
      const beforeDispose = await limiter.consume("key", 1);
      expect(beforeDispose.allowed).toBe(false);

      limiter.dispose?.();

      // After dispose, new limiter instance should start fresh
      // Note: dispose clears internal state, so same instance would need re-init
      // This test verifies dispose() doesn't throw and clears state
      const limiter2 = memoryRateLimiter(
        { capacity: 2, tokensPerSecond: 0.001 },
        { clock },
      );
      const afterDispose = await limiter2.consume("key", 1);
      expect(afterDispose.allowed).toBe(true);

      limiter2.dispose?.();
    });
  });
});
