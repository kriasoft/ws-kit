// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Publish Origin Tracking Tests
 *
 * Validates sender/author tracking in broadcast messages using recommended patterns:
 * 1. Include sender in payload (recommended for essential message semantics)
 * 2. Include sender in extended meta (recommended for optional metadata)
 *
 * Tests router.publish() and ctx.publish() with origin tracking via test harness.
 * Demonstrates real-world patterns for sender identity in published messages.
 *
 * Spec: docs/specs/pubsub.md#origin-tracking-include-sender-identity
 * Related: ADR-022 (pub/sub API design), ADR-024 (unified adapter)
 */

import { test } from "@ws-kit/core/testing";
import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { createRouter, message, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

describe("Publish Origin Tracking via ctx.publish()", () => {
  describe("Sender in Payload Pattern", () => {
    it("should support including sender userId in payload", async () => {
      interface ChatPayload {
        text: string;
        senderId: string;
      }
      const ChatMessage = message("CHAT", {
        text: z.string(),
        senderId: z.string(),
      });

      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
        capturePubSub: true,
      });

      // Publish message with sender payload
      const result = await tr.publish("room:general", ChatMessage, {
        text: "Hello world",
        senderId: "alice",
      });

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      const payload = publishes[0]!.payload as ChatPayload;
      expect(payload.senderId).toBe("alice");
      expect(payload.text).toBe("Hello world");

      await tr.close();
    });

    it("should accept numeric sender IDs in payload", async () => {
      interface RoomPayload {
        text: string;
        userId: number;
      }
      const RoomUpdate = message("ROOM_UPDATE", {
        text: z.string(),
        userId: z.number(),
      });

      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: number }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
        capturePubSub: true,
      });

      const result = await tr.publish("room:123", RoomUpdate, {
        text: "User joined",
        userId: 42,
      });

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      const payload = publishes[0]!.payload as RoomPayload;
      expect(payload.userId).toBe(42);

      await tr.close();
    });
  });

  describe("Sender in Extended Meta Pattern", () => {
    it("should support custom meta fields via PublishOptions", async () => {
      const Message = message(
        "MSG",
        { text: z.string() },
        { senderId: z.string().optional() },
      );

      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
        capturePubSub: true,
      });

      // Use meta option to include sender in extended metadata
      const result = await tr.publish(
        "room:general",
        Message,
        { text: "Hello" },
        { meta: { senderId: "bob" } },
      );

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0]!.meta?.senderId).toBe("bob");

      await tr.close();
    });

    it("should merge multiple custom meta fields", async () => {
      const RoomMsg = message(
        "ROOM",
        { text: z.string() },
        {
          roomId: z.string(),
          senderId: z.string().optional(),
          priority: z.number().optional(),
        },
      );

      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
        capturePubSub: true,
      });

      const result = await tr.publish(
        "room:lobby",
        RoomMsg,
        { text: "Welcome" },
        {
          meta: {
            roomId: "room:123",
            senderId: "charlie",
            priority: 5,
          },
        },
      );

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0]!.meta).toEqual(
        expect.objectContaining({
          roomId: "room:123",
          senderId: "charlie",
          priority: 5,
        }),
      );

      await tr.close();
    });
  });

  describe("Metadata Handling", () => {
    it("should capture metadata in published messages", async () => {
      const Message = message("MSG", { text: z.string() });

      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
        capturePubSub: true,
      });

      const timestamp = Date.now();
      const result = await tr.publish(
        "room",
        Message,
        { text: "test" },
        { meta: { timestamp, customField: "value" } },
      );

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0]!.meta).toEqual(
        expect.objectContaining({ customField: "value" }),
      );
      expect(typeof publishes[0]!.meta?.timestamp).toBe("number");

      await tr.close();
    });

    it("should preserve custom metadata across publishes", async () => {
      const Message = message("MSG", { text: z.string() });

      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
        capturePubSub: true,
      });

      const customTimestamp = 1234567890;
      const result = await tr.publish(
        "room",
        Message,
        { text: "test" },
        { meta: { timestamp: customTimestamp } },
      );

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0]!.meta?.timestamp).toBe(1234567890);

      await tr.close();
    });
  });

  describe("MemoryPubSub Integration", () => {
    it("should work with real MemoryPubSub and sender tracking", async () => {
      const Message = message("MSG", { text: z.string() });

      const adapter = memoryPubSub();
      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter })),
        capturePubSub: true,
      });

      const result = await tr.publish(
        "room",
        Message,
        { text: "Hello" },
        { meta: { senderId: "alice" } },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capability).toBe("exact");
      }

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0]!.meta?.senderId).toBe("alice");

      await tr.close();
    });

    it("should support publishing with partitionKey and meta options", async () => {
      const Message = message("MSG", { text: z.string() });

      const adapter = memoryPubSub();
      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter })),
        capturePubSub: true,
      });

      const result = await tr.publish(
        "room",
        Message,
        { text: "test" },
        {
          partitionKey: "user:user123",
          meta: { customField: "value" },
        },
      );

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0]!.meta?.customField).toBe("value");

      await tr.close();
    });
  });
});
