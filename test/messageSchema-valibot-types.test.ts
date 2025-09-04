/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, test, expectTypeOf } from "bun:test";
import * as v from "valibot";
import { createMessageSchema } from "../valibot/schema";

describe("messageSchema Valibot type tests", () => {
  const { messageSchema } = createMessageSchema(v);

  test("should create valid Valibot schemas", () => {
    // Schema with no payload
    const PingSchema = messageSchema("PING");
    expectTypeOf(PingSchema).toHaveProperty("entries");

    // Schema with object payload
    const JoinRoomSchema = messageSchema("JOIN_ROOM", {
      roomId: v.string(),
      userId: v.optional(v.string()),
    });
    expectTypeOf(JoinRoomSchema).toHaveProperty("entries");
    expectTypeOf(JoinRoomSchema.entries).toHaveProperty("meta");
    expectTypeOf(JoinRoomSchema.entries).toHaveProperty("payload");

    // Schema with raw shape payload
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

    // Test that schemas can be used for validation
    expectTypeOf(TestSchema).toHaveProperty("entries");
    expectTypeOf(TestSchema.entries.meta).toHaveProperty("entries");

    // Meta should have the expected fields
    expectTypeOf(TestSchema.entries.meta.entries).toHaveProperty("clientId");
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

    // Extended meta should include custom fields
    expectTypeOf(CustomSchema.entries.meta.entries).toHaveProperty("roomId");
    expectTypeOf(CustomSchema.entries.meta.entries).toHaveProperty("priority");
  });
});
