/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  createMessage,
  ErrorCode,
  ErrorMessage,
  messageSchema,
} from "./schema";

describe("messageSchema", () => {
  describe("discriminated union support", () => {
    it("should work with z.discriminatedUnion", () => {
      const PingSchema = messageSchema("PING");
      const PongSchema = messageSchema("PONG");
      const EchoSchema = messageSchema("ECHO", { text: z.string() });

      // This should not throw
      const MessageSchema = z.discriminatedUnion("type", [
        PingSchema,
        PongSchema,
        EchoSchema,
      ]);

      // Test parsing with discriminated union
      const pingResult = MessageSchema.safeParse({
        type: "PING",
        meta: {},
      });
      expect(pingResult.success).toBe(true);

      const echoResult = MessageSchema.safeParse({
        type: "ECHO",
        meta: {},
        payload: { text: "hello" },
      });
      expect(echoResult.success).toBe(true);

      const invalidResult = MessageSchema.safeParse({
        type: "UNKNOWN",
        meta: {},
      });
      expect(invalidResult.success).toBe(false);
    });

    it("should infer types correctly in discriminated union", () => {
      const LoginSchema = messageSchema("LOGIN", {
        username: z.string(),
        password: z.string(),
      });
      const LogoutSchema = messageSchema("LOGOUT");
      const SendMessageSchema = messageSchema("SEND_MESSAGE", {
        text: z.string(),
        channel: z.string().optional(),
      });

      const MessageUnion = z.discriminatedUnion("type", [
        LoginSchema,
        LogoutSchema,
        SendMessageSchema,
      ]);

      type MessageType = z.infer<typeof MessageUnion>;

      // Type tests - these would fail at compile time if types were wrong
      const testMessages: MessageType[] = [
        {
          type: "LOGIN",
          meta: {},
          payload: { username: "user", password: "pass" },
        },
        {
          type: "LOGOUT",
          meta: { clientId: "123" },
        },
        {
          type: "SEND_MESSAGE",
          meta: { timestamp: Date.now() },
          payload: { text: "Hello", channel: "general" },
        },
      ];

      testMessages.forEach((msg) => {
        const result = MessageUnion.safeParse(msg);
        expect(result.success).toBe(true);
      });
    });

    it("should support nested discriminated unions", () => {
      // Auth messages
      const LoginSchema = messageSchema("AUTH.LOGIN", {
        username: z.string(),
        password: z.string(),
      });
      const LogoutSchema = messageSchema("AUTH.LOGOUT");

      const AuthUnion = z.discriminatedUnion("type", [
        LoginSchema,
        LogoutSchema,
      ]);

      // Chat messages
      const SendSchema = messageSchema("CHAT.SEND", {
        text: z.string(),
      });
      const JoinSchema = messageSchema("CHAT.JOIN", {
        roomId: z.string(),
      });

      const ChatUnion = z.discriminatedUnion("type", [SendSchema, JoinSchema]);

      // Combined union
      const AllMessages = z.union([AuthUnion, ChatUnion]);

      const testCases = [
        {
          type: "AUTH.LOGIN",
          meta: {},
          payload: { username: "test", password: "test" },
        },
        {
          type: "CHAT.SEND",
          meta: {},
          payload: { text: "Hello!" },
        },
      ];

      testCases.forEach((testCase) => {
        const result = AllMessages.safeParse(testCase);
        expect(result.success).toBe(true);
      });
    });
  });

  describe("basic functionality", () => {
    it("should create a message schema without payload", () => {
      const schema = messageSchema("TEST");
      const result = schema.safeParse({
        type: "TEST",
        meta: {},
      });
      expect(result.success).toBe(true);
    });

    it("should create a message schema with object payload", () => {
      const schema = messageSchema("TEST", {
        text: z.string(),
        count: z.number(),
      });
      const result = schema.safeParse({
        type: "TEST",
        meta: {},
        payload: { text: "hello", count: 42 },
      });
      expect(result.success).toBe(true);
    });

    it("should create a message schema with primitive payload", () => {
      const schema = messageSchema("TEST", z.string());
      const result = schema.safeParse({
        type: "TEST",
        meta: {},
        payload: "hello",
      });
      expect(result.success).toBe(true);
    });

    it("should validate metadata fields", () => {
      const schema = messageSchema("TEST");
      const result = schema.safeParse({
        type: "TEST",
        meta: {
          clientId: "123",
          timestamp: Date.now(),
          correlationId: "abc",
        },
      });
      expect(result.success).toBe(true);
    });

    it("should extend metadata", () => {
      const schema = messageSchema(
        "TEST",
        undefined,
        z.object({
          userId: z.string(),
          sessionId: z.string(),
        }),
      );
      const result = schema.safeParse({
        type: "TEST",
        meta: {
          userId: "user123",
          sessionId: "session456",
          clientId: "client789",
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("ErrorMessage", () => {
    it("should validate error messages", () => {
      const result = ErrorMessage.safeParse({
        type: "ERROR",
        meta: {},
        payload: {
          code: "VALIDATION_FAILED",
          message: "Invalid input",
        },
      });
      expect(result.success).toBe(true);
    });

    it("should validate all error codes", () => {
      const codes: ErrorCode[] = [
        "INVALID_MESSAGE_FORMAT",
        "VALIDATION_FAILED",
        "UNSUPPORTED_MESSAGE_TYPE",
        "AUTHENTICATION_FAILED",
        "AUTHORIZATION_FAILED",
        "RESOURCE_NOT_FOUND",
        "RATE_LIMIT_EXCEEDED",
        "INTERNAL_SERVER_ERROR",
      ];

      codes.forEach((code) => {
        const result = ErrorCode.safeParse(code);
        expect(result.success).toBe(true);
      });
    });
  });

  describe("createMessage", () => {
    it("should create messages without payload", () => {
      const schema = messageSchema("PING");
      const result = createMessage(schema, undefined);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("PING");
        expect(result.data.meta).toEqual({});
      }
    });

    it("should create messages with payload", () => {
      const schema = messageSchema("ECHO", { text: z.string() });
      const result = createMessage(schema, { text: "hello" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("ECHO");
        expect(result.data.payload).toEqual({ text: "hello" });
      }
    });

    it("should create messages with custom metadata", () => {
      const schema = messageSchema("TEST");
      const result = createMessage(schema, undefined, {
        correlationId: "123",
        timestamp: 1000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta.correlationId).toBe("123");
        expect(result.data.meta.timestamp).toBe(1000);
      }
    });

    it("should validate payload", () => {
      const schema = messageSchema("TEST", { num: z.number() });
      // @ts-expect-error Testing validation of invalid type
      const result = createMessage(schema, { num: "not a number" });
      expect(result.success).toBe(false);
    });
  });
});
