// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

describe("Middleware", () => {
  describe("Basic execution", () => {
    it("should execute middleware before handler", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        calls.push("middleware");
        return next();
      });

      router.on(TestMessage, (ctx) => {
        calls.push("handler");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(calls).toEqual(["middleware", "handler"]);
    });

    it("should execute multiple middleware in registration order", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        calls.push("middleware1");
        return next();
      });

      router.use((ctx, next) => {
        calls.push("middleware2");
        return next();
      });

      router.use((ctx, next) => {
        calls.push("middleware3");
        return next();
      });

      router.on(TestMessage, (ctx) => {
        calls.push("handler");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(calls).toEqual([
        "middleware1",
        "middleware2",
        "middleware3",
        "handler",
      ]);
    });
  });

  describe("Early return", () => {
    it("should skip handler if middleware returns early", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        calls.push("middleware");
        // Early return - skip handler
        return;
      });

      router.on(TestMessage, (ctx) => {
        calls.push("handler");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(calls).toEqual(["middleware"]);
    });

    it("should skip subsequent middleware and handler if any middleware returns early", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        calls.push("middleware1");
        return next();
      });

      router.use((ctx, next) => {
        calls.push("middleware2");
        // Early return - skip rest
        return;
      });

      router.use((ctx, next) => {
        calls.push("middleware3");
        return next();
      });

      router.on(TestMessage, (ctx) => {
        calls.push("handler");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(calls).toEqual(["middleware1", "middleware2"]);
    });
  });

  describe("Async middleware", () => {
    it("should support async middleware", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use(async (ctx, next) => {
        calls.push("middleware_before");
        await new Promise((resolve) => setTimeout(resolve, 1));
        await next();
        calls.push("middleware_after");
      });

      router.on(TestMessage, (ctx) => {
        calls.push("handler");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(calls).toEqual([
        "middleware_before",
        "handler",
        "middleware_after",
      ]);
    });

    it("should properly await async handler through middleware", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use(async (ctx, next) => {
        calls.push("middleware_before");
        await next();
        calls.push("middleware_after");
      });

      router.on(TestMessage, async (ctx) => {
        calls.push("handler_before");
        await new Promise((resolve) => setTimeout(resolve, 1));
        calls.push("handler_after");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(calls).toEqual([
        "middleware_before",
        "handler_before",
        "handler_after",
        "middleware_after",
      ]);
    });
  });

  describe("Context modification", () => {
    it("should allow middleware to modify ctx.data", async () => {
      const router = createRouter<{ userId?: string }>();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        ctx.assignData({ userId: "user123" });
        return next();
      });

      let handlerUserId: string | undefined;
      router.on(TestMessage, (ctx) => {
        handlerUserId = ctx.data.userId;
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(handlerUserId).toBe("user123");
    });

    it("should share context modifications between middleware", async () => {
      const router = createRouter<{ step1?: boolean; step2?: boolean }>();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        ctx.assignData({ step1: true });
        return next();
      });

      router.use((ctx, next) => {
        expect(ctx.data.step1).toBe(true);
        ctx.assignData({ step2: true });
        return next();
      });

      let step1: boolean | undefined;
      let step2: boolean | undefined;
      router.on(TestMessage, (ctx) => {
        step1 = ctx.data.step1;
        step2 = ctx.data.step2;
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(step1).toBe(true);
      expect(step2).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("should catch errors thrown in middleware", async () => {
      const errors: Error[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.onError((error) => {
        errors.push(error);
      });

      router.use(() => {
        throw new Error("Middleware error");
      });

      router.on(TestMessage, (ctx) => {
        // Should not reach here
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe("Middleware error");
    });

    it("should catch errors thrown in async middleware", async () => {
      const errors: Error[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.onError((error) => {
        errors.push(error);
      });

      router.use(async () => {
        throw new Error("Async middleware error");
      });

      router.on(TestMessage, (ctx) => {
        // Should not reach here
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe("Async middleware error");
    });
  });

  describe("Router composition", () => {
    it("should merge middleware from composed routers", async () => {
      const calls: string[] = [];

      const router1 = createRouter();
      router1.use((ctx, next) => {
        calls.push("router1_middleware");
        return next();
      });

      const router2 = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });
      router2.use((ctx, next) => {
        calls.push("router2_middleware");
        return next();
      });
      router2.on(TestMessage, (ctx) => {
        calls.push("handler");
      });

      router1.merge(router2);

      const wsHandler = router1._core.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Both router1 and router2 middleware should execute, then router2 handler
      expect(calls).toEqual([
        "router1_middleware",
        "router2_middleware",
        "handler",
      ]);
    });
  });

  describe("Automatic error response on handler exception", () => {
    it("should auto-send ERROR message when handler throws", async () => {
      const router = createRouter();
      const TestMessage = message("TEST", { value: z.string() });

      const sentMessages: string[] = [];
      router.on(TestMessage, () => {
        throw new Error("Test error");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: (msg: string) => {
          sentMessages.push(msg);
        },
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Should have sent an ERROR message
      expect(sentMessages.length).toBe(1);
      const errorMsg = JSON.parse(sentMessages[0]!);
      expect(errorMsg.type).toBe("ERROR");
      expect(errorMsg.payload.code).toBe("INTERNAL");
      expect(errorMsg.payload.message).toBe("Internal server error"); // Default sanitized message
    });

    it("should include actual error message when exposeErrorDetails is true", async () => {
      const router = createRouter({ exposeErrorDetails: true });
      const TestMessage = message("TEST", { value: z.string() });

      const sentMessages: string[] = [];
      router.on(TestMessage, () => {
        throw new Error("Specific error message");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: (msg: string) => {
          sentMessages.push(msg);
        },
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Should include the actual error message
      const errorMsg = JSON.parse(sentMessages[0]!);
      expect(errorMsg.payload.message).toBe("Specific error message");
    });

    it("should not auto-send error when autoSendErrorOnThrow is false", async () => {
      const router = createRouter({ autoSendErrorOnThrow: false });
      const TestMessage = message("TEST", { value: z.string() });

      const sentMessages: string[] = [];
      router.on(TestMessage, () => {
        throw new Error("Test error");
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: (msg: string) => {
          sentMessages.push(msg);
        },
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Should NOT have sent any message (no error handler suppression needed)
      expect(sentMessages.length).toBe(0);
    });

    it("error handler can suppress auto-send by returning false", async () => {
      const errorHandlerCalled = { count: 0 };
      const router = createRouter();
      const TestMessage = message("TEST", { value: z.string() });

      router.onError(() => {
        errorHandlerCalled.count++;
        return false; // Suppress auto-send
      });

      router.on(TestMessage, () => {
        throw new Error("Test error");
      });

      const sentMessages: string[] = [];
      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: (msg: string) => {
          sentMessages.push(msg);
        },
        subscribe: () => {},
        unsubscribe: () => {},
        close: () => {},
        readyState: 1,
      };

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { value: "hello" },
        }),
      );

      // Error handler was called
      expect(errorHandlerCalled.count).toBe(1);
      // But no error message was sent
      expect(sentMessages.length).toBe(0);
    });
  });
});
