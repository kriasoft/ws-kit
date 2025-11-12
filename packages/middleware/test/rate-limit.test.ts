// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { keyPerUserPerType, perUserKey, rateLimit } from "@ws-kit/middleware";
import {
  createRouter,
  message,
  z,
  type IngressContext,
  type ServerWebSocket,
} from "@ws-kit/zod";
import { beforeEach, describe, expect, it } from "bun:test";
import { memoryRateLimiter } from "@ws-kit/memory";

interface TestData {
  userId?: string;
  tenantId?: string;
}

describe("Rate Limit Middleware", () => {
  let router: ReturnType<typeof createRouter<TestData>>;
  let mockWs: ServerWebSocket<TestData>;

  const TestMessage = message("TEST", {
    value: z.string().optional(),
  });

  beforeEach(() => {
    router = createRouter<TestData>();
    mockWs = {
      data: { userId: "user-1", tenantId: "tenant-1" },
      send: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      close: () => {},
      readyState: 1,
    } as ServerWebSocket<TestData>;
  });

  describe("Basic functionality", () => {
    it("should allow requests within rate limit", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let handlerCalled = false;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCalled = true;
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCalled).toBe(true);
    });

    it("should block requests exceeding rate limit from reaching handler", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;

      // First 2 requests should reach the handler
      for (let i = 0; i < 2; i++) {
        await wsHandler.message(
          mockWs,
          JSON.stringify({
            type: "TEST",
            meta: {},
            payload: { value: "hello" },
          }),
        );
      }

      // Third request should be blocked by rate limiter
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Handler should only have been called twice
      expect(handlerCallCount).toBe(2);
    });

    it("should reject non-integer costs", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 0.5, // Invalid: non-integer
      });

      let handlerCallCount = 0;

      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Handler should not be called
      expect(handlerCallCount).toBe(0);
    });

    it("should reject zero or negative costs", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 0, // Invalid: zero
      });

      let handlerCallCount = 0;

      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Handler should not be called
      expect(handlerCallCount).toBe(0);
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

      let handlerCallCount = 0;
      router.use(cheapLimiter);
      router.use(expensiveLimiter);

      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;

      // First 5 requests should succeed (limited by expensive)
      for (let i = 0; i < 5; i++) {
        await wsHandler.message(
          mockWs,
          JSON.stringify({
            type: "TEST",
            meta: {},
            payload: { value: "hello" },
          }),
        );
      }

      // 6th request should be blocked by expensive limiter
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCallCount).toBe(5);
    });
  });

  describe("Key functions", () => {
    it("should use keyPerUserPerType for per-user per-type isolation", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 1, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;

      // First request succeeds
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Second request blocked
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCallCount).toBe(1);
    });

    it("should use perUserKey for lighter per-user isolation", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: perUserKey,
        cost: () => 1,
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCallCount).toBe(1);
    });

    it("should use keyPerUserOrIpPerType as default key", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        // No key specified - should use keyPerUserOrIpPerType
        cost: () => 1,
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCallCount).toBe(1);
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

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCallCount).toBe(1);
    });
  });

  describe("Cost functions", () => {
    it("should use default cost of 1 when not specified", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        // No cost specified - should default to 1
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;

      // Should allow 2 requests with default cost of 1
      for (let i = 0; i < 2; i++) {
        await wsHandler.message(
          mockWs,
          JSON.stringify({
            type: "TEST",
            meta: {},
            payload: { value: "hello" },
          }),
        );
      }

      // Third request should be blocked
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCallCount).toBe(2);
    });

    it("should support weighted costs", async () => {
      let messageWeight = 1;

      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => messageWeight,
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;

      // Send light message (cost 1)
      messageWeight = 1;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Send heavy message (cost 5)
      messageWeight = 5;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerCallCount).toBe(2);
    });
  });

  describe("Cost > Capacity handling", () => {
    it("should prevent handler execution when cost exceeds capacity", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 10, // Cost > capacity
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        mockWs,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Handler should not be called
      expect(handlerCallCount).toBe(0);
    });
  });

  describe("Multi-user isolation", () => {
    it("should isolate rate limits per user", async () => {
      const limiter = rateLimit({
        limiter: memoryRateLimiter({ capacity: 2, tokensPerSecond: 1 }),
        key: keyPerUserPerType,
        cost: () => 1,
      });

      let handlerCallCount = 0;
      router.use(limiter);
      router.on(TestMessage, () => {
        handlerCallCount++;
      });

      const wsHandler = router._core.websocket;

      // User 1: 2 successful requests
      mockWs.data.userId = "user-1";
      for (let i = 0; i < 2; i++) {
        await wsHandler.message(
          mockWs,
          JSON.stringify({
            type: "TEST",
            meta: {},
            payload: { value: "hello" },
          }),
        );
      }

      // User 2: Should also get 2 successful requests (independent bucket)
      mockWs.data.userId = "user-2";
      for (let i = 0; i < 2; i++) {
        await wsHandler.message(
          mockWs,
          JSON.stringify({
            type: "TEST",
            meta: {},
            payload: { value: "hello" },
          }),
        );
      }

      // Both users used 2 requests each = 4 total
      expect(handlerCallCount).toBe(4);
    });
  });
});
