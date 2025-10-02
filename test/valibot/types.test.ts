// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expectTypeOf, test } from "bun:test";
import * as v from "valibot";
import { createMessageSchema } from "../../valibot/schema";
import type { MessageContext, WebSocketData } from "../../valibot/types";

describe("Valibot type tests", () => {
  const { messageSchema } = createMessageSchema(v);

  describe("messageSchema types", () => {
    test("should create valid Valibot schemas", () => {
      const PingSchema = messageSchema("PING");
      expectTypeOf(PingSchema).toHaveProperty("entries");

      const JoinRoomSchema = messageSchema("JOIN_ROOM", {
        roomId: v.string(),
        userId: v.optional(v.string()),
      });
      expectTypeOf(JoinRoomSchema).toHaveProperty("entries");
      expectTypeOf(JoinRoomSchema.entries).toHaveProperty("meta");
      expectTypeOf(JoinRoomSchema.entries).toHaveProperty("payload");

      const SendMessageSchema = messageSchema("SEND_MESSAGE", {
        text: v.string(),
        priority: v.number(),
      });
      expectTypeOf(SendMessageSchema).toHaveProperty("entries");
      expectTypeOf(SendMessageSchema.entries).toHaveProperty("payload");
    });

    test("should handle runtime validation correctly", () => {
      const TestSchema = messageSchema("TEST", {
        content: v.string(),
        count: v.optional(v.number()),
      });

      expectTypeOf(TestSchema).toHaveProperty("entries");
      expectTypeOf(TestSchema.entries.meta).toHaveProperty("entries");
      expectTypeOf(TestSchema.entries.meta.entries).toHaveProperty("timestamp");
      expectTypeOf(TestSchema.entries.meta.entries).toHaveProperty(
        "correlationId",
      );
    });

    test("should support custom meta extensions", () => {
      const CustomSchema = messageSchema(
        "CUSTOM",
        { data: v.string() },
        {
          roomId: v.string(),
          priority: v.number(),
        },
      );

      expectTypeOf(CustomSchema).toHaveProperty("entries");
      expectTypeOf(CustomSchema.entries).toHaveProperty("meta");
      expectTypeOf(CustomSchema.entries.meta).toHaveProperty("entries");
      expectTypeOf(CustomSchema.entries.meta.entries).toHaveProperty("roomId");
      expectTypeOf(CustomSchema.entries.meta.entries).toHaveProperty(
        "priority",
      );
    });
  });

  describe("MessageContext types", () => {
    type DataType = WebSocketData<{ userId: string }>;

    const WithPayload = messageSchema("WITH_PAYLOAD", {
      value: v.string(),
      count: v.optional(v.number()),
    });
    void WithPayload;

    const TestMessage = messageSchema("TEST_TYPE", {
      data: v.string(),
    });
    void TestMessage;

    const TestMetaMessage = messageSchema("TEST_META");
    void TestMetaMessage;

    const CustomMessage = messageSchema(
      "CUSTOM",
      { data: v.string() },
      { roomId: v.string(), priority: v.number() },
    );
    void CustomMessage;

    const TestWsMessage = messageSchema("TEST_WS");
    void TestWsMessage;

    const TestSendMessage = messageSchema("TEST_SEND");
    void TestSendMessage;

    const MessageWithPayload = messageSchema("WITH", {
      id: v.number(),
    });
    void MessageWithPayload;

    const MessageWithoutPayload = messageSchema("WITHOUT");
    void MessageWithoutPayload;

    const ComplexMessage = messageSchema("COMPLEX", {
      nested: v.object({
        array: v.array(v.string()),
        optional: v.optional(v.number()),
        union: v.union([v.string(), v.number()]),
      }),
    });
    void ComplexMessage;

    test("should include payload for schemas with payload", () => {
      type Ctx = MessageContext<typeof WithPayload, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("payload");
      expectTypeOf<Ctx["payload"]>().toHaveProperty("value");
      expectTypeOf<Ctx["payload"]["value"]>().toBeString();
      expectTypeOf<Ctx["payload"]["count"]>().toEqualTypeOf<
        number | undefined
      >();
    });

    test("should include type property from schema", () => {
      type Ctx = MessageContext<typeof TestMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("type");
      expectTypeOf<Ctx["type"]>().toEqualTypeOf<"TEST_TYPE">();
    });

    test("should include meta property with correct type", () => {
      type Ctx = MessageContext<typeof TestMetaMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("meta");
      expectTypeOf<Ctx["meta"]>().toHaveProperty("timestamp");
      expectTypeOf<Ctx["meta"]>().toHaveProperty("correlationId");
    });

    test("should include extended meta properties", () => {
      type Ctx = MessageContext<typeof CustomMessage, DataType>;

      expectTypeOf<Ctx["meta"]>().toHaveProperty("roomId");
      expectTypeOf<Ctx["meta"]>().toHaveProperty("priority");
      expectTypeOf<Ctx["meta"]["roomId"]>().toBeString();
      expectTypeOf<Ctx["meta"]["priority"]>().toBeNumber();
    });

    test("should include ws property with correct data type", () => {
      type Ctx = MessageContext<typeof TestWsMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("ws");
      expectTypeOf<Ctx["ws"]["data"]>().toHaveProperty("clientId");
      expectTypeOf<Ctx["ws"]["data"]>().toHaveProperty("userId");
      expectTypeOf<Ctx["ws"]["data"]["userId"]>().toBeString();
    });

    test("should include send function", () => {
      type Ctx = MessageContext<typeof TestSendMessage, DataType>;

      expectTypeOf<Ctx>().toHaveProperty("send");
      expectTypeOf<Ctx["send"]>().toBeFunction();
    });

    test("handler should enforce correct context type", () => {
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
