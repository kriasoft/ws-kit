// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createMessageSchema } from "../../zod/schema";

const { messageSchema } = createMessageSchema(z);

describe("messageSchema", () => {
  it("should create a basic message schema without payload", () => {
    const schema = messageSchema("BASIC");

    // Should validate a message with just type and meta
    const validResult = schema.safeParse({
      type: "BASIC",
      meta: {},
    });

    expect(validResult.success).toBe(true);

    // Should reject messages with wrong type
    const wrongTypeResult = schema.safeParse({
      type: "WRONG_TYPE",
      meta: {},
    });

    expect(wrongTypeResult.success).toBe(false);
  });

  it("should create a message schema with object payload", () => {
    const schema = messageSchema("WITH_PAYLOAD", {
      name: z.string(),
      count: z.number(),
    });

    // Should validate a message with correct payload
    const validResult = schema.safeParse({
      type: "WITH_PAYLOAD",
      meta: {},
      payload: {
        name: "Test Name",
        count: 42,
      },
    });

    expect(validResult.success).toBe(true);

    // Should reject messages with invalid payload properties
    const invalidPayloadResult = schema.safeParse({
      type: "WITH_PAYLOAD",
      meta: {},
      payload: {
        name: "Test Name",
        count: "not a number", // Invalid type for count
      },
    });

    expect(invalidPayloadResult.success).toBe(false);

    // Should reject messages with missing required payload properties
    const missingPropertyResult = schema.safeParse({
      type: "WITH_PAYLOAD",
      meta: {},
      payload: {
        name: "Test Name",
        // Missing count property
      },
    });

    expect(missingPropertyResult.success).toBe(false);
  });

  it("should create a message schema with plain object payload (improved DX)", () => {
    const schema = messageSchema("WITH_PAYLOAD", {
      name: z.string(),
      count: z.number(),
    });

    // Should validate a message with correct payload
    const validResult = schema.safeParse({
      type: "WITH_PAYLOAD",
      meta: {},
      payload: {
        name: "Test Name",
        count: 42,
      },
    });

    expect(validResult.success).toBe(true);

    // Should reject messages with invalid payload properties
    const invalidPayloadResult = schema.safeParse({
      type: "WITH_PAYLOAD",
      meta: {},
      payload: {
        name: "Test Name",
        count: "not a number", // Invalid type for count
      },
    });

    expect(invalidPayloadResult.success).toBe(false);
  });

  it("should create a message schema with ZodType payload", () => {
    const schema = messageSchema("ARRAY_PAYLOAD", {
      items: z.array(z.string()),
    });

    // Should validate a message with correct payload
    const validResult = schema.safeParse({
      type: "ARRAY_PAYLOAD",
      meta: {},
      payload: { items: ["item1", "item2", "item3"] },
    });

    expect(validResult.success).toBe(true);

    // Should reject messages with invalid payload
    const invalidPayloadResult = schema.safeParse({
      type: "ARRAY_PAYLOAD",
      meta: {},
      payload: { items: [1, 2, 3] }, // Numbers instead of strings
    });

    expect(invalidPayloadResult.success).toBe(false);
  });

  it("should create a message schema with custom metadata", () => {
    const customMeta = {
      userId: z.string().uuid({ version: "v7" }),
      role: z.enum(["admin", "user", "guest"]),
    };

    const schema = messageSchema("CUSTOM_META", undefined, customMeta);

    // Should validate a message with correct custom metadata
    const validResult = schema.safeParse({
      type: "CUSTOM_META",
      meta: {
        userId: "0198716a-72b2-769f-9762-1ef5a3625dc2", // Valid UUID v7
        role: "admin",
      },
    });

    expect(validResult.success).toBe(true);

    // Should reject messages with invalid custom metadata
    const invalidMetaResult = schema.safeParse({
      type: "CUSTOM_META",
      meta: {
        userId: "not-a-uuid",
        role: "admin",
      },
    });

    expect(invalidMetaResult.success).toBe(false);

    // Should reject messages with invalid role
    const invalidRoleResult = schema.safeParse({
      type: "CUSTOM_META",
      meta: {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        role: "superadmin", // Not in the enum
      },
    });

    expect(invalidRoleResult.success).toBe(false);
  });

  it("should create a message schema with both payload and custom metadata", () => {
    const schema = messageSchema(
      "FULL_SCHEMA",
      {
        action: z.string(),
        data: z.record(z.string(), z.any()),
      },
      {
        sessionId: z.string(),
      },
    );

    // Should validate a complete message
    const validResult = schema.safeParse({
      type: "FULL_SCHEMA",
      meta: {
        sessionId: "session-456",
      },
      payload: {
        action: "save",
        data: { key: "value" },
      },
    });

    expect(validResult.success).toBe(true);

    // Should reject messages with missing custom meta
    const missingMetaResult = schema.safeParse({
      type: "FULL_SCHEMA",
      meta: {
        // Missing sessionId
      },
      payload: {
        action: "save",
        data: { key: "value" },
      },
    });

    expect(missingMetaResult.success).toBe(false);

    // Should reject messages with incomplete payload
    const incompletePayloadResult = schema.safeParse({
      type: "FULL_SCHEMA",
      meta: {
        sessionId: "session-456",
      },
      payload: {
        action: "save",
        // Missing data
      },
    });

    expect(incompletePayloadResult.success).toBe(false);
  });
});
