/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, it, expect } from "bun:test";
import * as v from "valibot";
import { createMessageSchema } from "../valibot";

const { messageSchema, createMessage } = createMessageSchema(v);

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
    const EchoSchema = messageSchema("ECHO", { text: v.string() });
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
    const RequestSchema = messageSchema("REQUEST", { data: v.string() });
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
    const TypedSchema = messageSchema("TYPED", {
      count: v.number(),
      name: v.string(),
    });

    // Valid payload
    const validMessage = createMessage(TypedSchema, {
      count: 42,
      name: "test",
    });
    expect(validMessage.success).toBe(true);

    // Invalid payload - wrong types
    const invalidMessage = createMessage(TypedSchema, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count: "not a number" as any, // Intentionally wrong type
      name: "test",
    });
    expect(invalidMessage.success).toBe(false);
  });

  it("should handle complex payload schemas", () => {
    const ComplexSchema = messageSchema("COMPLEX", {
      user: v.object({
        id: v.string(),
        email: v.pipe(v.string(), v.email()),
        roles: v.array(v.string()),
      }),
      settings: v.optional(v.record(v.string(), v.any())),
    });

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
      expect((message.output as { payload: unknown }).payload).toEqual({
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
    const ArraySchema = messageSchema("ARRAY", {
      items: v.array(v.string()),
    });
    const message = createMessage(ArraySchema, {
      items: ["item1", "item2", "item3"],
    });

    expect(message.success).toBe(true);
    if (message.success) {
      expect(message.output).toEqual({
        type: "ARRAY",
        meta: {},
        payload: { items: ["item1", "item2", "item3"] },
      });
    }
  });

  it("should handle custom metadata schemas", () => {
    const CustomMetaSchema = messageSchema(
      "CUSTOM_META",
      { text: v.string() },
      {
        userId: v.string(),
        sessionId: v.pipe(v.string(), v.uuid()),
      },
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
      expect((message.output as { meta: unknown }).meta).toEqual({
        userId: "user123",
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        correlationId: "req123",
      });
    }
  });

  it("should fail validation for invalid messages", () => {
    const StrictSchema = messageSchema("STRICT", {
      required: v.string(),
      optional: v.optional(v.number()),
    });

    // Missing required field
    const missingRequired = createMessage(StrictSchema, {
      optional: 123,
    });
    expect(missingRequired.success).toBe(false);

    // Wrong type for required field
    const wrongType = createMessage(StrictSchema, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      required: 123 as any, // Intentionally wrong type
      optional: 456,
    });
    expect(wrongType.success).toBe(false);
  });

  it("should work with union types", () => {
    const UnionSchema = messageSchema("UNION", {
      data: v.union([
        v.object({ type: v.literal("text"), content: v.string() }),
        v.object({ type: v.literal("number"), value: v.number() }),
      ]),
    });

    const textMessage = createMessage(UnionSchema, {
      data: {
        type: "text",
        content: "Hello",
      },
    });
    expect(textMessage.success).toBe(true);

    const numberMessage = createMessage(UnionSchema, {
      data: {
        type: "number",
        value: 42,
      },
    });
    expect(numberMessage.success).toBe(true);

    const invalidMessage = createMessage(UnionSchema, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: "invalid" as any, // Intentionally invalid union type
    });
    expect(invalidMessage.success).toBe(false);
  });
});
