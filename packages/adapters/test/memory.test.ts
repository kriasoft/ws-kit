// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { memoryRateLimiter } from "@ws-kit/memory";
import { describe, expect, test } from "bun:test";
import { describeRateLimiterContract } from "./contract";

// Run the shared contract test suite against memory adapter
const testPolicy = { capacity: 10, tokensPerSecond: 1 };
describeRateLimiterContract("Memory", () => memoryRateLimiter(testPolicy));

describe("Memory Adapter: Clock Injection", () => {
  test("deterministic time travel with injected clock", async () => {
    const fakeTime = { current: Date.now() };

    const limiter = memoryRateLimiter(testPolicy, {
      clock: { now: () => fakeTime.current },
    });

    // Consume 5 tokens
    let result = await limiter.consume("user:1", 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);

    // Advance clock by 3 seconds (should refill 3 tokens)
    fakeTime.current += 3000;

    result = await limiter.consume("user:1", 3);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5); // 5 + 3 refilled - 3 consumed

    // Advance clock by 10 seconds (bucket caps at capacity 10)
    fakeTime.current += 10000;

    result = await limiter.consume("user:1", 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // Capped at capacity, then -1
  });

  test("policy validation on factory creation", () => {
    expect(() => {
      memoryRateLimiter({ capacity: 0, tokensPerSecond: 1 });
    }).toThrow("Rate limit capacity must be ≥ 1");

    expect(() => {
      memoryRateLimiter({ capacity: 10, tokensPerSecond: 0 });
    }).toThrow("tokensPerSecond must be > 0");

    expect(() => {
      memoryRateLimiter({ capacity: -5, tokensPerSecond: 1 });
    }).toThrow("Rate limit capacity must be ≥ 1");
  });
});

describe("Memory Adapter: Prefix Isolation", () => {
  test("prefix isolates keys in shared bucket map", async () => {
    // Two limiters with different prefixes
    const limiter1 = memoryRateLimiter({
      capacity: 10,
      tokensPerSecond: 1,
      prefix: "policy1:",
    });

    const limiter2 = memoryRateLimiter({
      capacity: 10,
      tokensPerSecond: 1,
      prefix: "policy2:",
    });

    // Both can consume independently despite same key
    const result1 = await limiter1.consume("user:1", 5);
    expect(result1.allowed).toBe(true);

    const result2 = await limiter2.consume("user:1", 6);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(4); // 10 - 6 = 4
  });
});

describe("Memory Adapter: Disposal", () => {
  test("dispose clears all buckets and mutexes", async () => {
    const limiter = memoryRateLimiter(testPolicy);

    // Create some state
    await limiter.consume("user:1", 5);
    await limiter.consume("user:2", 3);

    // Dispose
    if (limiter.dispose) {
      limiter.dispose();
    }

    // After disposal, limiter creates new buckets (in-memory adapter doesn't prevent reuse)
    const result = await limiter.consume("user:1", 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // Fresh bucket
  });
});

describe("Memory Adapter: Non-Monotonic Clock", () => {
  test("handles clock going backwards (NTP adjustment)", async () => {
    const fakeTime = { current: Date.now() };

    const limiter = memoryRateLimiter(testPolicy, {
      clock: { now: () => fakeTime.current },
    });

    // Consume 5 tokens
    await limiter.consume("user:1", 5);

    // Clock goes backward by 1 second (NTP adjustment)
    fakeTime.current -= 1000;

    // Should not cause negative elapsed time to corrupt state
    const result = await limiter.consume("user:1", 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4); // State is clamped, no refill on backwards clock
  });
});
