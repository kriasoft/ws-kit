// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Publish Origin Option Tests
 *
 * Validates origin-based sender tracking in broadcast messages,
 * ensuring clientId is never injected and origin option works correctly.
 *
 * Spec: @specs/broadcasting.md#Origin-Option
 */

import type { ServerWebSocket } from "bun";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { publish } from "../../zod/publish";
import { createMessageSchema } from "../../packages/zod/src/schema";

const { messageSchema } = createMessageSchema(z);

// Mock WebSocket with flexible data structure
class MockServerWebSocket {
  data: { clientId: string } & Record<string, unknown>;
  publishedMessages: { topic: string; data: string }[] = [];

  constructor(data: { clientId: string } & Record<string, unknown>) {
    this.data = data;
  }

  publish(topic: string, data: string) {
    this.publishedMessages.push({ topic, data });
    return true;
  }

  subscribe(/* _topic: string */) {
    /* Mock */
  }
  unsubscribe(/* _topic: string */) {
    /* Mock */
  }
}

function castMockWebSocket(
  ws: MockServerWebSocket,
): ServerWebSocket<{ clientId: string } & Record<string, unknown>> {
  return ws as unknown as ServerWebSocket<
    { clientId: string } & Record<string, unknown>
  >;
}

describe("Publish Origin Option", () => {
  describe("ClientId Never Injected", () => {
    it("should NEVER inject clientId into broadcast meta", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({ clientId: "client-123" });

      publish(castMockWebSocket(ws), "room", ChatMsg, { text: "hi" });

      const message = ws.publishedMessages[0]!;
      expect(message).toBeDefined();

      const data = JSON.parse(message.data);
      expect(data.meta).not.toHaveProperty("clientId");
      expect(data.meta).toHaveProperty("timestamp"); // Auto-injected
    });

    it("should not inject clientId even with custom meta", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({ clientId: "client-456" });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hello" },
        { correlationId: "req-1" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).not.toHaveProperty("clientId");
      expect(data.meta).toHaveProperty("correlationId", "req-1");
    });

    it("should not inject clientId with extended meta schema", () => {
      const RoomMsg = messageSchema(
        "ROOM",
        { text: z.string() },
        { roomId: z.string() },
      );
      const ws = new MockServerWebSocket({ clientId: "client-789" });

      publish(
        castMockWebSocket(ws),
        "room",
        RoomMsg,
        { text: "test" },
        { roomId: "room-1" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).not.toHaveProperty("clientId");
      expect(data.meta).toHaveProperty("roomId", "room-1");
    });
  });

  describe("Origin Option - Basic Behavior", () => {
    it("should inject senderId from ws.data when origin specified", () => {
      // Schema must define senderId if using origin option
      const ChatMsg = messageSchema(
        "CHAT",
        { text: z.string() },
        { senderId: z.string().optional() },
      );
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "alice",
      });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "userId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).toHaveProperty("senderId", "alice");
      expect(data.meta).not.toHaveProperty("userId"); // Origin field not copied
      expect(data.meta).not.toHaveProperty("clientId");
    });

    it("should use custom key parameter for origin injection", () => {
      const ChatMsg = messageSchema(
        "CHAT",
        { text: z.string() },
        { authorId: z.string().optional() },
      );
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "bob",
      });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hello" },
        { origin: "userId", key: "authorId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).toHaveProperty("authorId", "bob");
      expect(data.meta).not.toHaveProperty("senderId"); // Default key not used
      expect(data.meta).not.toHaveProperty("userId");
    });

    it("should inject origin with extended meta", () => {
      const RoomMsg = messageSchema(
        "ROOM",
        { text: z.string() },
        { roomId: z.string(), senderId: z.unknown().optional() },
      );
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "charlie",
      });

      publish(
        castMockWebSocket(ws),
        "room",
        RoomMsg,
        { text: "test" },
        { roomId: "room-1", origin: "userId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).toHaveProperty("senderId", "charlie");
      expect(data.meta).toHaveProperty("roomId", "room-1");
      expect(data.meta).toHaveProperty("timestamp");
    });
  });

  describe("Origin Option - No-Op Behavior", () => {
    it("should not inject senderId when ws.data[origin] is undefined", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        // userId missing
      });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "userId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).not.toHaveProperty("senderId"); // No-op
      expect(data.meta).toHaveProperty("timestamp"); // Still auto-injected
    });

    it("should not inject when origin field does not exist", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        otherField: "value",
      });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "test" },
        { origin: "missingField" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).not.toHaveProperty("senderId");
      expect(data.meta).toHaveProperty("timestamp");
    });

    it("should not inject when ws.data[origin] is null", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: null,
      });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "userId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).not.toHaveProperty("senderId");
    });
  });

  describe("Origin with Different Data Types", () => {
    it("should inject string origin values", () => {
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "alice",
      });
      const ChatMsg = messageSchema(
        "CHAT",
        { text: z.string() },
        { senderId: z.unknown().optional() },
      );

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "userId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta.senderId).toBe("alice");
    });

    it("should inject number origin values", () => {
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        numericId: 42,
      });
      const ChatMsg = messageSchema(
        "CHAT",
        { text: z.string() },
        { senderId: z.unknown().optional() },
      );

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "numericId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta.senderId).toBe(42);
    });

    it("should inject object origin values", () => {
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        user: { id: "alice", role: "admin" },
      });
      const ChatMsg = messageSchema(
        "CHAT",
        { text: z.string() },
        { author: z.unknown().optional() },
      );

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "user", key: "author" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta.author).toEqual({ id: "alice", role: "admin" });
    });
  });

  describe("Auto-Timestamp Injection", () => {
    it("should always inject timestamp", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({ clientId: "client-123" });

      const before = Date.now();
      publish(castMockWebSocket(ws), "room", ChatMsg, { text: "hi" });
      const after = Date.now();

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta.timestamp).toBeGreaterThanOrEqual(before);
      expect(data.meta.timestamp).toBeLessThanOrEqual(after);
    });

    it("should inject timestamp even when origin is no-op", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        // userId missing
      });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "userId" }, // No-op
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta.timestamp).toBeGreaterThan(0);
      expect(data.meta).not.toHaveProperty("senderId");
    });

    it("should preserve user-provided timestamp if specified", () => {
      const ChatMsg = messageSchema(
        "CHAT",
        { text: z.string() },
        { senderId: z.unknown().optional() },
      );
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "alice",
      });

      const customTimestamp = 1234567890;
      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { timestamp: customTimestamp, origin: "userId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta.timestamp).toBe(customTimestamp); // User override
      expect(data.meta.senderId).toBe("alice");
    });
  });

  describe("Validation Before Broadcast", () => {
    it("should validate message with origin-injected senderId", () => {
      const ChatMsg = messageSchema(
        "CHAT",
        { text: z.string() },
        { senderId: z.unknown().optional() },
      );
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "alice",
      });

      const result = publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "valid" },
        { origin: "userId" },
      );

      expect(result).toBe(true);
      expect(ws.publishedMessages.length).toBe(1);
    });

    it("should fail validation if origin injection creates invalid message", () => {
      // Schema requires specific meta structure
      const StrictMsg = messageSchema(
        "STRICT",
        { text: z.string() },
        {}, // No extended meta defined - strict mode will reject senderId
      );
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "alice",
      });

      const result = publish(
        castMockWebSocket(ws),
        "room",
        StrictMsg,
        { text: "test" },
        { origin: "userId" }, // Will inject senderId (unknown key)
      );

      // Should fail validation due to unknown meta key
      expect(result).toBe(false);
      expect(ws.publishedMessages.length).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty ws.data gracefully", () => {
      const ChatMsg = messageSchema("CHAT", { text: z.string() });
      const ws = new MockServerWebSocket({ clientId: "client-123" });

      publish(
        castMockWebSocket(ws),
        "room",
        ChatMsg,
        { text: "hi" },
        { origin: "userId" },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).not.toHaveProperty("senderId"); // No-op
    });

    it("should handle multiple custom meta fields with origin", () => {
      const RoomMsg = messageSchema(
        "ROOM",
        { text: z.string() },
        {
          roomId: z.string(),
          priority: z.number(),
          senderId: z.unknown().optional(),
        },
      );
      const ws = new MockServerWebSocket({
        clientId: "client-123",
        userId: "alice",
      });

      publish(
        castMockWebSocket(ws),
        "room",
        RoomMsg,
        { text: "test" },
        {
          roomId: "room-1",
          priority: 5,
          correlationId: "req-1",
          origin: "userId",
        },
      );

      const data = JSON.parse(ws.publishedMessages[0]!.data);
      expect(data.meta).toHaveProperty("senderId", "alice");
      expect(data.meta).toHaveProperty("roomId", "room-1");
      expect(data.meta).toHaveProperty("priority", 5);
      expect(data.meta).toHaveProperty("correlationId", "req-1");
      expect(data.meta).toHaveProperty("timestamp");
    });
  });
});
