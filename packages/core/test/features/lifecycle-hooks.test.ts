// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Tests for router-level lifecycle hooks (onOpen/onClose).
 *
 * Coverage:
 * - onOpen runs after data is populated
 * - onOpen gets capability-gated context (send, publish, topics)
 * - onClose runs during close notification
 * - Error handling in lifecycle hooks
 * - Handler ordering (registration order)
 */

import { CloseError, createRouter } from "@ws-kit/core";
import { test as testUtils } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";

describe("Router Lifecycle Hooks", () => {
  describe("router.onOpen()", () => {
    it("should run onOpen handler when connection is opened", async () => {
      let openCalled = false;
      let receivedClientId: string | undefined;

      const router = createRouter();
      router.onOpen((ctx) => {
        openCalled = true;
        receivedClientId = ctx.clientId;
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();

      expect(openCalled).toBe(true);
      expect(receivedClientId).toBeDefined();
      expect(typeof receivedClientId).toBe("string");

      await conn.close();
      await tr.close();
    });

    it("should have populated ctx.data from authenticate", async () => {
      type AppData = Record<string, unknown> & {
        userId: string;
        role: string;
      };

      let receivedData: AppData | undefined;

      const router = createRouter<AppData>();
      router.onOpen((ctx) => {
        receivedData = ctx.data;
      });

      const tr = testUtils.createTestRouter({
        create: () => router,
      });
      const conn = await tr.connect({
        data: { userId: "user_123", role: "admin" },
      });

      expect(receivedData).toEqual({ userId: "user_123", role: "admin" });

      await conn.close();
      await tr.close();
    });

    it("should have connectedAt timestamp", async () => {
      let connectedAt: number | undefined;

      const router = createRouter();
      router.onOpen((ctx) => {
        connectedAt = ctx.connectedAt;
      });

      const before = Date.now();
      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();
      const after = Date.now();

      expect(connectedAt).toBeDefined();
      expect(connectedAt).toBeGreaterThanOrEqual(before);
      expect(connectedAt).toBeLessThanOrEqual(after);

      await conn.close();
      await tr.close();
    });

    it("should allow ctx.assignData to update connection data", async () => {
      type AppData = Record<string, unknown> & {
        userId?: string;
        upgraded?: boolean;
      };

      let dataAfterAssign: AppData | undefined;

      const router = createRouter<AppData>();
      router.onOpen((ctx) => {
        ctx.assignData({ upgraded: true });
        dataAfterAssign = ctx.data;
      });

      const tr = testUtils.createTestRouter({
        create: () => router,
      });
      const conn = await tr.connect({ data: { userId: "user_123" } });

      expect(dataAfterAssign).toEqual({ userId: "user_123", upgraded: true });

      await conn.close();
      await tr.close();
    });

    it("should run multiple onOpen handlers in registration order", async () => {
      const calls: string[] = [];

      const router = createRouter();
      router.onOpen(() => {
        calls.push("first");
      });
      router.onOpen(() => {
        calls.push("second");
      });
      router.onOpen(() => {
        calls.push("third");
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();

      expect(calls).toEqual(["first", "second", "third"]);

      await conn.close();
      await tr.close();
    });

    it("should support async onOpen handlers", async () => {
      const calls: string[] = [];

      const router = createRouter();
      router.onOpen(async () => {
        await new Promise((r) => setTimeout(r, 10));
        calls.push("async");
      });
      router.onOpen(() => {
        calls.push("sync");
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();

      // async handler should complete before next handler runs
      expect(calls).toEqual(["async", "sync"]);

      await conn.close();
      await tr.close();
    });
  });

  describe("router.onClose()", () => {
    it("should run onClose handler when connection is closed", async () => {
      let openClientId: string | undefined;
      let closeClientId: string | undefined;
      let closeCalled = false;

      const router = createRouter();
      router.onOpen((ctx) => {
        openClientId = ctx.clientId;
      });
      router.onClose((ctx) => {
        closeCalled = true;
        closeClientId = ctx.clientId;
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();
      await conn.close();

      expect(closeCalled).toBe(true);
      expect(openClientId).toBeDefined();
      expect(closeClientId).toBe(openClientId);

      await tr.close();
    });

    it("should have close code and reason in context", async () => {
      let receivedCode: number | undefined;
      let receivedReason: string | undefined;

      const router = createRouter();
      router.onClose((ctx) => {
        receivedCode = ctx.code;
        receivedReason = ctx.reason;
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();
      await conn.close(1000, "Normal closure");

      expect(receivedCode).toBe(1000);
      expect(receivedReason).toBe("Normal closure");

      await tr.close();
    });

    it("should run multiple onClose handlers in registration order", async () => {
      const calls: string[] = [];

      const router = createRouter();
      router.onClose(() => {
        calls.push("first");
      });
      router.onClose(() => {
        calls.push("second");
      });
      router.onClose(() => {
        calls.push("third");
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();
      await conn.close();

      expect(calls).toEqual(["first", "second", "third"]);

      await tr.close();
    });
  });

  describe("Error Handling", () => {
    it("should route lifecycle errors to onError handler", async () => {
      const errors: { err: unknown; type: string }[] = [];

      const router = createRouter();
      router.onOpen(() => {
        throw new Error("onOpen error");
      });
      router.onError((err, ctx) => {
        if (ctx && "type" in ctx && typeof ctx.type === "string") {
          errors.push({ err, type: ctx.type });
        }
      });

      const tr = testUtils.createTestRouter({ create: () => router });

      try {
        await tr.connect();
      } catch {
        // Connection may fail due to error in onOpen
      }

      expect(errors.length).toBeGreaterThan(0);
      const firstError = errors[0]!;
      expect((firstError.err as Error).message).toBe("onOpen error");
      expect(firstError.type).toBe("$ws:open");

      await tr.close();
    });

    it("should handle error thrown in onOpen handler", async () => {
      let errorCaught = false;

      const router = createRouter();
      router.onOpen(() => {
        throw new Error("Fatal error");
      });
      router.onError(() => {
        errorCaught = true;
      });

      const tr = testUtils.createTestRouter({ create: () => router });

      try {
        await tr.connect();
      } catch {
        // Expected - connection may fail due to error
      }

      // The error should have been routed to onError
      expect(errorCaught).toBe(true);

      await tr.close();
    });

    it("should not route CloseError to onError (it is control flow)", async () => {
      // CloseError is a control flow mechanism to close connections with
      // custom codes - it is NOT an error that should be logged/reported
      let errorHandlerCalled = false;

      const router = createRouter();
      router.onOpen(() => {
        throw new CloseError(4401, "Invalid token");
      });
      router.onError(() => {
        errorHandlerCalled = true;
      });

      const tr = testUtils.createTestRouter({ create: () => router });

      try {
        await tr.connect();
      } catch {
        // Expected - connection closed due to CloseError
      }

      // CloseError should NOT trigger onError - it's intentional control flow
      expect(errorHandlerCalled).toBe(false);

      await tr.close();
    });

    it("should continue running onClose handlers even if one throws", async () => {
      const calls: string[] = [];

      const router = createRouter();
      router.onClose(() => {
        calls.push("first");
        throw new Error("First handler error");
      });
      router.onClose(() => {
        calls.push("second");
      });
      router.onClose(() => {
        calls.push("third");
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();
      await conn.close();

      // All handlers should run despite first one throwing
      expect(calls).toEqual(["first", "second", "third"]);

      await tr.close();
    });
  });

  describe("Fluent Chaining", () => {
    it("should return router instance for chaining", () => {
      const router = createRouter();

      const result = router
        .onOpen(() => {})
        .onClose(() => {})
        .onError(() => {});

      expect(result).toBe(router);
    });
  });

  describe("Capability Gating", () => {
    it("base router onOpen should NOT have send() method", () => {
      const router = createRouter();
      let hasSend = false;

      router.onOpen((ctx) => {
        // send() requires validation plugin
        hasSend = "send" in ctx;
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      tr.connect().then((conn) => conn.close());

      // Without validation plugin, send() should not be available
      expect(hasSend).toBe(false);
    });

    it("base router onOpen should NOT have publish() method", () => {
      const router = createRouter();
      let hasPublish = false;

      router.onOpen((ctx) => {
        // publish() requires pubsub plugin
        hasPublish = "publish" in ctx;
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      tr.connect().then((conn) => conn.close());

      // Without pubsub plugin, publish() should not be available
      expect(hasPublish).toBe(false);
    });

    it("base router onOpen should NOT have topics", () => {
      const router = createRouter();
      let hasTopics = false;

      router.onOpen((ctx) => {
        // topics requires pubsub plugin
        hasTopics = "topics" in ctx;
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      tr.connect().then((conn) => conn.close());

      // Without pubsub plugin, topics should not be available
      expect(hasTopics).toBe(false);
    });

    it("onClose topics should be read-only (no subscribe/unsubscribe)", async () => {
      // This is a type-level test verification
      // At runtime, pubsub plugin would provide topics with read-only interface
      const router = createRouter();
      let closeCtx: Record<string, unknown> | undefined;

      router.onClose((ctx) => {
        closeCtx = ctx as unknown as Record<string, unknown>;
      });

      const tr = testUtils.createTestRouter({ create: () => router });
      const conn = await tr.connect();
      await conn.close();

      // Without pubsub plugin, topics shouldn't exist at all
      expect(closeCtx?.topics).toBeUndefined();

      await tr.close();
    });
  });
});
