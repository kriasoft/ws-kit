// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, expectTypeOf } from "bun:test";
import {
  z,
  message,
  createRouter,
  type InferType,
  type InferPayload,
  type InferMeta,
  type InferMessage,
  type InferResponse,
} from "../../src/index.js";

describe("@ws-kit/zod - Type Tests", () => {
  describe("message() helper function", () => {
    it("should create message schema with message() helper", () => {
      const schema = message("PING");
      expect(schema).toBeDefined();
      expectTypeOf(schema).not.toBeNever();
    });

    it("should support payload schema parameter", () => {
      const schema = message("MSG", { text: z.string() });
      expect(schema).toBeDefined();
      expectTypeOf(schema).not.toBeNever();
    });

    it("should support extended meta parameter", () => {
      const schema = message(
        "ROOM_MSG",
        { text: z.string() },
        { roomId: z.string() },
      );
      expect(schema).toBeDefined();
      expectTypeOf(schema).not.toBeNever();
    });
  });

  describe("Schema type inference - Type-Only", () => {
    it("should create schema with type and meta only", () => {
      const PingSchema = message("PING");

      // Verify schema shape
      expectTypeOf(PingSchema.shape).toHaveProperty("type");
      expectTypeOf(PingSchema.shape).toHaveProperty("meta");
      expectTypeOf(PingSchema.shape.type.value).toBeString();
    });

    it("should preserve message type literal", () => {
      const PingSchema = message("PING");

      type PingType = typeof PingSchema.shape.type.value;
      expectTypeOf<PingType>().toEqualTypeOf<"PING">();
    });
  });

  describe("Schema type inference - With Payload", () => {
    it("should infer payload type correctly", () => {
      const MessageSchema = message("MSG", {
        id: z.number(),
        text: z.string(),
      });

      type Payload = InferPayload<typeof MessageSchema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        id: number;
        text: string;
      }>();
    });

    it("payload type should be extractable via InferPayload", () => {
      const MessageSchema = message("MSG", { text: z.string() });

      type Payload = InferPayload<typeof MessageSchema>;
      expectTypeOf<Payload>().toEqualTypeOf<{ text: string }>();
    });

    it("no payload schema should return never", () => {
      const PingSchema = message("PING");

      type Payload = InferPayload<typeof PingSchema>;
      expectTypeOf<Payload>().toEqualTypeOf<never>();
    });
  });

  describe("Schema type inference - With Extended Meta", () => {
    it("should infer extended meta fields", () => {
      const RoomMessageSchema = message(
        "ROOM_MSG",
        { text: z.string() },
        { roomId: z.string() },
      );

      type Meta = InferMeta<typeof RoomMessageSchema>;
      expectTypeOf<Meta>().toEqualTypeOf<{ roomId: string }>();
    });

    it("should omit auto-injected timestamp and correlationId from InferMeta", () => {
      const MessageSchema = message("MSG", undefined, {
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
      const MessageSchema = message("MSG", undefined, {
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
      const PingSchema = message("PING");
      const PongSchema = message("PONG");
      const MessageSchema = message("MSG", { text: z.string() });

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
      const PingSchema = message("PING");
      const MessageSchema = message("MSG", { text: z.string() });

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
      const LoginSchema = message("LOGIN", {
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
      const router = createRouter();
      const LoginSchema = message("LOGIN", {
        username: z.string(),
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

      const RequestSchema = message("REQUEST", { id: z.number() });
      const ResponseSchema = message("RESPONSE", { result: z.string() });

      router.on(RequestSchema, (ctx) => {
        // send should be type-safe
        expectTypeOf(ctx.send).toBeFunction();
      });
    });

    it("should support middleware with proper typing", () => {
      const router = createRouter();
      const TestMessage = message("TEST", { data: z.string() });

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

  describe("Generic type parameters", () => {
    it("should support inferring types from generic schemas", () => {
      function getMessageType<T extends { shape: { type: any } }>(schema: T) {
        return schema.shape.type.value;
      }

      const schema = message("TEST");
      const type = getMessageType(schema);
      expectTypeOf(type).toBeString();
    });
  });

  describe("createRouter with connection data", () => {
    it("should type connection data through handlers", () => {
      interface AppData {
        clientId: string;
        userId?: string;
        roles?: string[];
      }
      const router = createRouter<AppData>();

      const SecureMessage = message("SECURE", { action: z.string() });

      router.on(SecureMessage, (ctx) => {
        expectTypeOf(ctx.ws.data).toHaveProperty("userId");
        expectTypeOf(ctx.ws.data).toHaveProperty("roles");
      });
    });

    it("should support connection data assignment", () => {
      interface AppData {
        clientId: string;
        userId?: string;
      }
      const router = createRouter<AppData>();

      const LoginMessage = message("LOGIN", { id: z.string() });

      router.on(LoginMessage, (ctx) => {
        ctx.assignData({ userId: ctx.payload.id });
      });
    });
  });

  describe("Type Inference - InferType", () => {
    it("should extract message type literal", () => {
      const PingSchema = message("PING");
      type PingType = InferType<typeof PingSchema>;
      expectTypeOf<PingType>().toEqualTypeOf<"PING">();
    });

    it("should work with payload schemas", () => {
      const JoinSchema = message("JOIN_ROOM", { roomId: z.string() });
      type JoinType = InferType<typeof JoinSchema>;
      expectTypeOf<JoinType>().toEqualTypeOf<"JOIN_ROOM">();
    });

    it("should preserve literal string type for discriminated unions", () => {
      const A = message("TYPE_A");
      const B = message("TYPE_B");
      type TypeA = InferType<typeof A>;
      type TypeB = InferType<typeof B>;
      expectTypeOf<TypeA>().toEqualTypeOf<"TYPE_A">();
      expectTypeOf<TypeB>().toEqualTypeOf<"TYPE_B">();
    });
  });

  describe("Type Inference - InferResponse", () => {
    it("should return never when no response defined", () => {
      const PingSchema = message("PING");
      type Response = InferResponse<typeof PingSchema>;
      expectTypeOf<Response>().toEqualTypeOf<never>();
    });

    it("should extract response type from RPC schema", () => {
      const GetUserSchema = message("GET_USER", {
        id: z.string(),
      });
      // Note: message() doesn't support response syntax in this test,
      // so we construct the type manually to verify InferResponse works
      type MockRpcSchema = typeof GetUserSchema & {
        readonly response: z.ZodType<{ id: string; name: string }>;
      };
      type Response = InferResponse<MockRpcSchema>;
      expectTypeOf<Response>().toEqualTypeOf<{ id: string; name: string }>();
    });

    it("should work with schema union for discriminated response types", () => {
      const RequestA = message("REQUEST_A");
      const RequestB = message("REQUEST_B");
      expectTypeOf<InferResponse<typeof RequestA>>().toEqualTypeOf<never>();
      expectTypeOf<InferResponse<typeof RequestB>>().toEqualTypeOf<never>();
    });
  });
});
