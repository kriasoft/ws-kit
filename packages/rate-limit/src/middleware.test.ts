// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { memoryRateLimiter } from "@ws-kit/memory";
import {
  keyPerUser,
  keyPerUserPerType,
  rateLimit,
  type IngressContext,
} from "@ws-kit/rate-limit";
import { describe, expect, it } from "bun:test";

interface TestData extends Record<string, unknown> {
  userId?: string;
  tenantId?: string;
}

interface ErrorRecord {
  code: string;
  message: string | undefined;
  details: Record<string, unknown> | undefined;
  options: Record<string, unknown> | undefined;
}

/**
 * Create a mock context for testing rate limit middleware.
 * Tracks error() calls and provides sensible defaults.
 */
function createMockContext(
  overrides: Partial<{
    type: string;
    clientId: string;
    data: TestData;
  }> = {},
) {
  const errors: ErrorRecord[] = [];

  return {
    ctx: {
      type: overrides.type ?? "TEST",
      clientId: overrides.clientId ?? "client-1",
      data: overrides.data ?? { userId: "user-1", tenantId: "tenant-1" },
      ws: { readyState: "OPEN", send: () => {}, close: () => {} },
      assignData: () => {},
      extensions: new Map(),
      error: (
        code: string,
        message?: string,
        details?: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => {
        errors.push({ code, message, details, options });
      },
    } as any,
    errors,
  };
}

describe("Rate Limit Middleware", () => {
  describe("Basic functionality", () => {
    it("should allow requests within rate limit", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      const { ctx, errors } = createMockContext();
      let nextCalled = false;

      await limiter(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it("should block requests exceeding rate limit", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      const { ctx, errors } = createMockContext();
      let nextCount = 0;

      const next = async () => {
        nextCount++;
      };

      // First 2 requests should succeed
      await limiter(ctx, next);
      await limiter(ctx, next);
      expect(nextCount).toBe(2);
      expect(errors).toHaveLength(0);

      // Third request should be blocked
      await limiter(ctx, next);
      expect(nextCount).toBe(2); // Handler not called
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("RESOURCE_EXHAUSTED");
      expect(errors[0]!.message).toBe("Rate limit exceeded");
      expect(errors[0]!.options?.retryAfterMs).toBeGreaterThan(0);
    });

    it("should reject non-integer costs", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 0.5,
      });

      const { ctx, errors } = createMockContext();
      let nextCalled = false;

      await limiter(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("INVALID_ARGUMENT");
    });

    it("should reject negative costs", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => -1,
      });

      const { ctx, errors } = createMockContext();
      let nextCalled = false;

      await limiter(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("INVALID_ARGUMENT");
    });

    it("should bypass rate limiting when cost is zero", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 1, tokensPerSecond: 0.001 }),
        key: keyPerUserPerType,
        cost: (ctx) => (ctx.type === "HEARTBEAT" ? 0 : 1),
      });

      const { ctx: hbCtx, errors: hbErrors } = createMockContext({
        type: "HEARTBEAT",
      });
      const { ctx: msgCtx, errors: msgErrors } = createMockContext({
        type: "MESSAGE",
      });

      let nextCount = 0;
      const next = async () => {
        nextCount++;
      };

      // First MESSAGE consumes the only token
      await limiter(msgCtx, next);
      expect(nextCount).toBe(1);

      // Second MESSAGE should be blocked (bucket exhausted)
      await limiter(msgCtx, next);
      expect(nextCount).toBe(1);
      expect(msgErrors).toHaveLength(1);
      expect(msgErrors[0]!.code).toBe("RESOURCE_EXHAUSTED");

      // HEARTBEAT should bypass (cost=0), even with exhausted bucket
      await limiter(hbCtx, next);
      await limiter(hbCtx, next);
      await limiter(hbCtx, next);
      expect(nextCount).toBe(4);
      expect(hbErrors).toHaveLength(0);
    });
  });

  describe("Cost > Capacity handling", () => {
    it("should send FAILED_PRECONDITION when cost exceeds capacity", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 10,
      });

      const { ctx, errors } = createMockContext();
      let nextCalled = false;

      await limiter(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("FAILED_PRECONDITION");
      expect(errors[0]!.message).toBe("Operation cost exceeds capacity");
      expect(errors[0]!.details).toEqual({ cost: 10, capacity: 5 });
    });
  });

  describe("Key functions", () => {
    it("should use keyPerUserPerType as default", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        // No key specified - should use keyPerUserPerType
      });

      const { ctx, errors } = createMockContext();
      let nextCalled = false;

      await limiter(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it("should use keyPerUser for lighter per-user isolation", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUser,
      });

      const { ctx, errors } = createMockContext();
      let nextCalled = false;

      await limiter(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it("should support custom key functions", async () => {
      const customKey = (ctx: IngressContext<TestData>) => `custom:${ctx.type}`;

      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: customKey,
      });

      const { ctx, errors } = createMockContext();
      let nextCalled = false;

      await limiter(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(errors).toHaveLength(0);
    });
  });

  describe("Cost functions", () => {
    it("should use default cost of 1 when not specified", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
      });

      const { ctx, errors } = createMockContext();
      let nextCount = 0;

      const next = async () => {
        nextCount++;
      };

      // Should allow 2 requests with default cost of 1
      await limiter(ctx, next);
      await limiter(ctx, next);
      expect(nextCount).toBe(2);

      // Third request should be blocked
      await limiter(ctx, next);
      expect(nextCount).toBe(2);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("RESOURCE_EXHAUSTED");
    });

    it("should support weighted costs", async () => {
      let messageWeight = 1;

      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => messageWeight,
      });

      const { ctx, errors } = createMockContext();
      let nextCount = 0;

      const next = async () => {
        nextCount++;
      };

      // Send light message (cost 1)
      messageWeight = 1;
      await limiter(ctx, next);

      // Send heavy message (cost 5)
      messageWeight = 5;
      await limiter(ctx, next);

      expect(nextCount).toBe(2);
      expect(errors).toHaveLength(0);

      // Next heavy message should be blocked (remaining: 4, cost: 5)
      await limiter(ctx, next);
      expect(nextCount).toBe(2);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("RESOURCE_EXHAUSTED");
    });
  });

  describe("Multi-user isolation", () => {
    it("should isolate rate limits per user", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
      });

      const { ctx: ctx1, errors: errors1 } = createMockContext({
        data: { userId: "user-1", tenantId: "tenant-1" },
      });
      const { ctx: ctx2, errors: errors2 } = createMockContext({
        data: { userId: "user-2", tenantId: "tenant-1" },
      });

      let nextCount = 0;
      const next = async () => {
        nextCount++;
      };

      // User 1: 2 successful requests
      await limiter(ctx1, next);
      await limiter(ctx1, next);
      expect(nextCount).toBe(2);

      // User 2: Should also get 2 successful requests (independent bucket)
      await limiter(ctx2, next);
      await limiter(ctx2, next);
      expect(nextCount).toBe(4);

      expect(errors1).toHaveLength(0);
      expect(errors2).toHaveLength(0);
    });
  });

  describe("Multiple limiters", () => {
    it("should support independent limiters with different policies", async () => {
      const cheapLimiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 }),
        key: keyPerUserPerType,
      });

      const expensiveLimiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
      });

      const { ctx, errors } = createMockContext();
      let nextCount = 0;

      const next = async () => {
        nextCount++;
      };

      // First 5 requests should succeed through both limiters
      for (let i = 0; i < 5; i++) {
        await cheapLimiter(ctx, next);
        await expensiveLimiter(ctx, next);
      }
      expect(nextCount).toBe(10);
      expect(errors).toHaveLength(0);

      // 6th expensive request should be blocked
      await cheapLimiter(ctx, next);
      expect(nextCount).toBe(11);
      await expensiveLimiter(ctx, next);
      expect(nextCount).toBe(11); // Expensive didn't call next

      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("RESOURCE_EXHAUSTED");
    });
  });
});
