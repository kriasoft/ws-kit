// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Basic usage tests covering router fundamentals.
 *
 * Tests fundamental messaging patterns using TestRouter:
 * - Router setup and handler composition
 * - Fire-and-forget messaging (handler execution)
 * - Request-response pattern (RPC handling)
 * - Context operations (middleware, error handling)
 * - Real-world scenarios (chat, e-commerce)
 */

import type { MessageDescriptor } from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { test } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";

// For tests that don't need validation, use plain MessageDescriptor
const createSimpleRouter = () => createRouter();

describe("basic usage patterns", () => {
  describe("router configuration and composition", () => {
    it("should create router instance", () => {
      const router = createSimpleRouter();
      expect(router).toBeDefined();
    });

    it("should support handler chaining", async () => {
      const Message1: MessageDescriptor = { type: "MSG1", kind: "event" };
      const Message2: MessageDescriptor = { type: "MSG2", kind: "event" };
      const Message3: MessageDescriptor = { type: "MSG3", kind: "event" };

      const calls: string[] = [];

      const tr = test.createTestRouter({
        create: () =>
          createSimpleRouter()
            .on(Message1, () => {
              calls.push("m1");
            })
            .on(Message2, () => {
              calls.push("m2");
            })
            .on(Message3, () => {
              calls.push("m3");
            }),
      });

      const conn = await tr.connect();
      conn.send("MSG1", { data: "test1" });
      conn.send("MSG2", { data: "test2" });
      conn.send("MSG3", { data: "test3" });
      await tr.flush();

      expect(calls).toEqual(["m1", "m2", "m3"]);
      await tr.close();
    });

    it("should register message and RPC-like handlers together", async () => {
      const Message1: MessageDescriptor = { type: "MSG1", kind: "event" };
      const Message2: MessageDescriptor = { type: "MSG2", kind: "event" };

      const calls: string[] = [];

      const tr = test.createTestRouter({
        create: () =>
          createSimpleRouter()
            .on(Message1, (ctx) => {
              calls.push("handler1");
            })
            .on(Message2, (ctx) => {
              calls.push("handler2");
            }),
      });

      const conn = await tr.connect();
      conn.send("MSG1", { text: "hello" });
      conn.send("MSG2", { msg: "test" });
      await tr.flush();

      expect(calls).toEqual(["handler1", "handler2"]);
      await tr.close();
    });
  });

  describe("fire-and-forget messaging", () => {
    it("should execute handler for sent message", async () => {
      const TestMessage: MessageDescriptor = { type: "TEST", kind: "event" };

      const tr = test.createTestRouter({
        create: createSimpleRouter,
      });

      let handlerCalled = false;

      tr.on(TestMessage, (ctx) => {
        handlerCalled = true;
      });

      const conn = await tr.connect();
      conn.send("TEST", { value: "hello" });
      await tr.flush();

      expect(handlerCalled).toBe(true);
      await tr.close();
    });

    // NOTE: Message sending via ctx.send() (high-level API) is tested in the
    // features/ directory (e.g., messaging/send-basic.test.ts). This basic usage
    // test file focuses on handler routing and composition patterns without
    // requiring validator or messaging plugins.

    it("should route different message types to correct handlers", async () => {
      const Message1: MessageDescriptor = { type: "MSG1", kind: "event" };
      const Message2: MessageDescriptor = { type: "MSG2", kind: "event" };

      const tr = test.createTestRouter({
        create: createSimpleRouter,
      });

      const calls: string[] = [];

      tr.on(Message1, () => {
        calls.push("msg1");
      });
      tr.on(Message2, () => {
        calls.push("msg2");
      });

      const conn = await tr.connect();
      conn.send("MSG1", { text: "a" });
      conn.send("MSG2", { text: "b" });
      conn.send("MSG1", { text: "c" });
      await tr.flush();

      expect(calls).toEqual(["msg1", "msg2", "msg1"]);
      await tr.close();
    });
  });

  describe("request-response pattern", () => {
    it("should handle RPC-like request messages", async () => {
      const Request: MessageDescriptor = { type: "REQ", kind: "rpc" };

      const calls: string[] = [];

      const tr = test.createTestRouter({
        create: () =>
          createSimpleRouter().on(Request, (ctx) => {
            calls.push("handler");
          }),
      });

      const conn = await tr.connect();
      conn.send("REQ", { text: "test" });
      await tr.flush();

      expect(calls).toContain("handler");
      await tr.close();
    });

    // NOTE: RPC responses via ctx.reply() (high-level API) are tested in the
    // features/ directory (e.g., rpc/reply-basic.test.ts). This basic usage
    // test focuses on handler routing without requiring RPC plugin.

    it("should handle multiple sequential request messages", async () => {
      const SequentialRequest: MessageDescriptor = {
        type: "REQ_SEQ",
        kind: "rpc",
      };

      const calls: string[] = [];

      const tr = test.createTestRouter({
        create: () =>
          createSimpleRouter().on(SequentialRequest, (ctx) => {
            const payload = ctx.data as { id: number };
            calls.push(`request-${payload.id}`);
          }),
      });

      const conn = await tr.connect();
      conn.send("REQ_SEQ", { id: 1 });
      conn.send("REQ_SEQ", { id: 2 });
      conn.send("REQ_SEQ", { id: 3 });
      await tr.flush();

      expect(calls).toHaveLength(3);
      await tr.close();
    });
  });
  describe("context operations", () => {
    it("should access context properties in handlers", async () => {
      const Message: MessageDescriptor = { type: "MSG", kind: "event" };

      const tr = test.createTestRouter({
        create: createSimpleRouter,
      });

      const captured: string[] = [];
      tr.on(Message, (ctx) => {
        captured.push(ctx.type);
      });

      const conn = await tr.connect();
      conn.send("MSG", { name: "Alice", age: 30 });
      await tr.flush();

      expect(captured).toEqual(["MSG"]);
      await tr.close();
    });

    it("should support middleware with use()", async () => {
      const Message: MessageDescriptor = { type: "MSG", kind: "event" };

      const tr = test.createTestRouter({
        create: createSimpleRouter,
      });

      const calls: string[] = [];

      tr.use((ctx, next) => {
        calls.push("middleware");
        return next();
      });

      tr.on(Message, (ctx) => {
        calls.push("handler");
      });

      const conn = await tr.connect();
      conn.send("MSG", { text: "test" });
      await tr.flush();

      expect(calls).toEqual(["middleware", "handler"]);
      await tr.close();
    });

    it("should capture handler errors", async () => {
      const Message: MessageDescriptor = { type: "MSG", kind: "event" };

      const tr = test.createTestRouter({
        create: createSimpleRouter,
      });

      tr.on(Message, () => {
        throw new Error("Handler error");
      });

      const conn = await tr.connect();
      conn.send("MSG", { text: "test" });
      await tr.flush();

      const errors = tr.capture.errors();
      expect(errors.length).toBeGreaterThan(0);
      expect((errors[0] as Error).message).toBe("Handler error");
      await tr.close();
    });
  });

  describe("real-world chat scenario", () => {
    it("should support complete chat flow", async () => {
      const Join: MessageDescriptor = { type: "JOIN", kind: "event" };
      const ChatMsg: MessageDescriptor = { type: "CHAT", kind: "event" };
      const Leave: MessageDescriptor = { type: "LEAVE", kind: "event" };

      const tr = test.createTestRouter({
        create: createSimpleRouter,
      });

      const events: string[] = [];

      tr.on(Join, (ctx) => {
        events.push("join");
      });

      tr.on(ChatMsg, (ctx) => {
        events.push("chat");
      });

      tr.on(Leave, (ctx) => {
        events.push("leave");
      });

      const conn = await tr.connect();
      conn.send("JOIN", { room: "general", user: "Alice" });
      conn.send("CHAT", { user: "Alice", text: "Hello!" });
      conn.send("LEAVE");
      await tr.flush();

      expect(events).toEqual(["join", "chat", "leave"]);
      await tr.close();
    });

    it("should support e-commerce patterns", async () => {
      const ViewProduct: MessageDescriptor = {
        type: "VIEW_PRODUCT",
        kind: "event",
      };
      const AddToCart: MessageDescriptor = {
        type: "ADD_TO_CART",
        kind: "event",
      };
      const Checkout: MessageDescriptor = {
        type: "CHECKOUT",
        kind: "event",
      };

      const tr = test.createTestRouter({
        create: createSimpleRouter,
      });

      const events: string[] = [];

      tr.on(ViewProduct, (ctx) => {
        events.push("view");
      });

      tr.on(AddToCart, (ctx) => {
        events.push("add");
      });

      tr.on(Checkout, (ctx) => {
        events.push("checkout");
        // Sending responses via ctx.send() requires messaging plugin,
        // tested in features/ directory
      });

      const conn = await tr.connect();
      conn.send("VIEW_PRODUCT", { id: "prod-1" });
      conn.send("ADD_TO_CART", { productId: "prod-1", quantity: 2 });
      conn.send("CHECKOUT", { items: [{ productId: "prod-1", quantity: 2 }] });
      await tr.flush();

      expect(events).toEqual(["view", "add", "checkout"]);
      await tr.close();
    });
  });
});
