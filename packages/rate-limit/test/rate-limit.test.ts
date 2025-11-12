// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { keyPerUserPerType, perUserKey, rateLimit, type IngressContext } from "@ws-kit/rate-limit";
import { describe, expect, it } from "bun:test";
import { memoryRateLimiter } from "@ws-kit/memory";

interface TestData {
  userId?: string;
  tenantId?: string;
}

/**
 * Test rate limit middleware directly by calling it with mock contexts.
 *
 * The middleware function has the signature:
 *   (ctx: EventContext<TData, unknown>, next: () => Promise<void>) => Promise<void>
 *
 * We test by:
 * 1. Creating a mock context with required properties
 * 2. Calling the middleware with a mock next() function
 * 3. Verifying it calls next() when rate limit allows, or throws when exceeded
 */

describe("Rate Limit Middleware", () => {
  describe("Basic functionality", () => {
    it("should allow requests within rate limit", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let nextCalled = false;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {
          throw new Error("INVALID_ARGUMENT: Rate limit cost must be a positive integer");
        },
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      // Call middleware
      await limiter(mockCtx, mockNext);

      expect(nextCalled).toBe(true);
    });

    it("should block requests exceeding rate limit from reaching handler", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let nextCalled = false;
      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      // First 2 requests should succeed
      await limiter(mockCtx, mockNext);
      nextCalled = false;
      await limiter(mockCtx, mockNext);

      // Third request should be blocked (throws error)
      nextCalled = false;
      try {
        await limiter(mockCtx, mockNext);
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(nextCalled).toBe(false);
        expect(err.message).toContain("Rate limit");
      }
    });

    it("should reject non-integer costs", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 0.5, // Invalid: non-integer
      });

      let nextCalled = false;
      let errorCalled = false;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {
          errorCalled = true;
        },
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      // Call middleware
      await limiter(mockCtx, mockNext);

      expect(nextCalled).toBe(false);
      expect(errorCalled).toBe(true);
    });

    it("should reject zero or negative costs", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 0, // Invalid: zero
      });

      let nextCalled = false;
      let errorCalled = false;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {
          errorCalled = true;
        },
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      // Call middleware
      await limiter(mockCtx, mockNext);

      expect(nextCalled).toBe(false);
      expect(errorCalled).toBe(true);
    });
  });

  describe("Multiple limiters", () => {
    it("should support independent limiters with different policies", async () => {
      const cheapLimiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      const expensiveLimiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let nextCalled = 0;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled++;
      };

      // First 5 requests should succeed through both limiters
      for (let i = 0; i < 5; i++) {
        await cheapLimiter(mockCtx, mockNext);
        await expensiveLimiter(mockCtx, mockNext);
      }

      // 6th request should be blocked by expensive limiter
      nextCalled = 0;
      try {
        await cheapLimiter(mockCtx, mockNext);
        await expensiveLimiter(mockCtx, mockNext);
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(nextCalled).toBe(1); // Only cheapLimiter called next()
        expect(err.message).toContain("Rate limit");
      }
    });
  });

  describe("Key functions", () => {
    it("should use keyPerUserPerType for per-user per-type isolation", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 1, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let nextCalled = 0;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled++;
      };

      // First request succeeds
      await limiter(mockCtx, mockNext);
      expect(nextCalled).toBe(1);

      // Second request blocked
      try {
        await limiter(mockCtx, mockNext);
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(nextCalled).toBe(1);
      }
    });

    it("should use perUserKey for lighter per-user isolation", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: perUserKey,
        cost: () => 1,
      });

      let nextCalled = false;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      await limiter(mockCtx, mockNext);
      expect(nextCalled).toBe(true);
    });

    it("should use keyPerUserOrIpPerType as default key", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        // No key specified - should use keyPerUserOrIpPerType
        cost: () => 1,
      });

      let nextCalled = false;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      await limiter(mockCtx, mockNext);
      expect(nextCalled).toBe(true);
    });

    it("should support custom key functions", async () => {
      const customKey = (ctx: IngressContext<TestData>) => {
        return `custom:${ctx.type}`;
      };

      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: customKey,
        cost: () => 1,
      });

      let nextCalled = false;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      await limiter(mockCtx, mockNext);
      expect(nextCalled).toBe(true);
    });
  });

  describe("Cost functions", () => {
    it("should use default cost of 1 when not specified", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        // No cost specified - should default to 1
      });

      let nextCalled = 0;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled++;
      };

      // Should allow 2 requests with default cost of 1
      await limiter(mockCtx, mockNext);
      await limiter(mockCtx, mockNext);
      expect(nextCalled).toBe(2);

      // Third request should be blocked
      try {
        await limiter(mockCtx, mockNext);
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(nextCalled).toBe(2);
      }
    });

    it("should support weighted costs", async () => {
      let messageWeight = 1;

      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => messageWeight,
      });

      let nextCalled = 0;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled++;
      };

      // Send light message (cost 1)
      messageWeight = 1;
      await limiter(mockCtx, mockNext);

      // Send heavy message (cost 5)
      messageWeight = 5;
      await limiter(mockCtx, mockNext);

      expect(nextCalled).toBe(2);
    });
  });

  describe("Cost > Capacity handling", () => {
    it("should prevent handler execution when cost exceeds capacity", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 10, // Cost > capacity
      });

      let nextCalled = false;

      const mockCtx = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled = true;
      };

      // Handler should not be called
      try {
        await limiter(mockCtx, mockNext);
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(nextCalled).toBe(false);
        expect(err.message).toContain("Operation cost exceeds");
      }
    });
  });

  describe("Multi-user isolation", () => {
    it("should isolate rate limits per user", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let nextCalled = 0;

      const mockCtx1 = {
        type: "TEST",
        meta: { clientId: "client-1" },
        ws: { data: { userId: "user-1", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockCtx2 = {
        type: "TEST",
        meta: { clientId: "client-2" },
        ws: { data: { userId: "user-2", tenantId: "tenant-1" } },
        receivedAt: Date.now(),
        error: () => {},
      } as any;

      const mockNext = async () => {
        nextCalled++;
      };

      // User 1: 2 successful requests
      await limiter(mockCtx1, mockNext);
      await limiter(mockCtx1, mockNext);
      expect(nextCalled).toBe(2);

      // User 2: Should also get 2 successful requests (independent bucket)
      await limiter(mockCtx2, mockNext);
      await limiter(mockCtx2, mockNext);
      expect(nextCalled).toBe(4);

      // Both users used 2 requests each = 4 total
    });
  });
});
