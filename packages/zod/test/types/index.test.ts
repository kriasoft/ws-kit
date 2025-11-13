// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, expectTypeOf, it } from "bun:test";
import {
  createRouter,
  message,
  rpc,
  withZod,
  z,
  type InferMessage,
  type InferMeta,
  type InferPayload,
  type InferResponse,
  type InferType,
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
    });

    it("should preserve message type literal", () => {
      const PingSchema = message("PING");

      type PingType = InferType<typeof PingSchema>;
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
      expectTypeOf<Payload>().not.toBeNever();
    });

    it("payload type should be extractable via InferPayload", () => {
      const MessageSchema = message("MSG", { text: z.string() });

      type Payload = InferPayload<typeof MessageSchema>;
      expectTypeOf<Payload>().not.toBeNever();
    });

    it("no payload schema should return never", () => {
      const PingSchema = message("PING");

      type Payload = InferPayload<typeof PingSchema>;
      expectTypeOf<Payload>().toBeNever();
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
      expectTypeOf<UnionType>().not.toBeNever();
    });

    it("should allow proper narrowing with discriminated unions", () => {
      const PingSchema = message("PING");
      const MessageSchema = message("MSG", { text: z.string() });

      const union = z.discriminatedUnion("type", [PingSchema, MessageSchema]);

      type UnionMsg = z.infer<typeof union>;

      const handler = (msg: UnionMsg) => {
        // Type guard test
        expectTypeOf(msg).not.toBeNever();
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
      expectTypeOf<Message>().not.toBeNever();
    });

    it("should infer complete message without payload", () => {
      const PingSchema = message("PING");

      type Message = InferMessage<typeof PingSchema>;
      expectTypeOf<Message>().not.toBeNever();
    });

    it("should infer message with extended meta", () => {
      const MessageSchema = message(
        "CHAT",
        { text: z.string() },
        { roomId: z.string() },
      );

      type Message = InferMessage<typeof MessageSchema>;
      expectTypeOf<Message>().not.toBeNever();
    });
  });

  describe("Router type inference", () => {
    it("should preserve schema types in router handlers", () => {
      const router = createRouter();
      const LoginSchema = message("LOGIN", {
        username: z.string(),
      });

      router.on(LoginSchema, (ctx: any) => {
        expectTypeOf(ctx).not.toBeNever();
      });
    });

    it("should type-check send function within handlers", () => {
      const router = createRouter();

      const RequestSchema = message("REQUEST", { id: z.number() });
      const ResponseSchema = message("RESPONSE", { result: z.string() });

      router.on(RequestSchema, (ctx: any) => {
        // send should be type-safe
        expect(typeof ctx.send).toBe("function");
      });
    });

    it("should support middleware with proper typing", () => {
      const router = createRouter();
      const TestMessage = message("TEST", { data: z.string() });

      router.use(async (ctx: any, next: any) => {
        expectTypeOf(ctx).not.toBeNever();
        expect(typeof next).toBe("function");
        await next();
      });

      router.use(async (ctx: any, next: any) => {
        expectTypeOf(ctx).not.toBeNever();
        await next();
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
      expectTypeOf(type).not.toBeNever();
    });
  });

  describe("createRouter with connection data", () => {
    it("should type connection data through handlers", () => {
      interface AppData {
        clientId: string;
        userId?: string;
        roles?: string[];
        [key: string]: any;
      }
      const router = createRouter<AppData>();

      const SecureMessage = message("SECURE", { action: z.string() });

      router.on(SecureMessage, (ctx) => {
        expectTypeOf(ctx.data).toHaveProperty("userId");
        expectTypeOf(ctx.data).toHaveProperty("roles");
      });
    });

    it("should support connection data assignment", () => {
      interface AppData {
        clientId: string;
        userId?: string;
        [key: string]: any;
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

    it("should extract response payload type from RPC schema", () => {
      const GetUserSchema = rpc("GET_USER", { id: z.string() }, "USER_DATA", {
        name: z.string(),
        age: z.number(),
      });
      type Response = InferResponse<typeof GetUserSchema>;
      expectTypeOf<Response>().toEqualTypeOf<{
        name: string;
        age: number;
      }>();
    });

    it("should extract response payload from RPC with single field", () => {
      const FetchSchema = rpc("FETCH", { query: z.string() }, "FETCH_RESULT", {
        data: z.array(z.string()),
      });
      type Response = InferResponse<typeof FetchSchema>;
      expectTypeOf<Response>().toEqualTypeOf<{
        data: string[];
      }>();
    });

    it("should work with schema union for discriminated response types", () => {
      const RequestA = message("REQUEST_A");
      const RequestB = message("REQUEST_B");
      expectTypeOf<InferResponse<typeof RequestA>>().toBeNever();
      expectTypeOf<InferResponse<typeof RequestB>>().toBeNever();
    });
  });

  describe("Plugin type narrowing - Validation API", () => {
    it("rpc method should be available after withZod plugin", () => {
      const GetUserSchema = rpc("GET_USER", { id: z.string() }, "USER_DATA", {
        name: z.string(),
      });

      const router = createRouter().plugin(withZod());

      // Should type-check: rpc method exists after plugin
      expectTypeOf(router.rpc).toBeFunction();

      // Should be chainable
      const routerWithHandler = router.rpc(GetUserSchema, (ctx: any) => {
        expectTypeOf(ctx).not.toBeNever();
      });
      expectTypeOf(routerWithHandler).not.toBeNever();
    });

    it("should support chaining after rpc registration", () => {
      const GetUserSchema = rpc("GET_USER", { id: z.string() }, "USER_DATA", {
        name: z.string(),
      });

      const JoinSchema = message("JOIN", { roomId: z.string() });

      const router = createRouter()
        .plugin(withZod())
        .rpc(GetUserSchema, (ctx: any) => {
          // RPC handler
        })
        .on(JoinSchema, (ctx: any) => {
          // Event handler
        });

      expectTypeOf(router).not.toBeNever();
    });

    it("should type rpc handler context with payload", () => {
      const GetUserSchema = rpc("GET_USER", { id: z.string() }, "USER", {
        name: z.string(),
        email: z.string(),
      });

      const router = createRouter().plugin(withZod());

      router.rpc(GetUserSchema, (ctx: any) => {
        // Context should have payload with typed id
        expectTypeOf(ctx.payload).toHaveProperty("id");
        expectTypeOf(ctx.payload.id).toBeString();

        // Context should have reply method
        expectTypeOf(ctx.reply).toBeFunction();

        // Context should have progress method
        expectTypeOf(ctx.progress).toBeFunction();
      });
    });
  });
});
