// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expectTypeOf } from "bun:test";
import * as v from "valibot";
import {
  createValibotRouter,
  valibotValidator,
  createMessageSchema,
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
      const { messageSchema } = createMessageSchema(v);
      const schema = messageSchema("PING");
      expectTypeOf(validator.getMessageType).toBeFunction();
      expectTypeOf(validator.getMessageType(schema)).toBeString();
    });

    it("safeParse should validate and return normalized result", () => {
      const validator = valibotValidator();
      const { messageSchema } = createMessageSchema(v);
      const schema = messageSchema("PING", { text: v.string() });

      const result = validator.safeParse(schema, {
        type: "PING",
        meta: {},
        payload: { text: "hello" },
      });

      expectTypeOf(result).toHaveProperty("success");
      expectTypeOf(result.success).toBeBoolean();
    });
  });

  describe("createMessageSchema(v) factory", () => {
    it("should return factory with messageSchema function", () => {
      const factory = createMessageSchema(v);
      expectTypeOf(factory).toHaveProperty("messageSchema");
      expectTypeOf(factory.messageSchema).toBeFunction();
      expectTypeOf(factory).toHaveProperty("MessageMetadataSchema");
      expectTypeOf(factory).toHaveProperty("ErrorCode");
      expectTypeOf(factory).toHaveProperty("ErrorMessage");
      expectTypeOf(factory).toHaveProperty("createMessage");
    });
  });

  describe("Schema type inference - Type-Only", () => {
    it("should create schema with type and meta only", () => {
      const { messageSchema } = createMessageSchema(v);
      const PingSchema = messageSchema("PING");

      // Verify schema can parse a valid message
      const parsed = v.safeParse(PingSchema, { type: "PING", meta: {} });
      expectTypeOf(parsed.success).toBeBoolean();
    });

    it("should preserve message type literal", () => {
      const { messageSchema } = createMessageSchema(v);
      const PingSchema = messageSchema("PING");

      type ParsedPing = v.InferOutput<typeof PingSchema>;
      expectTypeOf<ParsedPing["type"]>().toEqualTypeOf<"PING">();
    });
  });

  describe("Schema type inference - With Payload", () => {
    it("should infer payload type correctly", () => {
      const { messageSchema } = createMessageSchema(v);
      const MessageSchema = messageSchema("MSG", {
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
      const { messageSchema } = createMessageSchema(v);
      const MessageSchema = messageSchema("MSG", { text: v.string() });

      type Context = MessageContext<typeof MessageSchema, unknown>;
      expectTypeOf<Context>().toHaveProperty("payload");
      expectTypeOf<Context["payload"]>().toEqualTypeOf<{ text: string }>();
    });

    it("no payload schema should not have payload property in context", () => {
      const { messageSchema } = createMessageSchema(v);
      const PingSchema = messageSchema("PING");

      type Context = MessageContext<typeof PingSchema, unknown>;
      // Should not have payload property
      type HasPayload = "payload" extends keyof Context ? true : false;
      expectTypeOf<HasPayload>().toEqualTypeOf<false>();
    });
  });

  describe("Schema type inference - With Extended Meta", () => {
    it("should infer extended meta fields", () => {
      const { messageSchema } = createMessageSchema(v);
      const RoomMessageSchema = messageSchema(
        "ROOM_MSG",
        { text: v.string() },
        { roomId: v.string() },
      );

      type Meta = InferMeta<typeof RoomMessageSchema>;
      expectTypeOf<Meta>().toEqualTypeOf<{ roomId: string }>();
    });

    it("should omit auto-injected timestamp and correlationId from InferMeta", () => {
      const { messageSchema } = createMessageSchema(v);
      const MessageSchema = messageSchema("MSG", undefined, {
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
      const { messageSchema } = createMessageSchema(v);
      const MessageSchema = messageSchema("MSG", undefined, {
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
      const { messageSchema } = createMessageSchema(v);
      const LoginSchema = messageSchema("LOGIN", {
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
      const { messageSchema } = createMessageSchema(v);
      const PingSchema = messageSchema("PING");

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
      const { messageSchema } = createMessageSchema(v);
      const MessageSchema = messageSchema(
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
      const router = createValibotRouter();
      const { messageSchema } = createMessageSchema(v);

      const LoginSchema = messageSchema("LOGIN", {
        username: v.string(),
      });

      router.onMessage(LoginSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGIN">();
        expectTypeOf(ctx.payload).toEqualTypeOf<{ username: string }>();
        expectTypeOf(ctx.meta).toMatchTypeOf<{
          timestamp?: number;
          correlationId?: string;
        }>();
      });
    });

    it("should type-check send function within handlers", () => {
      const router = createValibotRouter();
      const { messageSchema } = createMessageSchema(v);

      const RequestSchema = messageSchema("REQUEST", { id: v.number() });

      router.onMessage(RequestSchema, (ctx) => {
        // send should be type-safe
        expectTypeOf(ctx.send).toBeFunction();
      });
    });
  });

  describe("Error schema", () => {
    it("should provide pre-built error message schema", () => {
      const { ErrorMessage } = createMessageSchema(v);

      type ErrorMsg = v.InferOutput<typeof ErrorMessage>;
      expectTypeOf<ErrorMsg>().toHaveProperty("type");
      expectTypeOf<ErrorMsg["type"]>().toEqualTypeOf<"ERROR">();
      expectTypeOf<ErrorMsg>().toHaveProperty("payload");
      expectTypeOf<ErrorMsg["payload"]>().toHaveProperty("code");
    });
  });

  describe("Input validation with Valibot schemas", () => {
    it("should properly validate strings with minLength", () => {
      const { messageSchema } = createMessageSchema(v);
      const SchemaWithValidation = messageSchema("MSG", {
        username: v.pipe(v.string(), v.minLength(3)),
      });

      type Payload = InferPayload<typeof SchemaWithValidation>;
      expectTypeOf<Payload>().toEqualTypeOf<{ username: string }>();
    });

    it("should support optional fields", () => {
      const { messageSchema } = createMessageSchema(v);
      const SchemaWithOptional = messageSchema("MSG", {
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
      const { messageSchema } = createMessageSchema(v);
      const SchemaWithUnion = messageSchema("MSG", {
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
      const { messageSchema } = createMessageSchema(v);

      function createHandler<T extends { entries: Record<string, any> }>(
        schema: T,
      ) {
        return (ctx: MessageContext<T, unknown>) => {
          expectTypeOf(ctx.type).toBeDefined();
        };
      }

      const schema = messageSchema("TEST");
      const handler = createHandler(schema as any);
      expectTypeOf(handler).toBeFunction();
    });
  });

  describe("Type comparison with Zod", () => {
    it("should have feature parity with Zod types", () => {
      const { messageSchema } = createMessageSchema(v);

      // Both should support payload
      const MsgWithPayload = messageSchema("MSG", { text: v.string() });
      type PayloadMsg = InferPayload<typeof MsgWithPayload>;
      expectTypeOf<PayloadMsg>().toEqualTypeOf<{ text: string }>();

      // Both should support extended meta
      const MsgWithMeta = messageSchema("MSG2", undefined, {
        roomId: v.string(),
      });
      type ExtendedMeta = InferMeta<typeof MsgWithMeta>;
      expectTypeOf<ExtendedMeta>().toEqualTypeOf<{ roomId: string }>();

      // Both should support full message inference
      const FullMsg = messageSchema(
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
});
