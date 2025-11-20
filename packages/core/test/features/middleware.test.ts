// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Middleware integration tests: Bun-specific concerns
 *
 * Focus: Per-route builder patterns, context mutation, async ordering,
 * early returns, and Bun adapter integration.
 *
 * Canonical dispatch pipeline tests (middleware order, next() guards,
 * reserved types, heartbeat) are in dispatch.test.ts using the adapter-agnostic
 * test harness (@ws-kit/core/testing).
 *
 * Scenarios:
 * - Per-route middleware via .route().use().on() builder
 * - Global vs per-route execution order
 * - Early return (skip subsequent middleware/handler)
 * - Async middleware and post-handler phase
 * - Context mutation (ctx.assignData) propagation
 * - Router composition (.merge())
 * - ctx.error() short-circuiting semantics
 * - Error handler suppression (return false)
 */

import { createBunHandler } from "@ws-kit/bun";
import { createRouter, message, z, withZod } from "@ws-kit/zod";
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

      const { websocket: wsHandler } = createBunHandler(router);
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

      const { websocket: wsHandler } = createBunHandler(router);
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
      let handlerCalled = false;
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        calls.push("middleware");
        // Early return - skip handler (don't call next())
        return Promise.resolve();
      });

      router.on(TestMessage, (ctx) => {
        handlerCalled = true;
        calls.push("handler");
      });

      const { websocket: wsHandler } = createBunHandler(router);
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
      expect(handlerCalled).toBe(false);
    });

    it("should skip subsequent middleware and handler if any middleware returns early", async () => {
      const calls: string[] = [];
      let handlerCalled = false;
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
        // Early return - skip rest (don't call next())
        return Promise.resolve();
      });

      router.use((ctx, next) => {
        calls.push("middleware3");
        return next();
      });

      router.on(TestMessage, (ctx) => {
        handlerCalled = true;
        calls.push("handler");
      });

      const { websocket: wsHandler } = createBunHandler(router);
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
      expect(handlerCalled).toBe(false);
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

      const { websocket: wsHandler } = createBunHandler(router);
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

      const { websocket: wsHandler } = createBunHandler(router);
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

      const { websocket: wsHandler } = createBunHandler(router);
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

      const { websocket: wsHandler } = createBunHandler(router);
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

  describe("Per-route middleware (builder pattern)", () => {
    it("should execute per-route middleware before handler", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router
        .route(TestMessage)
        .use((ctx, next) => {
          calls.push("per-route-middleware");
          return next();
        })
        .on((ctx) => {
          calls.push("handler");
        });

      const { websocket: wsHandler } = createBunHandler(router);
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

      expect(calls).toEqual(["per-route-middleware", "handler"]);
    });

    it("should execute global before per-route middleware", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.use((ctx, next) => {
        calls.push("global");
        return next();
      });

      router
        .route(TestMessage)
        .use((ctx, next) => {
          calls.push("per-route");
          return next();
        })
        .on((ctx) => {
          calls.push("handler");
        });

      const { websocket: wsHandler } = createBunHandler(router);
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

      expect(calls).toEqual(["global", "per-route", "handler"]);
    });

    it("should chain multiple per-route middleware", async () => {
      const calls: string[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router
        .route(TestMessage)
        .use((ctx, next) => {
          calls.push("middleware-1");
          return next();
        })
        .use((ctx, next) => {
          calls.push("middleware-2");
          return next();
        })
        .on((ctx) => {
          calls.push("handler");
        });

      const { websocket: wsHandler } = createBunHandler(router);
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

      expect(calls).toEqual(["middleware-1", "middleware-2", "handler"]);
    });

    it("should skip handler when per-route middleware skips next()", async () => {
      const calls: string[] = [];
      let handlerCalled = false;
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router
        .route(TestMessage)
        .use(() => {
          calls.push("per-route");
          // Skip handler by not calling next()
          return Promise.resolve();
        })
        .on(() => {
          handlerCalled = true;
          calls.push("handler");
        });

      const { websocket: wsHandler } = createBunHandler(router);
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

      expect(calls).toEqual(["per-route"]);
      expect(handlerCalled).toBe(false);
    });

    it("should allow per-route middleware to mutate context", async () => {
      const router = createRouter<{ step?: number }>();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });
      let handlerData: any = null;

      router
        .route(TestMessage)
        .use((ctx, next) => {
          ctx.assignData({ step: 1 });
          return next();
        })
        .on((ctx) => {
          handlerData = ctx.data;
        });

      const { websocket: wsHandler } = createBunHandler(router);
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

      expect(handlerData?.step).toBe(1);
    });
  });

  describe("Error handling", () => {
    it("should catch errors thrown after await next() (post-handler phase)", async () => {
      const errors: unknown[] = [];
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.onError((error) => {
        errors.push(error);
      });

      router.use(async (ctx, next) => {
        await next();
        throw new Error("Post-handler error");
      });

      router.on(TestMessage, () => {
        // Handler succeeds
      });

      const { websocket: wsHandler } = createBunHandler(router);
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
      expect((errors[0] as any)?.message).toBe("Post-handler error");
    });

    it("should short-circuit handler when middleware calls ctx.error()", async () => {
      const errorsCaught: unknown[] = [];
      let handlerCalled = false;
      const router = createRouter();
      const TestMessage = message("TEST", {
        value: z.string().optional(),
      });

      router.onError((error) => {
        errorsCaught.push(error);
      });

      router.use((ctx) => {
        ctx.error("UNAUTHENTICATED", "Missing credentials");
        return Promise.resolve();
      });

      router.on(TestMessage, () => {
        handlerCalled = true;
      });

      const { websocket: wsHandler } = createBunHandler(router);
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

      // ctx.error() schedules async error handling; wait for microtask queue
      await new Promise((resolve) => setImmediate(resolve));

      expect(handlerCalled).toBe(false);
      expect(errorsCaught).toHaveLength(1);
    });
  });

  describe("Router composition", () => {
    it("should execute router1 middleware and merged route handler", async () => {
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
      // Per-route middleware on router2 will be preserved when merged
      router2
        .route(TestMessage)
        .use((ctx, next) => {
          calls.push("router2_per_route_middleware");
          return next();
        })
        .on((ctx) => {
          calls.push("handler");
        });

      router1.merge(router2);

      const { websocket: wsHandler } = createBunHandler(router1);
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

      // router1 global middleware + router2 per-route middleware + handler
      expect(calls).toEqual([
        "router1_middleware",
        "router2_per_route_middleware",
        "handler",
      ]);
    });
  });

  describe("Error handler suppression", () => {
    it("error handler can suppress auto-send by returning false", async () => {
      const errorHandlerCalled = { count: 0 };
      let handlerCalled = false;
      const router = createRouter().plugin(withZod());
      const TestMessage = message("TEST", { value: z.string() });

      router.onError(() => {
        errorHandlerCalled.count++;
        return false; // Suppress auto-send
      });

      router.on(TestMessage, () => {
        handlerCalled = true;
        throw new Error("Test error");
      });

      const sentMessages: string[] = [];
      const { websocket: wsHandler } = createBunHandler(router);
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
      // Handler was called before throwing
      expect(handlerCalled).toBe(true);
      // With suppression returning false, no error message should be sent
      expect(sentMessages.length).toBe(0);
    });
  });
});
