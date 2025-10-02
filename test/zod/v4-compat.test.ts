// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createMessageSchema } from "../../zod/schema";

const { messageSchema } = createMessageSchema(z);

describe("Zod v4 Compatibility", () => {
  it("should accept concrete Zod types in payload", () => {
    // Test case 1: z.string() directly
    const StringMessage = messageSchema("STRING_TEST", {
      field: z.string(),
    });

    expect(StringMessage).toBeDefined();

    // Test case 2: z.enum() directly
    const EnumMessage = messageSchema("ENUM_TEST", {
      status: z.enum(["active", "inactive"]),
    });

    expect(EnumMessage).toBeDefined();
  });

  it("should work with discriminatedUnion", () => {
    const JoinMessage = messageSchema("JOIN", {
      room: z.string(),
    });

    const LeaveMessage = messageSchema("LEAVE", {
      room: z.string(),
    });

    const SendMessage = messageSchema("SEND", {
      room: z.string(),
      text: z.string(),
    });

    // This should work with Zod v4's discriminatedUnion
    const Message = z.discriminatedUnion("type", [
      JoinMessage,
      LeaveMessage,
      SendMessage,
    ]);

    // Test type inference
    const parsed = Message.safeParse({
      type: "JOIN",
      meta: {},
      payload: { room: "general" },
    });

    expect(parsed.success).toBe(true);

    if (parsed.success) {
      // Type should be inferred correctly
      expect(parsed.data.type).toBe("JOIN");
    }
  });

  it("should handle complex nested schemas", () => {
    const ComplexMessage = messageSchema("COMPLEX", {
      user: z.object({
        id: z.string(),
        email: z.email(),
        profile: z.object({
          name: z.string(),
          age: z.number().int().min(0),
        }),
      }),
      permissions: z.array(z.enum(["read", "write", "admin"])),
    });

    const validData = {
      type: "COMPLEX",
      meta: {},
      payload: {
        user: {
          id: "123",
          email: "test@example.com",
          profile: {
            name: "John",
            age: 30,
          },
        },
        permissions: ["read", "write"],
      },
    };

    const result = ComplexMessage.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should support Zod v4 transforms", () => {
    const TransformMessage = messageSchema("TRANSFORM", {
      date: z
        .string()
        .datetime()
        .transform((s) => new Date(s)),
      number: z.string().transform((s) => parseInt(s, 10)),
    });

    const result = TransformMessage.safeParse({
      type: "TRANSFORM",
      meta: {},
      payload: {
        date: "2024-01-01T00:00:00Z",
        number: "42",
      },
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.payload.date instanceof Date).toBe(true);
      expect(result.data.payload.number).toBe(42);
    }
  });

  it("should support Zod v4 refinements", () => {
    const RefinedMessage = messageSchema("REFINED", {
      password: z
        .string()
        .min(8)
        .refine((val) => /[A-Z]/.test(val), {
          message: "Password must contain an uppercase letter",
        }),
    });

    const validResult = RefinedMessage.safeParse({
      type: "REFINED",
      meta: {},
      payload: { password: "Password123" },
    });

    expect(validResult.success).toBe(true);

    const invalidResult = RefinedMessage.safeParse({
      type: "REFINED",
      meta: {},
      payload: { password: "password123" },
    });

    expect(invalidResult.success).toBe(false);
  });
});
