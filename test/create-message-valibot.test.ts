/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, it, expect } from "bun:test";
import * as v from "valibot";
import { messageSchema, createMessage } from "../valibot";

describe("createMessage - Valibot", () => {
  it("should create a message without payload", () => {
    const PingSchema = messageSchema("PING");
    const message = createMessage(PingSchema, undefined);

    expect(message.success).toBe(true);
    if (message.success) {
      expect(message.output).toEqual({
        type: "PING",
        meta: {},
      });
    }
  });

  it("should create a message with payload", () => {
    const EchoSchema = messageSchema("ECHO", v.object({ text: v.string() }));
    const message = createMessage(EchoSchema, { text: "Hello World" });

    expect(message.success).toBe(true);
    if (message.success) {
      expect(message.output).toEqual({
        type: "ECHO",
        meta: {},
        payload: { text: "Hello World" },
      });
    }
  });

  it("should create a message with custom metadata", () => {
    const RequestSchema = messageSchema(
      "REQUEST",
      v.object({ data: v.string() }),
    );
    const message = createMessage(
      RequestSchema,
      { data: "test" },
      { correlationId: "123", timestamp: 1234567890 },
    );

    expect(message.success).toBe(true);
    if (message.success) {
      expect(message.output).toEqual({
        type: "REQUEST",
        meta: {
          correlationId: "123",
          timestamp: 1234567890,
        },
        payload: { data: "test" },
      });
    }
  });

  it("should validate payload types", () => {
    const TypedSchema = messageSchema(
      "TYPED",
      v.object({
        count: v.number(),
        name: v.string(),
      }),
    );

    // Valid payload
    const validMessage = createMessage(TypedSchema, {
      count: 42,
      name: "test",
    });
    expect(validMessage.success).toBe(true);

    // Invalid payload - wrong types
    const invalidMessage = createMessage(TypedSchema, {
      // @ts-expect-error Testing invalid type
      count: "not a number",
      name: "test",
    });
    expect(invalidMessage.success).toBe(false);
  });

  it("should handle complex payload schemas", () => {
    const ComplexSchema = messageSchema(
      "COMPLEX",
      v.object({
        user: v.object({
          id: v.string(),
          email: v.pipe(v.string(), v.email()),
          roles: v.array(v.string()),
        }),
        settings: v.optional(v.record(v.string(), v.any())),
      }),
    );

    const message = createMessage(ComplexSchema, {
      user: {
        id: "123",
        email: "test@example.com",
        roles: ["admin", "user"],
      },
      settings: {
        theme: "dark",
        notifications: true,
      },
    });

    expect(message.success).toBe(true);
    if (message.success) {
      expect((message.output as any).payload).toEqual({
        user: {
          id: "123",
          email: "test@example.com",
          roles: ["admin", "user"],
        },
        settings: {
          theme: "dark",
          notifications: true,
        },
      });
    }
  });

  it("should handle array payload schemas", () => {
    const ArraySchema = messageSchema("ARRAY", v.array(v.string()));
    const message = createMessage(ArraySchema, ["item1", "item2", "item3"]);

    expect(message.success).toBe(true);
    if (message.success) {
      expect(message.output).toEqual({
        type: "ARRAY",
        meta: {},
        payload: ["item1", "item2", "item3"],
      });
    }
  });

  it("should handle custom metadata schemas", () => {
    const CustomMetaSchema = messageSchema(
      "CUSTOM_META",
      v.object({ text: v.string() }),
      v.object({
        userId: v.string(),
        sessionId: v.pipe(v.string(), v.uuid()),
      }),
    );

    const message = createMessage(
      CustomMetaSchema,
      { text: "Hello" },
      {
        userId: "user123",
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        correlationId: "req123",
      },
    );

    expect(message.success).toBe(true);
    if (message.success) {
      expect((message.output as any).meta).toEqual({
        userId: "user123",
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        correlationId: "req123",
      });
    }
  });

  it("should fail validation for invalid messages", () => {
    const StrictSchema = messageSchema(
      "STRICT",
      v.object({
        required: v.string(),
        optional: v.optional(v.number()),
      }),
    );

    // Missing required field
    const missingRequired = createMessage(StrictSchema, {
      optional: 123,
    } as Parameters<typeof createMessage<typeof StrictSchema>>[1]);
    expect(missingRequired.success).toBe(false);

    // Wrong type for required field
    const wrongType = createMessage(StrictSchema, {
      // @ts-expect-error Testing wrong type
      required: 123,
      optional: 456,
    });
    expect(wrongType.success).toBe(false);
  });

  it("should work with union types", () => {
    const UnionSchema = messageSchema(
      "UNION",
      v.union([
        v.object({ type: v.literal("text"), content: v.string() }),
        v.object({ type: v.literal("number"), value: v.number() }),
      ]),
    );

    const textMessage = createMessage(UnionSchema, {
      type: "text",
      content: "Hello",
    });
    expect(textMessage.success).toBe(true);

    const numberMessage = createMessage(UnionSchema, {
      type: "number",
      value: 42,
    });
    expect(numberMessage.success).toBe(true);

    const invalidMessage = createMessage(UnionSchema, {
      type: "invalid",
      data: "test",
    } as unknown as Parameters<typeof createMessage<typeof UnionSchema>>[1]);
    expect(invalidMessage.success).toBe(false);
  });
});
