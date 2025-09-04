/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, test, expectTypeOf } from "bun:test";
import { z } from "zod";
import { createMessageSchema } from "../zod/schema";

describe("messageSchema type tests", () => {
  const { messageSchema } = createMessageSchema(z);

  test("should create schemas with proper structure", () => {
    // Basic schema creation
    const PingSchema = messageSchema("PING");
    expectTypeOf(PingSchema).toHaveProperty("shape");
    expectTypeOf(PingSchema.shape).toHaveProperty("type");
    expectTypeOf(PingSchema.shape).toHaveProperty("meta");

    // Schema with payload
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

    // Meta field should not be any - this was the main bug
    expectTypeOf(TestSchema.shape.meta).not.toBeAny();

    // Meta should be a ZodObject
    expectTypeOf(TestSchema.shape.meta).toHaveProperty("shape");

    // Test that meta has the expected properties
    expectTypeOf(TestSchema.shape.meta.shape).toHaveProperty("clientId");
    expectTypeOf(TestSchema.shape.meta.shape).toHaveProperty("timestamp");
    expectTypeOf(TestSchema.shape.meta.shape).toHaveProperty("correlationId");
  });

  test("should support runtime validation", () => {
    const TestSchema = messageSchema("TEST", {
      content: z.string(),
    });

    // Should be parseable
    expectTypeOf(TestSchema.parse).toBeFunction();
    expectTypeOf(TestSchema.safeParse).toBeFunction();

    // Meta should be parseable
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

    // Extended meta should not be any
    expectTypeOf(CustomSchema.shape.meta).not.toBeAny();

    // Should have extended properties
    expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("roomId");
    expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("priority");

    // Should still have base properties
    expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("clientId");
    expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("timestamp");
    expectTypeOf(CustomSchema.shape.meta.shape).toHaveProperty("correlationId");
  });

  test("should work with discriminated unions", () => {
    const PingSchema = messageSchema("PING");
    const PongSchema = messageSchema("PONG", { reply: z.string() });

    // Should be able to create unions
    const MessageUnion = z.discriminatedUnion("type", [PingSchema, PongSchema]);
    expectTypeOf(MessageUnion.parse).toBeFunction();
  });
});
