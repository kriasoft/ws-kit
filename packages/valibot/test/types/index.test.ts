// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, expectTypeOf } from "bun:test";
import * as v from "valibot";
import {
  message,
  createRouter,
  valibotValidator,
  type InferMessage,
  type InferPayload,
  type InferMeta,
  type MessageContext,
} from "../../src/index.js";

describe("@ws-kit/valibot - Type Tests", () => {
  describe("valibotValidator() factory", () => {
    it("should return ValidatorAdapter type", () => {
      const validator = valibotValidator();
      expectTypeOf(validator).toHaveProperty("getMessageType");
      expectTypeOf(validator).toHaveProperty("safeParse");
      expectTypeOf(validator).toHaveProperty("infer");
    });

    it("getMessageType should accept MessageSchemaType and return string", () => {
      const validator = valibotValidator();
      const schema = message("PING");
      expectTypeOf(validator.getMessageType).toBeFunction();
      expectTypeOf(validator.getMessageType(schema)).toBeString();
    });

    it("safeParse should validate and return normalized result", () => {
      const validator = valibotValidator();
      const schema = message("PING", { text: v.string() });

      const result = validator.safeParse(schema, {
        type: "PING",
        meta: {},
        payload: { text: "hello" },
      });

      expectTypeOf(result).toHaveProperty("success");
      expectTypeOf(result.success).toBeBoolean();
    });
  });

  describe("message() helper function", () => {
    it("should create message schema with message() helper", () => {
      const schema = message("PING");
      expect(schema).toBeDefined();
      expectTypeOf(schema).not.toBeNever();
    });

    it("should support payload schema parameter", () => {
      const schema = message("MSG", { text: v.string() });
      expect(schema).toBeDefined();
      expectTypeOf(schema).not.toBeNever();
    });

    it("should support extended meta parameter", () => {
      const schema = message(
        "ROOM_MSG",
        { text: v.string() },
        { roomId: v.string() },
      );
      expect(schema).toBeDefined();
      expectTypeOf(schema).not.toBeNever();
    });
  });

  describe("Schema type inference - Type-Only", () => {
    it("should create schema with type and meta only", () => {
      const PingSchema = message("PING");

      // Verify schema can parse a valid message
      const parsed = v.safeParse(PingSchema, { type: "PING", meta: {} });
      expectTypeOf(parsed.success).toBeBoolean();
    });

    it("should preserve message type literal", () => {
      const PingSchema = message("PING");

      type ParsedPing = v.InferOutput<typeof PingSchema>;
      expectTypeOf<ParsedPing["type"]>().toEqualTypeOf<"PING">();
    });
  });

  describe("Schema type inference - With Payload", () => {
    it("should infer payload type correctly", () => {
      const MessageSchema = message("MSG", {
        id: v.number(),
        text: v.string(),
      });

      type Payload = InferPayload<typeof MessageSchema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        id: number;
        text: string;
      }>();
    });

    it("should include payload in context type", () => {
      const MessageSchema = message("MSG", { text: v.string() });

      type Context = MessageContext<typeof MessageSchema, unknown>;
      expectTypeOf<Context>().toHaveProperty("payload");
      expectTypeOf<Context["payload"]>().toEqualTypeOf<{ text: string }>();
    });

    it("no payload schema should not have payload property in context", () => {
      const PingSchema = message("PING");

      type Context = MessageContext<typeof PingSchema, unknown>;
      // Should not have payload property
      type HasPayload = "payload" extends keyof Context ? true : false;
      expectTypeOf<HasPayload>().toEqualTypeOf<false>();
    });
  });

  describe("Schema type inference - With Extended Meta", () => {
    it("should infer extended meta fields", () => {
      const RoomMessageSchema = message(
        "ROOM_MSG",
        { text: v.string() },
        { roomId: v.string() },
      );

      type Meta = InferMeta<typeof RoomMessageSchema>;
      expectTypeOf<Meta>().toEqualTypeOf<{ roomId: string }>();
    });

    it("should omit auto-injected timestamp and correlationId from InferMeta", () => {
      const MessageSchema = message("MSG", undefined, {
        roomId: v.string(),
        userId: v.number(),
      });

      type Meta = InferMeta<typeof MessageSchema>;
      // Should have custom fields but not timestamp/correlationId
      expectTypeOf<Meta>().toEqualTypeOf<{
        roomId: string;
        userId: number;
      }>();
    });

    it("should include extended meta in full inferred message", () => {
      const MessageSchema = message("MSG", undefined, {
        roomId: v.string(),
      });

      type Message = InferMessage<typeof MessageSchema>;
      expectTypeOf<Message>().toHaveProperty("meta");
      expectTypeOf<Message["meta"]>().toMatchTypeOf<{
        roomId: string;
        timestamp?: number;
        correlationId?: string;
      }>();
    });
  });

  describe("Type Inference - Full Message", () => {
    it("should infer complete message with payload", () => {
      const LoginSchema = message("LOGIN", {
        username: v.string(),
        password: v.string(),
      });

      type Message = InferMessage<typeof LoginSchema>;
      expectTypeOf<Message>().toMatchTypeOf<{
        type: "LOGIN";
        meta: {
          timestamp?: number;
          correlationId?: string;
        };
        payload: {
          username: string;
          password: string;
        };
      }>();
    });

    it("should infer complete message without payload", () => {
      const PingSchema = message("PING");

      type Message = InferMessage<typeof PingSchema>;
      expectTypeOf<Message>().toMatchTypeOf<{
        type: "PING";
        meta: {
          timestamp?: number;
          correlationId?: string;
        };
      }>();
    });

    it("should infer message with extended meta", () => {
      const MessageSchema = message(
        "CHAT",
        { text: v.string() },
        { roomId: v.string() },
      );

      type Message = InferMessage<typeof MessageSchema>;
      expectTypeOf<Message>().toMatchTypeOf<{
        type: "CHAT";
        meta: {
          roomId: string;
          timestamp?: number;
          correlationId?: string;
        };
        payload: {
          text: string;
        };
      }>();
    });
  });

  describe("Router type inference", () => {
    it("should preserve schema types in router handlers", () => {
      const router = createRouter();
      const LoginSchema = message("LOGIN", {
        username: v.string(),
      });

      router.on(LoginSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGIN">();
        expectTypeOf(ctx.payload).toEqualTypeOf<{ username: string }>();
        expectTypeOf(ctx.meta).toMatchTypeOf<{
          timestamp?: number;
          correlationId?: string;
        }>();
      });
    });

    it("should type-check send function within handlers", () => {
      const router = createRouter();

      const RequestSchema = message("REQUEST", { id: v.number() });

      router.on(RequestSchema, (ctx) => {
        // send should be type-safe
        expectTypeOf(ctx.send).toBeFunction();
      });
    });

    it("should support middleware with proper typing", () => {
      const router = createRouter();
      const TestMessage = message("TEST", { data: v.string() });

      router.use((ctx, next) => {
        expectTypeOf(ctx).toBeDefined();
        expectTypeOf(next).toBeFunction();
        return next();
      });

      router.use(TestMessage, (ctx, next) => {
        expectTypeOf(ctx.payload).toEqualTypeOf<{ data: string }>();
        return next();
      });
    });
  });

  describe("Input validation with Valibot schemas", () => {
    it("should properly validate strings with minLength", () => {
      const SchemaWithValidation = message("MSG", {
        username: v.pipe(v.string(), v.minLength(3)),
      });

      type Payload = InferPayload<typeof SchemaWithValidation>;
      expectTypeOf<Payload>().toEqualTypeOf<{ username: string }>();
    });

    it("should support optional fields", () => {
      const SchemaWithOptional = message("MSG", {
        text: v.string(),
        description: v.optional(v.string()),
      });

      type Payload = InferPayload<typeof SchemaWithOptional>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        text: string;
        description?: string;
      }>();
    });

    it("should support union types", () => {
      const SchemaWithUnion = message("MSG", {
        value: v.union([v.string(), v.number()]),
      });

      type Payload = InferPayload<typeof SchemaWithUnion>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        value: string | number;
      }>();
    });
  });

  describe("Generic type parameters", () => {
    it("should support generic message handlers", () => {
      function createHandler<T extends { entries?: Record<string, any> }>(
        schema: T,
      ) {
        return (ctx: MessageContext<T, unknown>) => {
          expectTypeOf(ctx.type).toBeDefined();
        };
      }

      const schema = message("TEST");
      const handler = createHandler(schema as any);
      expectTypeOf(handler).toBeFunction();
    });
  });

  describe("Type comparison with Zod", () => {
    it("should have feature parity with Zod types", () => {
      // Both should support payload
      const MsgWithPayload = message("MSG", { text: v.string() });
      type PayloadMsg = InferPayload<typeof MsgWithPayload>;
      expectTypeOf<PayloadMsg>().toEqualTypeOf<{ text: string }>();

      // Both should support extended meta
      const MsgWithMeta = message("MSG2", undefined, {
        roomId: v.string(),
      });
      type ExtendedMeta = InferMeta<typeof MsgWithMeta>;
      expectTypeOf<ExtendedMeta>().toEqualTypeOf<{ roomId: string }>();

      // Both should support full message inference
      const FullMsg = message(
        "FULL",
        { id: v.number() },
        { userId: v.string() },
      );
      type Full = InferMessage<typeof FullMsg>;
      expectTypeOf<Full>().toHaveProperty("type");
      expectTypeOf<Full>().toHaveProperty("payload");
      expectTypeOf<Full>().toHaveProperty("meta");
    });
  });

  describe("createRouter with connection data", () => {
    it("should type connection data through handlers", () => {
      interface AppData {
        userId?: string;
        roles?: string[];
      }
      const router = createRouter<AppData>();

      const SecureMessage = message("SECURE", { action: v.string() });

      router.on(SecureMessage, (ctx) => {
        expectTypeOf(ctx.ws.data).toHaveProperty("userId");
        expectTypeOf(ctx.ws.data).toHaveProperty("roles");
      });
    });

    it("should support connection data assignment", () => {
      interface AppData {
        userId?: string;
      }
      const router = createRouter<AppData>();

      const LoginMessage = message("LOGIN", { id: v.string() });

      router.on(LoginMessage, (ctx) => {
        ctx.assignData({ userId: ctx.payload.id });
      });
    });

    it("should type connection data in lifecycle callbacks", () => {
      interface AppData {
        userId?: string;
      }
      const router = createRouter<AppData>();

      router.onOpen((ctx) => {
        expectTypeOf(ctx.ws.data).toHaveProperty("userId");
      });

      router.onClose((ctx) => {
        expectTypeOf(ctx.ws.data).toHaveProperty("userId");
      });
    });
  });
});
