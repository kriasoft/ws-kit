// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { createMessageSchema } from "../../packages/zod/src/schema";
import type {
  MessageContext,
  WebSocketData,
} from "../../packages/zod/src/types";

describe("Zod type tests", () => {
  const { messageSchema } = createMessageSchema(z);

  describe("messageSchema types", () => {
    test("should create schemas with proper structure", () => {
      const PingSchema = messageSchema("PING");
      expectTypeOf(PingSchema).toHaveProperty("shape");
      expectTypeOf(PingSchema.shape).toHaveProperty("type");
      expectTypeOf(PingSchema.shape).toHaveProperty("meta");

      const TestSchema = messageSchema("TEST", {
        content: z.string(),
        count: z.number().optional(),
      });
      expectTypeOf(TestSchema.shape).toHaveProperty("payload");
    });

    test("should correctly type meta field access", () => {
      const TestSchema = messageSchema("TEST", {
        content: z.string(),
        count: z.number().optional(),
      });

      expectTypeOf(TestSchema.shape.meta).not.toBeAny();
      expectTypeOf(TestSchema.shape.meta).toHaveProperty("shape");
      expectTypeOf(TestSchema.shape.meta.shape).toHaveProperty("timestamp");
      expectTypeOf(TestSchema.shape.meta.shape).toHaveProperty("correlationId");
    });

    test("should support runtime validation", () => {
      const TestSchema = messageSchema("TEST", {
        content: z.string(),
      });

      expectTypeOf(TestSchema.parse).toBeFunction();
      expectTypeOf(TestSchema.safeParse).toBeFunction();
      expectTypeOf(TestSchema.shape.meta.parse).toBeFunction();
    });

    test("should handle custom meta extensions", () => {
      const CustomSchema = messageSchema(
        "CUSTOM",
        { data: z.string() },
        {
          roomId: z.string(),
          priority: z.number(),
        },
      );

      expectTypeOf(CustomSchema.shape.meta).not.toBeAny();
      expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("roomId");
      expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("priority");
      expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("timestamp");
      expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty(
        "correlationId",
      );
    });

    test("should work with discriminated unions", () => {
      const PingSchema = messageSchema("PING");
      const PongSchema = messageSchema("PONG", { reply: z.string() });

      const MessageUnion = z.discriminatedUnion("type", [
        PingSchema,
        PongSchema,
      ]);
      expectTypeOf(MessageUnion.parse).toBeFunction();
    });
  });

  describe("MessageContext types", () => {
    type DataType = WebSocketData<{ userId: string }>;

    test("should include payload for schemas with payload", () => {
      const WithPayload = messageSchema("WITH_PAYLOAD", {
        value: z.string(),
        count: z.number().optional(),
      });
      void WithPayload;

      type Ctx = MessageContext<typeof WithPayload, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("payload");
      expectTypeOf<Ctx["payload"]>().toHaveProperty("value");
      expectTypeOf<Ctx["payload"]["value"]>().toBeString();
      expectTypeOf<Ctx["payload"]["count"]>().toEqualTypeOf<
        number | undefined
      >();
    });

    test("should include type property from schema", () => {
      const TestMessage = messageSchema("TEST_TYPE", {
        data: z.string(),
      });
      void TestMessage;

      type Ctx = MessageContext<typeof TestMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("type");
      expectTypeOf<Ctx["type"]>().toEqualTypeOf<"TEST_TYPE">();
    });

    test("should include meta property with correct type", () => {
      const TestMessage = messageSchema("TEST_META");
      void TestMessage;

      type Ctx = MessageContext<typeof TestMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("meta");
      expectTypeOf<Ctx["meta"]>().toHaveProperty("timestamp");
      expectTypeOf<Ctx["meta"]>().toHaveProperty("correlationId");
    });

    test("should include extended meta properties", () => {
      const CustomMessage = messageSchema(
        "CUSTOM",
        { data: z.string() },
        { roomId: z.string(), priority: z.number() },
      );
      void CustomMessage;

      type Ctx = MessageContext<typeof CustomMessage, DataType>;

      expectTypeOf<Ctx["meta"]>().toHaveProperty("roomId");
      expectTypeOf<Ctx["meta"]>().toHaveProperty("priority");
      expectTypeOf<Ctx["meta"]["roomId"]>().toBeString();
      expectTypeOf<Ctx["meta"]["priority"]>().toBeNumber();
    });

    test("should include ws property with correct data type", () => {
      const TestMessage = messageSchema("TEST_WS");
      void TestMessage;

      type Ctx = MessageContext<typeof TestMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("ws");
      expectTypeOf<Ctx["ws"]["data"]>().toHaveProperty("clientId");
      expectTypeOf<Ctx["ws"]["data"]>().toHaveProperty("userId");
      expectTypeOf<Ctx["ws"]["data"]["userId"]>().toBeString();
    });

    test("should include send function", () => {
      const TestMessage = messageSchema("TEST_SEND");
      void TestMessage;

      type Ctx = MessageContext<typeof TestMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("send");
      expectTypeOf<Ctx["send"]>().toBeFunction();
    });

    test("handler should enforce correct context type", () => {
      const MessageWithPayload = messageSchema("WITH", {
        id: z.number(),
      });
      const MessageWithoutPayload = messageSchema("WITHOUT");
      void MessageWithPayload;
      void MessageWithoutPayload;

      const handlerWith = (
        ctx: MessageContext<typeof MessageWithPayload, DataType>,
      ) => {
        expectTypeOf(ctx.payload.id).toBeNumber();
      };

      const handlerWithout = (
        ctx: MessageContext<typeof MessageWithoutPayload, DataType>,
      ) => {
        // @ts-expect-error - payload should not exist
        expectTypeOf(ctx.payload).toBeAny();
      };

      expectTypeOf(handlerWith).toBeFunction();
      expectTypeOf(handlerWithout).toBeFunction();
    });

    test("complex payload types should be preserved", () => {
      const ComplexMessage = messageSchema("COMPLEX", {
        nested: z.object({
          array: z.array(z.string()),
          optional: z.number().optional(),
          union: z.union([z.string(), z.number()]),
        }),
      });
      void ComplexMessage;

      type Ctx = MessageContext<typeof ComplexMessage, DataType>;

      expectTypeOf<Ctx["payload"]["nested"]["array"]>().toEqualTypeOf<
        string[]
      >();
      expectTypeOf<Ctx["payload"]["nested"]["optional"]>().toEqualTypeOf<
        number | undefined
      >();
      expectTypeOf<Ctx["payload"]["nested"]["union"]>().toEqualTypeOf<
        string | number
      >();
    });
  });
});
