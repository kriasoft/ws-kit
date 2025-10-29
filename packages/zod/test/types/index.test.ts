// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expectTypeOf } from "bun:test";
import { z } from "zod";
import {
  createZodRouter,
  zodValidator,
  createMessageSchema,
  type InferMessage,
  type InferPayload,
  type InferMeta,
  type MessageContext,
} from "../../src/index.js";

describe("@ws-kit/zod - Type Tests", () => {
  describe("zodValidator() factory", () => {
    it("should return ValidatorAdapter type", () => {
      const validator = zodValidator();
      expectTypeOf(validator).toHaveProperty("getMessageType");
      expectTypeOf(validator).toHaveProperty("safeParse");
      expectTypeOf(validator).toHaveProperty("infer");
    });

    it("getMessageType should accept MessageSchemaType and return string", () => {
      const validator = zodValidator();
      const { messageSchema } = createMessageSchema(z);
      const schema = messageSchema("PING");
      expectTypeOf(validator.getMessageType).toBeFunction();
      expectTypeOf(validator.getMessageType(schema)).toBeString();
    });

    it("safeParse should validate and return normalized result", () => {
      const validator = zodValidator();
      const { messageSchema } = createMessageSchema(z);
      const schema = messageSchema("PING", { text: z.string() });

      const result = validator.safeParse(schema, {
        type: "PING",
        meta: {},
        payload: { text: "hello" },
      });

      expectTypeOf(result).toHaveProperty("success");
      expectTypeOf(result.success).toBeBoolean();
    });
  });

  describe("createMessageSchema(z) factory", () => {
    it("should return factory with messageSchema function", () => {
      const factory = createMessageSchema(z);
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
      const { messageSchema } = createMessageSchema(z);
      const PingSchema = messageSchema("PING");

      // Verify schema shape
      expectTypeOf(PingSchema.shape).toHaveProperty("type");
      expectTypeOf(PingSchema.shape).toHaveProperty("meta");
      expectTypeOf(PingSchema.shape.type.value).toBeString();
    });

    it("should preserve message type literal", () => {
      const { messageSchema } = createMessageSchema(z);
      const PingSchema = messageSchema("PING");

      type PingType = typeof PingSchema.shape.type.value;
      expectTypeOf<PingType>().toEqualTypeOf<"PING">();
    });
  });

  describe("Schema type inference - With Payload", () => {
    it("should infer payload type correctly", () => {
      const { messageSchema } = createMessageSchema(z);
      const MessageSchema = messageSchema("MSG", {
        id: z.number(),
        text: z.string(),
      });

      type Payload = InferPayload<typeof MessageSchema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        id: number;
        text: string;
      }>();
    });

    it("should include payload in context type", () => {
      const { messageSchema } = createMessageSchema(z);
      const MessageSchema = messageSchema("MSG", { text: z.string() });

      type Context = MessageContext<typeof MessageSchema, unknown>;
      expectTypeOf<Context>().toHaveProperty("payload");
      expectTypeOf<Context["payload"]>().toEqualTypeOf<{ text: string }>();
    });

    it("no payload schema should not have payload property in context", () => {
      const { messageSchema } = createMessageSchema(z);
      const PingSchema = messageSchema("PING");

      type Context = MessageContext<typeof PingSchema, unknown>;
      // Should not have payload property
      type HasPayload = "payload" extends keyof Context ? true : false;
      expectTypeOf<HasPayload>().toEqualTypeOf<false>();
    });
  });

  describe("Schema type inference - With Extended Meta", () => {
    it("should infer extended meta fields", () => {
      const { messageSchema } = createMessageSchema(z);
      const RoomMessageSchema = messageSchema(
        "ROOM_MSG",
        { text: z.string() },
        { roomId: z.string() },
      );

      type Meta = InferMeta<typeof RoomMessageSchema>;
      expectTypeOf<Meta>().toEqualTypeOf<{ roomId: string }>();
    });

    it("should omit auto-injected timestamp and correlationId from InferMeta", () => {
      const { messageSchema } = createMessageSchema(z);
      const MessageSchema = messageSchema("MSG", undefined, {
        roomId: z.string(),
        userId: z.number(),
      });

      type Meta = InferMeta<typeof MessageSchema>;
      // Should have custom fields but not timestamp/correlationId
      expectTypeOf<Meta>().toEqualTypeOf<{
        roomId: string;
        userId: number;
      }>();
    });

    it("should include extended meta in full inferred message", () => {
      const { messageSchema } = createMessageSchema(z);
      const MessageSchema = messageSchema("MSG", undefined, {
        roomId: z.string(),
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

  describe("Discriminated Union Support", () => {
    it("should support z.discriminatedUnion with multiple schemas", () => {
      const { messageSchema } = createMessageSchema(z);
      const PingSchema = messageSchema("PING");
      const PongSchema = messageSchema("PONG");
      const MessageSchema = messageSchema("MSG", { text: z.string() });

      // Create discriminated union
      const MessageUnion = z.discriminatedUnion("type", [
        PingSchema,
        PongSchema,
        MessageSchema,
      ]);

      // Verify union type includes all schemas
      type UnionType = z.infer<typeof MessageUnion>;
      expectTypeOf<UnionType>().toMatchTypeOf<
        | { type: "PING"; meta: any }
        | { type: "PONG"; meta: any }
        | { type: "MSG"; meta: any; payload: any }
      >();
    });

    it("should allow proper narrowing with discriminated unions", () => {
      const { messageSchema } = createMessageSchema(z);
      const PingSchema = messageSchema("PING");
      const MessageSchema = messageSchema("MSG", { text: z.string() });

      const union = z.discriminatedUnion("type", [PingSchema, MessageSchema]);

      type UnionMsg = z.infer<typeof union>;

      const handler = (msg: UnionMsg) => {
        if (msg.type === "PING") {
          // After narrowing, should not have payload
          type NarrowedType = typeof msg;
          expectTypeOf<NarrowedType>().toMatchTypeOf<{
            type: "PING";
            meta: any;
          }>();
        } else if (msg.type === "MSG") {
          // After narrowing, should have payload
          type NarrowedType = typeof msg;
          expectTypeOf<NarrowedType>().toMatchTypeOf<{
            type: "MSG";
            meta: any;
            payload: any;
          }>();
        }
      };

      expectTypeOf(handler).toBeFunction();
    });
  });

  describe("Type Inference - Full Message", () => {
    it("should infer complete message with payload", () => {
      const { messageSchema } = createMessageSchema(z);
      const LoginSchema = messageSchema("LOGIN", {
        username: z.string(),
        password: z.string(),
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
      const { messageSchema } = createMessageSchema(z);
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
      const { messageSchema } = createMessageSchema(z);
      const MessageSchema = messageSchema(
        "CHAT",
        { text: z.string() },
        { roomId: z.string() },
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
      const router = createZodRouter();
      const { messageSchema } = createMessageSchema(z);

      const LoginSchema = messageSchema("LOGIN", {
        username: z.string(),
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
      const router = createZodRouter();
      const { messageSchema } = createMessageSchema(z);

      const RequestSchema = messageSchema("REQUEST", { id: z.number() });
      const ResponseSchema = messageSchema("RESPONSE", { result: z.string() });

      router.onMessage(RequestSchema, (ctx) => {
        // send should be type-safe
        expectTypeOf(ctx.send).toBeFunction();
      });
    });
  });

  describe("Error schema", () => {
    it("should provide pre-built error message schema", () => {
      const { ErrorMessage, ErrorCode } = createMessageSchema(z);

      type ErrorMsg = z.infer<typeof ErrorMessage>;
      expectTypeOf<ErrorMsg>().toHaveProperty("type");
      expectTypeOf<ErrorMsg["type"]>().toEqualTypeOf<"ERROR">();
      expectTypeOf<ErrorMsg>().toHaveProperty("payload");
      expectTypeOf<ErrorMsg["payload"]>().toHaveProperty("code");
      expectTypeOf<ErrorMsg["payload"]>().toHaveProperty("message");
    });
  });

  describe("Generic type parameters", () => {
    it("should support generic message handlers", () => {
      const { messageSchema } = createMessageSchema(z);

      function createHandler<T extends { type: z.ZodLiteral<string> }>(
        schema: T,
      ) {
        return (ctx: MessageContext<T, unknown>) => {
          expectTypeOf(ctx.type).toBeString();
        };
      }

      const schema = messageSchema("TEST");
      const handler = createHandler(schema);
      expectTypeOf(handler).toBeFunction();
    });
  });
});
