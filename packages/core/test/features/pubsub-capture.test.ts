// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Pub/Sub Capture Tests
 *
 * Validates that the test harness correctly captures pub/sub publish and subscription events
 * when a router is configured with pub/sub plugin.
 *
 * Spec: docs/specs/pubsub.md
 * Related: test-harness.ts, withPubSub plugin
 */

import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";
import { createTestRouter } from "../../src/testing/index.js";

// Test messages
const ChatMessage = message("CHAT_MESSAGE", {
  text: z.string(),
});

const Notification = message("NOTIFICATION", {
  body: z.string(),
});

describe("Pub/Sub Capture in Test Harness", () => {
  describe("withPubSub() canonical API", () => {
    it("should accept adapter only", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      expect(tr.capture.publishes()).toBeDefined();
    });

    it("should accept adapter with observer", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
              observer: {
                onPublish: (rec) => {
                  // Observer callback
                },
              },
            }),
          ),
      });

      expect(tr.capture.publishes()).toBeDefined();
    });

    it("should accept limits and topic validation options", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
              limits: {
                maxTopicsPerConn: 100,
              },
              topic: {
                normalize: (t) => t.toLowerCase().trim(),
                validate: (t) => {
                  if (!t) throw new Error("Topic cannot be empty");
                },
              },
            }),
          ),
      });

      expect(tr.capture.publishes()).toBeDefined();
    });
  });

  describe("capture.publishes() — basic publish capture", () => {
    it("should capture published messages", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      const conn = await tr.connect({ data: { userId: "user1" } });

      // Register handler that publishes
      (tr as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish("chat-room", ChatMessage, {
          text: "hello from handler",
        });
      });

      // Send message to trigger publish
      conn.send("CHAT_MESSAGE", { text: "trigger" });
      await tr.flush();

      // Verify capture
      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0].topic).toBe("chat-room");
      expect(publishes[0].payload).toEqual({ text: "hello from handler" });
    });

    it("should capture multiple publishes", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      const conn = await tr.connect({ data: { userId: "user1" } });

      (tr as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish("notifications", Notification, {
          body: "notification 1",
        });
        await ctx.publish("notifications", Notification, {
          body: "notification 2",
        });
      });

      conn.send("CHAT_MESSAGE", { text: "trigger" });
      await tr.flush();

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(2);
      expect(publishes[0].payload).toEqual({ body: "notification 1" });
      expect(publishes[1].payload).toEqual({ body: "notification 2" });
    });

    it("should clear publishes with capture.clear()", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      const conn = await tr.connect({ data: { userId: "user1" } });

      (tr as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish("chat", ChatMessage, { text: "msg1" });
      });

      conn.send("CHAT_MESSAGE", { text: "trigger" });
      await tr.flush();

      expect(tr.capture.publishes()).toHaveLength(1);

      tr.capture.clear();
      expect(tr.capture.publishes()).toHaveLength(0);
    });

    it("should work with direct router.publish()", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      // Directly publish on router
      const result = await (tr as any).publish("announcements", ChatMessage, {
        text: "direct publish",
      });
      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0].topic).toBe("announcements");
      expect(publishes[0].payload).toEqual({ text: "direct publish" });
    });

    it("should include meta in captures", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      const conn = await tr.connect({ data: { userId: "user1" } });

      (tr as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish(
          "chat",
          ChatMessage,
          { text: "msg" },
          {
            meta: { priority: "high" },
          },
        );
      });

      conn.send("CHAT_MESSAGE", { text: "trigger" });
      await tr.flush();

      const publishes = tr.capture.publishes();
      expect(publishes[0].meta).toEqual({ priority: "high" });
    });
  });

  describe("capture.publishes() — with router.pubsub.tap()", () => {
    it("should allow manual tap() registration", async () => {
      const router = createRouter<{ userId?: string }>().plugin(
        withPubSub({
          adapter: memoryPubSub(),
        }),
      );

      const observed: any[] = [];
      (router as any).pubsub.tap({
        onPublish: (rec: any) => observed.push(rec),
      });

      (router as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish("chat", ChatMessage, { text: "test" });
      });

      const tr = createTestRouter({
        create: () => router,
      });

      const conn = await tr.connect();
      conn.send("CHAT_MESSAGE", { text: "trigger" });
      await tr.flush();

      // Both the manual observer and the harness should see it
      expect(observed).toHaveLength(1);
      expect(tr.capture.publishes()).toHaveLength(1);
    });

    it("should support observer unsubscribe", async () => {
      const router = createRouter<{ userId?: string }>().plugin(
        withPubSub({
          adapter: memoryPubSub(),
        }),
      );

      const observed: any[] = [];
      const observer = {
        onPublish: (rec: any) => observed.push(rec),
      };
      const unsub = (router as any).pubsub.tap(observer);

      (router as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish("chat", ChatMessage, { text: "msg1" });
      });

      const tr = createTestRouter({
        create: () => router,
      });

      const conn = await tr.connect();
      conn.send("CHAT_MESSAGE", { text: "trigger1" });
      await tr.flush();
      expect(observed).toHaveLength(1);

      // Unsubscribe the observer
      unsub();

      conn.send("CHAT_MESSAGE", { text: "trigger2" });
      await tr.flush();

      // Original observer should not see the second publish
      expect(observed).toHaveLength(1);
      // But the harness should still capture it
      expect(tr.capture.publishes()).toHaveLength(2);
    });
  });

  describe("capture.publishes() — edge cases", () => {
    it("should return empty array when pub/sub not enabled", async () => {
      // Router without pub/sub plugin
      const tr = createTestRouter({
        create: () => createRouter<{ userId?: string }>(),
      });

      expect(tr.capture.publishes()).toHaveLength(0);
      expect(tr.capture.publishes()).toEqual([]);
    });

    it("should handle failed publishes (excludeSelf)", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      const conn = await tr.connect({ data: { userId: "user1" } });

      let publishResult: any;
      (tr as any).on(ChatMessage, async (ctx: any) => {
        publishResult = await ctx.publish(
          "chat",
          ChatMessage,
          { text: "msg" },
          { excludeSelf: true },
        );
      });

      conn.send("CHAT_MESSAGE", { text: "trigger" });
      await tr.flush();

      // Failed publishes should NOT be captured
      expect(publishResult.ok).toBe(false);
      expect(tr.capture.publishes()).toHaveLength(0);
    });

    it("should capture disableCapture option works correctly", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
        capturePubSub: false, // Explicitly disable capture
      });

      const conn = await tr.connect();
      (tr as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish("chat", ChatMessage, { text: "msg" });
      });

      conn.send("CHAT_MESSAGE", { text: "trigger" });
      await tr.flush();

      // Capture should be empty because we disabled it
      expect(tr.capture.publishes()).toHaveLength(0);
    });
  });

  describe("Integration — publish with multiple messages", () => {
    it("should capture sequence of publishes from different handlers", async () => {
      const tr = createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>().plugin(
            withPubSub({
              adapter: memoryPubSub(),
            }),
          ),
      });

      const conn = await tr.connect({ data: { userId: "user1" } });

      // First handler publishes one message
      (tr as any).on(ChatMessage, async (ctx: any) => {
        await ctx.publish("notifications", ChatMessage, {
          text: "notification 1",
        });
      });

      // Second handler publishes another
      (tr as any).on(Notification, async (ctx: any) => {
        await ctx.publish("notifications", Notification, {
          body: "notification 2",
        });
      });

      // Trigger first handler
      conn.send("CHAT_MESSAGE", { text: "trigger1" });
      await tr.flush();

      // Then trigger second handler
      conn.send("NOTIFICATION", { body: "trigger2" });
      await tr.flush();

      // Both should be captured
      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(2);
      expect(publishes[0].payload).toEqual({ text: "notification 1" });
      expect(publishes[1].payload).toEqual({ body: "notification 2" });
    });
  });
});
