// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import { createRouter } from "../../src";
import { test } from "../../src/testing";
import type { MessageDescriptor } from "../../src";

describe("Test Router - Basic", () => {
  describe("Connection management", () => {
    it("should create connections with unique IDs", () => {
      const tr = test.createTestRouter<unknown>({
        create: () => createRouter(),
      });

      const conn1 = tr.connect();
      const conn2 = tr.connect();

      expect(conn1.getData()).toEqual({});
      expect(conn2.getData()).toEqual({});
    });

    it("should initialize connection with data", () => {
      const tr = test.createTestRouter<{ userId: string }>({
        create: () => createRouter(),
      });

      const conn = tr.connect({ data: { userId: "user-123" } });
      expect(conn.getData()).toEqual({ userId: "user-123" });
    });

    it("should support setData to update connection data", () => {
      const tr = test.createTestRouter<{ userId: string; role?: string }>({
        create: () => createRouter(),
      });

      const conn = tr.connect({ data: { userId: "user-123" } });
      expect(conn.getData().userId).toBe("user-123");

      conn.setData({ role: "admin" });
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

      const conn = tr.connect();
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

      const conn = tr.connect({ data: { userId: "user-123" } });
      conn.send("TEST");
      await tr.flush();

      expect(capturedType).toBe("TEST");
      expect(capturedUserId).toBe("user-123");
    });

    it("should error when no handler is registered", async () => {
      const tr = test.createTestRouter({ create: () => createRouter() });

      const conn = tr.connect();
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

      const conn = tr.connect();
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

      const conn = tr.connect();
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

      const conn = tr.connect();
      conn.send("TEST");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBe(1);
      expect((errors[0] as Error).message).toBe("Handler error");
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

      const conn = tr.connect();
      conn.send("TEST");
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect((errors[0] as Error).message).toContain("Middleware error");
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

      const conn = tr.connect();
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

      let replyTo: ((payload: unknown) => void) | undefined;

      tr.on(TestMessage, (ctx) => {
        if (replyTo) {
          // Manually send a response (since we don't have validation plugin)
          const responseFrame = {
            type: "RESPONSE",
            payload: { ok: true },
          };
          ctx.ws.send(JSON.stringify(responseFrame));
        }
      });

      const conn = tr.connect();
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

      const conn1 = tr.connect();
      const conn2 = tr.connect();

      expect(conn1.ws.readyState).toBe("OPEN");
      expect(conn2.ws.readyState).toBe("OPEN");

      await tr.close();

      expect(conn1.ws.readyState).toBe("CLOSED");
      expect(conn2.ws.readyState).toBe("CLOSED");
    });
  });
});
