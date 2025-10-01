/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, test, expectTypeOf } from "bun:test";
import { z } from "zod";
import { createMessageSchema } from "../zod/schema";
import type { MessageContext, WebSocketData } from "../zod/types";

describe("MessageContext type tests (Zod)", () => {
  const { messageSchema } = createMessageSchema(z);

  type DataType = WebSocketData<{ userId: string }>;

  test("should include payload for schemas with payload", () => {
    const WithPayload = messageSchema("WITH_PAYLOAD", {
      value: z.string(),
      count: z.number().optional(),
    });
    void WithPayload;

    type Ctx = MessageContext<typeof WithPayload, DataType>;

    // Should have payload property
    expectTypeOf<Ctx>().toHaveProperty("payload");
    expectTypeOf<Ctx["payload"]>().toHaveProperty("value");
    expectTypeOf<Ctx["payload"]["value"]>().toBeString();
    expectTypeOf<Ctx["payload"]["count"]>().toEqualTypeOf<number | undefined>();
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
    expectTypeOf<Ctx["meta"]>().toHaveProperty("clientId");
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

    // Should have both base and extended meta properties
    expectTypeOf<Ctx["meta"]>().toHaveProperty("clientId");
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

    // Handler with payload - should have payload
    const handlerWith = (
      ctx: MessageContext<typeof MessageWithPayload, DataType>,
    ) => {
      expectTypeOf(ctx.payload.id).toBeNumber();
    };

    // Handler without payload - should NOT have payload
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

    expectTypeOf<Ctx["payload"]["nested"]["array"]>().toEqualTypeOf<string[]>();
    expectTypeOf<Ctx["payload"]["nested"]["optional"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<Ctx["payload"]["nested"]["union"]>().toEqualTypeOf<
      string | number
    >();
  });
});
