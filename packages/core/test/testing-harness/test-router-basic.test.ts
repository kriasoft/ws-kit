// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { MessageDescriptor } from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { test } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";

describe("Test Router - Basic", () => {
  describe("Connection management", () => {
    it("should create connections with unique IDs", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
      });

      const conn1 = await tr.connect();
      const conn2 = await tr.connect();

      expect(conn1.getData()).toEqual({});
      expect(conn2.getData()).toEqual({});
    });

    it("should initialize connection with data", async () => {
      const tr = test.createTestRouter<{ userId: string }>({
        create: () => createRouter(),
      });

      const conn = await tr.connect({ data: { userId: "user-123" } });
      expect(conn.getData()).toEqual({ userId: "user-123" });
    });

    it("should support assignData to update connection data", async () => {
      const tr = test.createTestRouter<{ userId: string; role?: string }>({
        create: () => createRouter(),
      });

      const conn = await tr.connect({ data: { userId: "user-123" } });
      expect(conn.getData().userId).toBe("user-123");

      conn.assignData({ role: "admin" });
      expect(conn.getData()).toEqual({ userId: "user-123", role: "admin" });
    });
  });

  describe("Message dispatch", () => {
    it("should dispatch messages to registered handlers", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });
      const calls: string[] = [];

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.on(TestMessage, () => {
        calls.push("handler");
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      expect(calls).toEqual(["handler"]);
    });

    it("should pass context to handlers", async () => {
      const tr = test.createTestRouter<{ userId: string }>({
        create: () => createRouter(),
      });

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      let capturedType: string | undefined;
      let capturedUserId: string | undefined;

      tr.on(TestMessage, (ctx) => {
        capturedType = ctx.type;
        capturedUserId = ctx.data.userId;
      });

      const conn = await tr.connect({ data: { userId: "user-123" } });
      conn.send("TEST");
      await tr.flush();

      expect(capturedType).toBe("TEST");
      expect(capturedUserId).toBe("user-123");
    });

    it("should error when no handler is registered", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const conn = await tr.connect();
      conn.send("UNKNOWN");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect((errors[0] as Error).message).toContain(
        "No handler registered for message type",
      );
    });
  });

  describe("Middleware", () => {
    it("should execute global middleware before handler", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });
      const calls: string[] = [];

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.use((ctx, next) => {
        calls.push("middleware");
        return next();
      });

      tr.on(TestMessage, () => {
        calls.push("handler");
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      expect(calls).toEqual(["middleware", "handler"]);
    });

    it("should execute multiple middleware in registration order", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });
      const calls: string[] = [];

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.use((ctx, next) => {
        calls.push("mw1");
        return next();
      });

      tr.use((ctx, next) => {
        calls.push("mw2");
        return next();
      });

      tr.on(TestMessage, () => {
        calls.push("handler");
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      expect(calls).toEqual(["mw1", "mw2", "handler"]);
    });
  });

  describe("Error capture", () => {
    it("should capture errors in handlers", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.on(TestMessage, () => {
        throw new Error("Handler error");
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      const errors = tr.capture.assertErrors();
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toBe("Handler error");
    });

    it("should capture errors from middleware", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.use((ctx, next) => {
        throw new Error("Middleware error");
      });

      tr.on(TestMessage, () => {
        // Handler won't be called
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      const errors = tr.capture.assertErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.message).toContain("Middleware error");
    });

    it("should clear capture on demand", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.on(TestMessage, () => {
        throw new Error("Test error");
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      expect(tr.capture.errors().length).toBe(1);

      tr.capture.clear();
      expect(tr.capture.errors().length).toBe(0);
    });
  });

  describe("Clock", () => {
    it("should provide a clock for deterministic time", () => {
      const tr = test.createTestRouter({ create: () => createRouter() });
      expect(tr.clock.now()).toBe(0);
    });

    it("should advance clock with tick()", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });
      expect(tr.clock.now()).toBe(0);

      await tr.tick(1000);
      expect(tr.clock.now()).toBe(1000);
    });
  });

  describe("Message capture", () => {
    it("should capture all messages sent to a connection", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.on(TestMessage, (ctx) => {
        // Manually send a response (since we don't have validation plugin)
        const responseFrame = {
          type: "RESPONSE",
          payload: { ok: true },
        };
        ctx.ws.send(JSON.stringify(responseFrame));
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      const outgoing = conn.outgoing();
      expect(outgoing.length).toBeGreaterThan(0);
      expect(outgoing[0]).toEqual({ type: "RESPONSE", payload: { ok: true } });
    });
  });

  describe("Cleanup", () => {
    it("should close all connections on close()", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const conn1 = await tr.connect();
      const conn2 = await tr.connect();

      expect(conn1.ws.readyState).toBe("OPEN");
      expect(conn2.ws.readyState).toBe("OPEN");

      await tr.close();

      expect(conn1.ws.readyState).toBe("CLOSED");
      expect(conn2.ws.readyState).toBe("CLOSED");
    });
  });

  describe("Headers and authentication", () => {
    it("should persist headers and expose via getConnectionInfo", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const conn = await tr.connect({
        headers: { authorization: "Bearer xyz123", "x-user-id": "user-42" },
      });

      const info = tr.getConnectionInfo(conn.clientId);
      expect(info.headers?.authorization).toBe("Bearer xyz123");
      expect(info.headers?.["x-user-id"]).toBe("user-42");
    });

    it("should return empty headers if not provided", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const conn = await tr.connect();
      const info = tr.getConnectionInfo(conn.clientId);
      expect(info.headers).toBeUndefined();
    });

    it("should prevent mutation of headers returned from getConnectionInfo", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const conn = await tr.connect({
        headers: { authorization: "Bearer xyz" },
      });

      const info = tr.getConnectionInfo(conn.clientId);
      if (info.headers) {
        info.headers.authorization = "Bearer mutated";
      }

      // Original headers should be unchanged
      const info2 = tr.getConnectionInfo(conn.clientId);
      expect(info2.headers?.authorization).toBe("Bearer xyz");
    });
  });

  describe("Binary frames and raw message capture", () => {
    it("should keep raw messages when JSON parse fails", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });
      const conn = await tr.connect();

      // Directly access the WebSocket to send malformed data
      const malformed = "{bad json}";
      conn.ws.send(malformed);

      const parsed = conn.outgoing();
      expect(parsed).toHaveLength(0);

      const raw = conn.ws.getSentMessagesRaw();
      expect(raw).toHaveLength(1);
      expect(String(raw[0])).toBe(malformed);
    });

    it("should capture both parsed and raw messages", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const TestMessage: MessageDescriptor = {
        type: "TEST",
        kind: "event",
      };

      tr.on(TestMessage, (ctx) => {
        ctx.ws.send(
          JSON.stringify({ type: "RESPONSE", payload: { ok: true } }),
        );
      });

      const conn = await tr.connect();
      conn.send("TEST");
      await tr.flush();

      const parsed = conn.outgoing();
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.type).toBe("RESPONSE");

      const raw = conn.ws.getSentMessagesRaw();
      expect(raw).toHaveLength(1);
      expect(typeof raw[0]).toBe("string");
    });
  });

  describe("Strict mode for timer leaks", () => {
    it("should warn by default when timers leak", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });
      const messages: string[] = [];
      const originalWarn = console.warn;

      const mockWarn = (msg: string) => {
        messages.push(msg);
      };

      try {
        console.warn = mockWarn;
        // Schedule a timer that won't fire before close
        tr.clock.setTimeout(() => {}, 10000);
        await tr.close();

        expect(messages.some((m) => m.includes("Leaked"))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should throw when timers leak in strict mode", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
        strict: true,
      });

      // Schedule a timer that won't fire before close
      tr.clock.setTimeout(() => {}, 10000);

      await expect(tr.close()).rejects.toThrow(/Timer leaks detected/);
    });

    it("should not throw when no timers leak in strict mode", async () => {
      const tr = test.createTestRouter({
        create: () => createRouter(),
        strict: true,
      });

      // Schedule and then clear a timer
      const timerId = tr.clock.setTimeout(() => {}, 10000);
      tr.clock.clearTimeout(timerId);

      // Should not throw
      await tr.close();
    });
  });
});
