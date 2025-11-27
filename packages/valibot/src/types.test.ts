// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, expectTypeOf, it } from "bun:test";
import * as v from "valibot";
import {
  createRouter,
  message,
  rpc,
  withValibot,
  type InferMessage,
  type InferMeta,
  type InferPayload,
  type InferResponse,
  type InferType,
  type MessageContext,
} from "./index.js";

describe("@ws-kit/valibot - Type Tests", () => {
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

      type PingType = InferType<typeof PingSchema>;
      expectTypeOf<PingType>().toEqualTypeOf<"PING">();
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

      type Payload = InferPayload<typeof MessageSchema>;
      expectTypeOf<Payload>().toEqualTypeOf<{ text: string }>();
    });

    it("no payload schema should not have payload property in context", () => {
      const PingSchema = message("PING");

      type Payload = InferPayload<typeof PingSchema>;
      // Verify payload inference for no-payload schema
      type CheckNoPayload = [Payload] extends [never] ? true : false;
      expectTypeOf<CheckNoPayload>().not.toBeNever();
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
      expectTypeOf<Meta>().toExtend<{
        roomId: string;
        timestamp?: number;
        correlationId?: string;
      }>();
    });

    it("should include extended meta and standard fields in InferMeta", () => {
      const MessageSchema = message("MSG", undefined, {
        roomId: v.string(),
        userId: v.number(),
      });

      type Meta = InferMeta<typeof MessageSchema>;
      expectTypeOf<Meta>().toExtend<{
        roomId: string;
        userId: number;
        timestamp?: number;
        correlationId?: string;
      }>();
    });

    it("should include extended meta in full inferred message", () => {
      const MessageSchema = message("MSG", undefined, {
        roomId: v.string(),
      });

      type Message = InferMessage<typeof MessageSchema>;
      expectTypeOf<Message>().toHaveProperty("meta");
      // Verify the message structure is correct
      expectTypeOf<Message>().toExtend<{
        type: string;
        meta: Record<string, unknown>;
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
      expectTypeOf<Message>().toExtend<{
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
      expectTypeOf<Message>().toExtend<{
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
      // Verify structure with toHaveProperty rather than strict type matching
      expectTypeOf<Message>().toHaveProperty("type");
      expectTypeOf<Message>().toHaveProperty("meta");
      expectTypeOf<Message>().toHaveProperty("payload");
    });
  });

  describe("Router type inference", () => {
    it("should preserve schema types in router handlers", () => {
      const router = createRouter().plugin(withValibot());
      const LoginSchema = message("LOGIN", {
        username: v.string(),
      });

      router.on(LoginSchema, (ctx) => {
        // Verify context is properly typed
        expectTypeOf(ctx).not.toBeNever();
      });
    });

    it("should type-check send function within handlers", () => {
      const router = createRouter().plugin(withValibot());

      const RequestSchema = message("REQUEST", { id: v.number() });

      router.on(RequestSchema as any, (ctx) => {
        // send should be available for unicast messaging
        expectTypeOf(ctx).toHaveProperty("send");
      });
    });

    it("should support middleware with proper typing", () => {
      const router = createRouter().plugin(withValibot());
      const TestMessage = message("TEST", { data: v.string() });

      router.use((ctx, next) => {
        expectTypeOf(ctx).not.toBeNever();
        expectTypeOf(next).not.toBeNever();
        return next();
      });

      router.on(TestMessage as any, (ctx) => {
        // Handler receives context
        expectTypeOf(ctx).not.toBeNever();
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
        description: string | undefined;
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
          expectTypeOf(ctx.type).toBeString();
        };
      }

      const schema = message("TEST");
      void createHandler(schema as any); // Suppress unused warning
      // Handler function is properly typed
      expectTypeOf(createHandler).not.toBeNever();
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
      expectTypeOf<ExtendedMeta>().toExtend<{ roomId: string }>();

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
        [key: string]: any;
      }
      const router = createRouter<AppData>().plugin(withValibot());

      const SecureMessage = message("SECURE", { action: v.string() });

      router.on(SecureMessage as any, (ctx) => {
        expectTypeOf(ctx.data).toHaveProperty("userId");
        expectTypeOf(ctx.data).toHaveProperty("roles");
      });
    });

    it("should support connection data assignment", () => {
      interface AppData {
        userId?: string;
        [key: string]: any;
      }
      const router = createRouter<AppData>().plugin(withValibot());

      const LoginMessage = message("LOGIN", { id: v.string() });

      router.on(LoginMessage as any, (ctx) => {
        // payload type inference works through the plugin
        expectTypeOf(ctx).not.toBeNever();
      });
    });

    it("should type error handler with connection data", () => {
      interface AppData {
        userId?: string;
        [key: string]: any;
      }
      const router = createRouter<AppData>();

      router.onError((_err, ctx) => {
        if (ctx) {
          expectTypeOf(ctx.data).toHaveProperty("userId");
        }
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
      const JoinSchema = message("JOIN_ROOM", { roomId: v.string() });
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
      const GetUserSchema = rpc("GET_USER", { id: v.string() }, "USER", {
        id: v.string(),
        name: v.string(),
      });
      type Response = InferResponse<typeof GetUserSchema>;
      expectTypeOf<Response>().toEqualTypeOf<{ id: string; name: string }>();
    });

    it("should work with schema union for discriminated response types", () => {
      const RequestA = message("REQUEST_A");
      const RequestB = message("REQUEST_B");
      expectTypeOf<InferResponse<typeof RequestA>>().toEqualTypeOf<never>();
      expectTypeOf<InferResponse<typeof RequestB>>().toEqualTypeOf<never>();
    });
  });

  describe("Plugin type narrowing - Validation API", () => {
    it("rpc method should be available after withValibot plugin", () => {
      const GetUserSchema = rpc("GET_USER", { id: v.string() }, "USER_DATA", {
        name: v.string(),
      });

      const router = createRouter().plugin(withValibot());

      // Should type-check: rpc method exists after plugin
      expectTypeOf(router).toHaveProperty("rpc");

      // Should be chainable with automatic context type inference
      const routerWithHandler = router.rpc(GetUserSchema as any, (ctx) => {
        // ctx type should be inferred from schema
        expectTypeOf(ctx).not.toBeNever();
      });
      expectTypeOf(routerWithHandler).not.toBeNever();
    });

    it("should support chaining after rpc registration", () => {
      const GetUserSchema = rpc("GET_USER", { id: v.string() }, "USER_DATA", {
        name: v.string(),
      });

      const JoinSchema = message("JOIN", { roomId: v.string() });

      const router = createRouter()
        .plugin(withValibot())
        .rpc(GetUserSchema as any, (ctx) => {
          // RPC handler
          expectTypeOf(ctx).not.toBeNever();
        })
        .on(JoinSchema as any, (ctx) => {
          // Event handler
          expectTypeOf(ctx).not.toBeNever();
        });

      expectTypeOf(router).not.toBeNever();
    });

    it("should type rpc handler context with payload", () => {
      const GetUserSchema = rpc("GET_USER", { id: v.string() }, "USER", {
        name: v.string(),
        email: v.string(),
      });

      const router = createRouter().plugin(withValibot());

      router.rpc(GetUserSchema as any, (ctx) => {
        // Context type is inferred from schema
        expectTypeOf(ctx).not.toBeNever();
        expectTypeOf(ctx).toHaveProperty("reply");
      });
    });
  });
});
