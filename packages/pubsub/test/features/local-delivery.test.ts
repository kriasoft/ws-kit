// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Local Delivery Tests
 *
 * Tests for deliverLocally() behavior with local-only adapters (no start() method).
 * Covers wire format serialization, internal field stripping, and error handling.
 */

import type { PubSubAdapter } from "@ws-kit/core/pubsub";
import { createTestRouter } from "@ws-kit/core/testing";
import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { createRouter, message, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

describe("Local Delivery (memory adapter path)", () => {
  describe("Wire format serialization", () => {
    it("should deliver messages to subscribed clients", async () => {
      const SubMsg = message("SUB", {});
      const BroadcastMsg = message("BROADCAST", { content: z.string() });

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("room:1");
      });

      // Connect two clients and subscribe
      const conn1 = await tr.connect();
      const conn2 = await tr.connect();

      conn1.send("SUB", {});
      conn2.send("SUB", {});
      await tr.flush();

      // Publish to the topic
      await tr.publish("room:1", BroadcastMsg, { content: "hello everyone" });
      await tr.flush();

      // Filter to only BROADCAST messages (ignore any other responses)
      const broadcasts1 = conn1
        .outgoing()
        .filter((m) => m.type === "BROADCAST");
      const broadcasts2 = conn2
        .outgoing()
        .filter((m) => m.type === "BROADCAST");

      expect(broadcasts1.length).toBe(1);
      expect(broadcasts2.length).toBe(1);
      expect((broadcasts1[0] as any).payload.content).toBe("hello everyone");

      await tr.close();
    });

    it("should serialize messages with correct shape: { type, payload, meta? }", async () => {
      const BroadcastMsg = message("WIRE_FORMAT_TEST", { data: z.number() });
      const SubMsg = message("SUB", {});

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("format-test");
      });

      const conn = await tr.connect();
      conn.send("SUB", {});
      await tr.flush();

      // Publish with meta
      await tr.publish(
        "format-test",
        BroadcastMsg,
        { data: 42 },
        { meta: { correlationId: "abc123" } },
      );
      await tr.flush();

      const frame = conn
        .outgoing()
        .find((m) => m.type === "WIRE_FORMAT_TEST") as any;

      expect(frame).toBeDefined();
      expect(frame.type).toBe("WIRE_FORMAT_TEST");
      expect(frame.payload).toEqual({ data: 42 });
      expect(frame.meta?.correlationId).toBe("abc123");
      // Topic should NOT be on the wire
      expect(frame.topic).toBeUndefined();

      await tr.close();
    });

    it("should not include topic field in wire message", async () => {
      const Msg = message("NO_TOPIC_TEST", { value: z.string() });
      const SubMsg = message("SUB", {});

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("my-secret-topic");
      });

      const conn = await tr.connect();
      conn.send("SUB", {});
      await tr.flush();

      await tr.publish("my-secret-topic", Msg, { value: "test" });
      await tr.flush();

      const frame = conn
        .outgoing()
        .find((m) => m.type === "NO_TOPIC_TEST") as any;

      expect(frame).toBeDefined();
      expect(frame.type).toBe("NO_TOPIC_TEST");
      expect(frame.topic).toBeUndefined();

      await tr.close();
    });
  });

  describe("Internal field stripping", () => {
    it("should strip excludeClientId from wire meta when excludeSelf is used", async () => {
      const Msg = message("CHAT", { text: z.string() });
      const SubMsg = message("SUB", {});

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("chat-room");
      });

      tr.on(Msg, async (ctx) => {
        // Publish with excludeSelf - this internally adds excludeClientId to meta
        await ctx.publish(
          "chat-room",
          Msg,
          { text: ctx.payload.text },
          { excludeSelf: true, meta: { customField: "preserved" } },
        );
      });

      const sender = await tr.connect();
      const receiver = await tr.connect();

      sender.send("SUB", {});
      receiver.send("SUB", {});
      await tr.flush();

      // Sender publishes with excludeSelf
      sender.send("CHAT", { text: "hello" });
      await tr.flush();

      // Receiver should get the message
      const frame = receiver.outgoing().find((m) => m.type === "CHAT") as any;
      expect(frame).toBeDefined();

      // Wire message should have custom meta but NOT excludeClientId
      expect(frame.meta?.customField).toBe("preserved");
      expect(frame.meta?.excludeClientId).toBeUndefined();

      await tr.close();
    });

    it("should preserve user meta fields while stripping internal ones", async () => {
      const Msg = message("META_TEST", { n: z.number() });
      const SubMsg = message("SUB", {});

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("meta-topic");
      });

      const conn = await tr.connect();
      conn.send("SUB", {});
      await tr.flush();

      await tr.publish(
        "meta-topic",
        Msg,
        { n: 123 },
        { meta: { correlationId: "xyz", timestamp: 999, source: "test" } },
      );
      await tr.flush();

      const frame = conn.outgoing().find((m) => m.type === "META_TEST") as any;
      expect(frame).toBeDefined();
      expect(frame.meta?.correlationId).toBe("xyz");
      expect(frame.meta?.timestamp).toBe(999);
      expect(frame.meta?.source).toBe("test");

      await tr.close();
    });
  });

  describe("Serialization error handling", () => {
    it("should handle BigInt in payload gracefully without throwing", async () => {
      const SubMsg = message("SUB", {});
      const BadMsg = { messageType: "BAD_MSG" } as any;

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("test-topic");
      });

      const conn = await tr.connect();
      conn.send("SUB", {});
      await tr.flush();

      // Publish with BigInt (not JSON serializable)
      // This should NOT throw - error is handled internally
      let threw = false;
      try {
        await tr.publish("test-topic", BadMsg, { value: BigInt(123) });
      } catch {
        threw = true;
      }

      // Core behavior: doesn't throw, message isn't delivered
      expect(threw).toBe(false);
      expect(conn.outgoing().filter((m) => m.type === "BAD_MSG").length).toBe(
        0,
      );

      await tr.close();
    });

    it("should handle circular references gracefully without throwing", async () => {
      const SubMsg = message("SUB", {});
      const BadMsg = { messageType: "BAD_MSG" } as any;

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("test-topic");
      });

      const conn = await tr.connect();
      conn.send("SUB", {});
      await tr.flush();

      // Create circular reference
      const circular: any = { name: "test" };
      circular.self = circular;

      // Should not throw
      let threw = false;
      try {
        await tr.publish("test-topic", BadMsg, circular);
      } catch {
        threw = true;
      }

      // Core behavior: doesn't throw, message isn't delivered
      expect(threw).toBe(false);
      expect(conn.outgoing().filter((m) => m.type === "BAD_MSG").length).toBe(
        0,
      );

      await tr.close();
    });
  });

  describe("Local delivery trigger", () => {
    it("should trigger local delivery for adapters without start()", async () => {
      let getSubscribersCalled = false;

      const adapter: PubSubAdapter = {
        async publish() {
          return { ok: true, capability: "exact" as const, matched: 1 };
        },
        async subscribe() {},
        async unsubscribe() {},
        // eslint-disable-next-line require-yield
        async *getSubscribers() {
          getSubscribersCalled = true;
        },
        // No start() = local adapter
      };

      const tr = createTestRouter({
        create: () =>
          createRouter().plugin(withZod()).plugin(withPubSub({ adapter })),
      });

      await tr.publish("test-topic", { messageType: "TEST" } as any, {
        text: "hello",
      });

      // deliverLocally should be called, which calls getSubscribers
      expect(getSubscribersCalled).toBe(true);

      await tr.close();
    });

    it("should NOT trigger local delivery for adapters with start()", async () => {
      let getSubscribersCallCount = 0;

      const adapter: PubSubAdapter = {
        async publish() {
          return { ok: true, capability: "exact" as const, matched: 1 };
        },
        async subscribe() {},
        async unsubscribe() {},
        // eslint-disable-next-line require-yield
        async *getSubscribers() {
          getSubscribersCallCount++;
        },
        // Has start() = distributed adapter (broker handles delivery)
        async start() {
          return () => {};
        },
      };

      const tr = createTestRouter({
        create: () =>
          createRouter().plugin(withZod()).plugin(withPubSub({ adapter })),
      });

      await tr.publish("test-topic", { messageType: "TEST" } as any, {
        text: "hello",
      });

      // deliverLocally should NOT be called
      expect(getSubscribersCallCount).toBe(0);

      await tr.close();
    });
  });

  describe("excludeSelf filtering", () => {
    it("should exclude sender when excludeSelf is true", async () => {
      const Msg = message("CHAT", { text: z.string() });
      const SubMsg = message("JOIN", {});

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("chat-room");
      });

      tr.on(Msg, async (ctx) => {
        // Sender publishes with excludeSelf
        await ctx.publish(
          "chat-room",
          Msg,
          { text: ctx.payload.text },
          { excludeSelf: true },
        );
      });

      const sender = await tr.connect();
      const receiver = await tr.connect();

      // Both join
      sender.send("JOIN", {});
      receiver.send("JOIN", {});
      await tr.flush();

      // Sender sends a chat message
      sender.send("CHAT", { text: "hello from sender" });
      await tr.flush();

      // Receiver should get the message
      const receiverChats = receiver
        .outgoing()
        .filter((f) => f.type === "CHAT");
      expect(receiverChats.length).toBe(1);

      // Sender should NOT get their own message (excludeSelf)
      const senderChats = sender.outgoing().filter((f) => f.type === "CHAT");
      expect(senderChats.length).toBe(0);

      await tr.close();
    });
  });
});
