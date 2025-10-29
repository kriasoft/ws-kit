// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import {
  z,
  message,
  zodValidator,
  createMessage,
  ErrorMessage,
  ErrorCode,
} from "../src/index.js";
import type { MessageSchemaType } from "@ws-kit/core";

describe("@ws-kit/zod Validator", () => {
  describe("zodValidator() factory", () => {
    it("should create a ZodValidatorAdapter instance", () => {
      const validator = zodValidator();
      expect(validator).toBeDefined();
      expect(typeof validator.getMessageType).toBe("function");
      expect(typeof validator.safeParse).toBe("function");
      expect(typeof validator.infer).toBe("function");
    });

    it("should have all required ValidatorAdapter methods", () => {
      const validator = zodValidator();
      expect(validator.getMessageType).toBeTruthy();
      expect(validator.safeParse).toBeTruthy();
      expect(validator.infer).toBeTruthy();
    });
  });

  describe("message() function", () => {
    it("should be available as named export", () => {
      expect(message).toBeDefined();
      expect(typeof message).toBe("function");
    });
  });

  describe("message() - Type-Only Schemas", () => {
    it("should create a schema with only type and meta", () => {
      const PingSchema = message("PING");
      expect(PingSchema).toBeDefined();

      // Should accept messages with type and meta
      const result = PingSchema.safeParse({
        type: "PING",
        meta: { timestamp: Date.now() },
      });
      expect(result.success).toBe(true);
    });

    it("should validate message type strictly", () => {
      const PingSchema = message("PING");

      const wrongType = PingSchema.safeParse({
        type: "PONG",
        meta: { timestamp: Date.now() },
      });
      expect(wrongType.success).toBe(false);
    });

    it("should reject unknown keys", () => {
      const PingSchema = message("PING");

      const result = PingSchema.safeParse({
        type: "PING",
        meta: { timestamp: Date.now() },
        unknown: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("message() - With Payload", () => {
    it("should create schema with payload", () => {
      const ChatSchema = message("CHAT", { text: z.string() });

      const result = ChatSchema.safeParse({
        type: "CHAT",
        meta: { timestamp: Date.now() },
        payload: { text: "Hello" },
      });
      expect(result.success).toBe(true);
    });

    it("should validate payload against schema", () => {
      const ChatSchema = message("CHAT", { text: z.string() });

      const result = ChatSchema.safeParse({
        type: "CHAT",
        meta: { timestamp: Date.now() },
        payload: { text: 123 }, // Wrong type
      });
      expect(result.success).toBe(false);
    });

    it("should require payload fields when defined", () => {
      const ChatSchema = message("CHAT", { text: z.string() });

      const result = ChatSchema.safeParse({
        type: "CHAT",
        meta: { timestamp: Date.now() },
        payload: {}, // Missing required 'text'
      });
      expect(result.success).toBe(false);
    });

    it("should accept Zod object as payload", () => {
      const ChatPayload = z.object({
        text: z.string(),
        attachments: z.array(z.string()).optional(),
      });
      const ChatSchema = message("CHAT", ChatPayload);

      const result = ChatSchema.safeParse({
        type: "CHAT",
        meta: { timestamp: Date.now() },
        payload: { text: "Hello" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("message() - With Extended Meta", () => {
    it("should extend meta with additional fields", () => {
      const RoomSchema = message("ROOM", undefined, {
        roomId: z.string(),
      });

      const result = RoomSchema.safeParse({
        type: "ROOM",
        meta: { timestamp: Date.now(), roomId: "room-123" },
      });
      expect(result.success).toBe(true);
    });

    it("should validate extended meta fields", () => {
      const RoomSchema = message("ROOM", undefined, {
        roomId: z.string(),
      });

      const result = RoomSchema.safeParse({
        type: "ROOM",
        meta: { timestamp: Date.now(), roomId: 123 }, // Wrong type
      });
      expect(result.success).toBe(false);
    });

    it("should reject unknown meta fields in strict mode", () => {
      const RoomSchema = message("ROOM", undefined, {
        roomId: z.string(),
      });

      const result = RoomSchema.safeParse({
        type: "ROOM",
        meta: {
          timestamp: Date.now(),
          roomId: "room-123",
          unknownField: "value",
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("message() - With Payload and Meta", () => {
    it("should handle both payload and extended meta", () => {
      const RoomChatSchema = message(
        "ROOM_CHAT",
        { text: z.string() },
        { roomId: z.string() },
      );

      const result = RoomChatSchema.safeParse({
        type: "ROOM_CHAT",
        meta: { timestamp: Date.now(), roomId: "room-123" },
        payload: { text: "Hello room" },
      });
      expect(result.success).toBe(true);
    });

    it("should validate both payload and meta", () => {
      const RoomChatSchema = message(
        "ROOM_CHAT",
        { text: z.string() },
        { roomId: z.string() },
      );

      // Invalid payload
      const result1 = RoomChatSchema.safeParse({
        type: "ROOM_CHAT",
        meta: { timestamp: Date.now(), roomId: "room-123" },
        payload: { text: 123 },
      });
      expect(result1.success).toBe(false);

      // Invalid meta
      const result2 = RoomChatSchema.safeParse({
        type: "ROOM_CHAT",
        meta: { timestamp: Date.now(), roomId: 123 },
        payload: { text: "Hello" },
      });
      expect(result2.success).toBe(false);
    });
  });

  describe("createMessage() helper", () => {
    it("should create valid message from schema and payload", () => {
      const ChatSchema = message("CHAT", { text: z.string() });
      const result = createMessage(ChatSchema, { text: "Hello" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("CHAT");
        expect(result.data.payload).toEqual({ text: "Hello" });
      }
    });

    it("should validate payload in createMessage", () => {
      const ChatSchema = message("CHAT", { text: z.string() });
      const result = createMessage(ChatSchema, { text: 123 } as any);

      expect(result.success).toBe(false);
    });

    it("should support optional meta in createMessage", () => {
      const RoomSchema = message("ROOM", undefined, {
        roomId: z.string(),
      });
      const result = createMessage(RoomSchema, undefined, { roomId: "room-1" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta.roomId).toBe("room-1");
      }
    });
  });

  describe("Validator Adapter Methods", () => {
    const validator = zodValidator();

    it("should extract message type from schema", () => {
      const PingSchema = message("PING");
      const type = validator.getMessageType(
        PingSchema as unknown as MessageSchemaType,
      );
      expect(type).toBe("PING");
    });

    it("should validate messages with safeParse", () => {
      const ChatSchema = message("CHAT", { text: z.string() });
      const msg = {
        type: "CHAT",
        meta: { timestamp: Date.now() },
        payload: { text: "test" },
      };

      const result = validator.safeParse(
        ChatSchema as unknown as MessageSchemaType,
        msg,
      );
      expect(result.success).toBe(true);
    });

    it("should reject invalid messages with safeParse", () => {
      const ChatSchema = message("CHAT", { text: z.string() });
      const msg = {
        type: "CHAT",
        meta: { timestamp: Date.now() },
        payload: { text: 123 },
      };

      const result = validator.safeParse(
        ChatSchema as unknown as MessageSchemaType,
        msg,
      );
      expect(result.success).toBe(false);
    });

    it("should infer schema type", () => {
      const ChatSchema = message("CHAT", { text: z.string() });
      const inferred = validator.infer(
        ChatSchema as unknown as MessageSchemaType,
      );
      expect(inferred).toBeDefined();
    });
  });

  describe("ErrorMessage schema", () => {
    it("should validate error messages", () => {
      const result = ErrorMessage.safeParse({
        type: "ERROR",
        meta: { timestamp: Date.now() },
        payload: {
          code: "VALIDATION_FAILED",
          message: "Invalid input",
        },
      });
      expect(result.success).toBe(true);
    });

    it("should support all error codes", () => {
      const codes = [
        "INVALID_MESSAGE_FORMAT",
        "VALIDATION_FAILED",
        "UNSUPPORTED_MESSAGE_TYPE",
        "AUTHENTICATION_FAILED",
        "AUTHORIZATION_FAILED",
        "RESOURCE_NOT_FOUND",
        "RATE_LIMIT_EXCEEDED",
        "INTERNAL_SERVER_ERROR",
      ];

      for (const code of codes) {
        const result = ErrorMessage.safeParse({
          type: "ERROR",
          meta: { timestamp: Date.now() },
          payload: { code },
        });
        expect(result.success).toBe(true);
      }
    });

    it("should reject unknown error codes", () => {
      const result = ErrorMessage.safeParse({
        type: "ERROR",
        meta: { timestamp: Date.now() },
        payload: {
          code: "UNKNOWN_CODE",
        } as any,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Message metadata", () => {
    it("should accept optional timestamp", () => {
      const ChatSchema = message("CHAT", { text: z.string() });
      const ts = Date.now();

      const result = ChatSchema.safeParse({
        type: "CHAT",
        meta: { timestamp: ts },
        payload: { text: "test" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta.timestamp).toBe(ts);
      }
    });

    it("should accept optional correlationId", () => {
      const ChatSchema = message("CHAT", { text: z.string() });

      const result = ChatSchema.safeParse({
        type: "CHAT",
        meta: { correlationId: "req-123" },
        payload: { text: "test" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta.correlationId).toBe("req-123");
      }
    });

    it("should allow empty meta object", () => {
      const ChatSchema = message("CHAT", { text: z.string() });

      const result = ChatSchema.safeParse({
        type: "CHAT",
        meta: {},
        payload: { text: "test" },
      });
      expect(result.success).toBe(true);
    });
  });
});
