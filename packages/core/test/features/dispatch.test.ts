/**
 * Dispatch pipeline tests: message routing, middleware chain, error handling.
 *
 * Scenarios:
 * - Parse JSON frame → validate shape → lookup handler
 * - Middleware execution order: global → per-route → handler
 * - Heartbeat short-circuit: __heartbeat → __heartbeat_ack
 * - Reserved types blocked from user handlers
 * - Unknown message types → onError
 * - Middleware/handler errors → onError
 * - Limits enforcement: maxPending
 */

import { describe, expect, it } from "bun:test";
import { createRouter } from "../../src/core/createRouter";
import type { MessageDescriptor } from "../../src/core/types";
import { createTestRouter } from "../../src/testing";

describe("dispatch pipeline", () => {
  // Helper to create a simple test schema
  function schema(type: string): MessageDescriptor {
    return { type, kind: "event" } as const;
  }

  describe("middleware execution order", () => {
    it("executes global middleware before per-route middleware", async () => {
      const calls: string[] = [];

      const router = createRouter();

      // Global middleware A
      router.use(async (ctx, next) => {
        calls.push("global-A:before");
        await next();
        calls.push("global-A:after");
      });

      // Global middleware B
      router.use(async (ctx, next) => {
        calls.push("global-B:before");
        await next();
        calls.push("global-B:after");
      });

      // Per-route middleware C
      router
        .route(schema("TEST"))
        .use(async (ctx, next) => {
          calls.push("route-C:before");
          await next();
          calls.push("route-C:after");
        })
        .on(async () => {
          calls.push("handler");
        });

      const tr = createTestRouter({
        create: () => router,
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await conn.drain();

      // Order: global → global → route → handler
      expect(calls).toEqual([
        "global-A:before",
        "global-B:before",
        "route-C:before",
        "handler",
        "route-C:after",
        "global-B:after",
        "global-A:after",
      ]);

      await tr.close();
    });

    it("prevents next() from being called multiple times", async () => {
      const router = createRouter();
      const errors: unknown[] = [];

      router.onError((err) => {
        errors.push(err);
      });

      router.use(async (ctx, next) => {
        await next();
        // Try to call next() again (should throw)
        try {
          await next();
        } catch (err) {
          errors.push(err);
        }
      });

      router.on(schema("TEST"), async () => {
        // handler
      });

      const tr = createTestRouter({
        create: () => router,
        onErrorCapture: false,
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await conn.drain();

      // We should have caught the "next() called multiple times" error
      expect(errors.length).toBeGreaterThan(0);
      const multipleCallError = errors.find((e) =>
        String(e).includes("next() called multiple times"),
      );
      expect(multipleCallError).toBeDefined();

      await tr.close();
    });
  });

  describe("heartbeat handling", () => {
    it("responds to heartbeat with heartbeat-ack", async () => {
      const router = createRouter();
      router.on(schema("PING"), async () => {
        // dummy handler
      });

      const tr = createTestRouter({
        create: () => router,
      });

      const conn = await tr.connect();
      conn.send("__heartbeat");
      await conn.drain();

      const outgoing = conn.outgoing();
      const ack = outgoing.find((msg) => msg.type === "__heartbeat_ack");
      expect(ack).toBeDefined();
      expect(ack?.meta?.ts).toBeDefined();

      await tr.close();
    });

    it("does not invoke user handlers for heartbeat", async () => {
      const router = createRouter();
      let called = false;

      router.on(schema("__heartbeat"), async () => {
        called = true;
      });

      const tr = createTestRouter({
        create: () => router,
      });

      const conn = await tr.connect();
      conn.send("__heartbeat");
      await conn.drain();

      expect(called).toBe(false);
      await tr.close();
    });
  });

  describe("reserved types", () => {
    it("blocks user handlers for reserved types", async () => {
      const router = createRouter();
      const errors: unknown[] = [];

      router.onError((err) => {
        errors.push(err);
      });

      router.on(schema("__custom"), async () => {
        // should never be called
      });

      const tr = createTestRouter({
        create: () => router,
        onErrorCapture: false,
      });

      const conn = await tr.connect();
      conn.send("__custom");
      await conn.drain();

      // Should have error about reserved type
      const reservedError = errors.find((e) =>
        String(e).includes("Reserved type"),
      );
      expect(reservedError).toBeDefined();

      await tr.close();
    });
  });

  describe("unknown message types", () => {
    it("routes unknown types to onError", async () => {
      const router = createRouter();
      const errors: unknown[] = [];

      router.onError((err) => {
        errors.push(err);
      });

      const tr = createTestRouter({
        create: () => router,
        onErrorCapture: false,
      });

      const conn = await tr.connect();
      conn.send("UNKNOWN_TYPE");
      await conn.drain();

      const error = errors.find((e) =>
        String(e).includes("No handler registered"),
      );
      expect(error).toBeDefined();

      await tr.close();
    });
  });

  describe("error handling", () => {
    it("catches handler errors and routes to onError", async () => {
      const router = createRouter();
      const errors: unknown[] = [];

      router.onError((err) => {
        errors.push(err);
      });

      router.on(schema("THROW"), async () => {
        throw new Error("Handler error");
      });

      const tr = createTestRouter({
        create: () => router,
        onErrorCapture: false,
      });

      const conn = await tr.connect();
      conn.send("THROW");
      await conn.drain();

      const handlerError = errors.find((e) =>
        String(e).includes("Handler error"),
      );
      expect(handlerError).toBeDefined();

      await tr.close();
    });

    it("catches middleware errors and routes to onError", async () => {
      const router = createRouter();
      const errors: unknown[] = [];

      router.onError((err) => {
        errors.push(err);
      });

      router.use(async (ctx, next) => {
        throw new Error("Middleware error");
      });

      router.on(schema("TEST"), async () => {
        // won't reach here
      });

      const tr = createTestRouter({
        create: () => router,
        onErrorCapture: false,
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await conn.drain();

      const mwError = errors.find((e) =>
        String(e).includes("Middleware error"),
      );
      expect(mwError).toBeDefined();

      await tr.close();
    });
  });

  describe("context building", () => {
    it("provides basic context fields", async () => {
      const router = createRouter();
      let receivedType: string | undefined;
      let hasWs = false;
      let hasSetData = false;

      router.on(schema("MSG"), async (ctx) => {
        receivedType = ctx.type;
        hasWs = "ws" in ctx && ctx.ws !== undefined;
        hasSetData = typeof ctx.assignData === "function";
      });

      const tr = createTestRouter({
        create: () => router,
      });

      const conn = await tr.connect();
      conn.send("MSG");
      await conn.drain();

      expect(receivedType).toBe("MSG");
      expect(hasWs).toBe(true);
      expect(hasSetData).toBe(true);
      await tr.close();
    });

    it("provides assignData function in context", async () => {
      interface AppData {
        userId?: string;
        count?: number;
      }

      const router = createRouter<AppData>();
      let assignDataWasCalled = false;

      router.on(schema("UPDATE"), async (ctx) => {
        // Verify assignData is available and callable
        expect(typeof ctx.assignData).toBe("function");
        ctx.assignData({ count: 42 });
        assignDataWasCalled = true;
      });

      const tr = createTestRouter({
        create: () => router,
      });

      const conn = await tr.connect<AppData>();
      conn.send("UPDATE");
      await conn.drain();

      expect(assignDataWasCalled).toBe(true);

      await tr.close();
    });
  });
});
