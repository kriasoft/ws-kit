// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Schema Detection Test
 *
 * Verifies that message() correctly detects and handles both:
 * 1. Pre-built Zod schema objects (z.object(...))
 * 2. Raw shape objects ({ field: z.type() })
 */

import { describe, it, expect } from "bun:test";
import { z, message } from "@ws-kit/zod";

describe("Schema Detection", () => {
  describe("Pre-built Zod schema objects", () => {
    it("should accept a pre-built z.object() schema", () => {
      const payloadSchema = z.object({
        userId: z.string(),
        action: z.enum(["create", "update", "delete"]),
      });

      const UserAction = message("USER_ACTION", payloadSchema);

      const result = UserAction.safeParse({
        type: "USER_ACTION",
        meta: {},
        payload: { userId: "123", action: "create" },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload).toEqual({
          userId: "123",
          action: "create",
        });
      }
    });

    it("should validate pre-built schema correctly", () => {
      const payloadSchema = z.object({
        email: z.string().email(),
      });

      const EmailMessage = message("EMAIL", payloadSchema);

      const invalidResult = EmailMessage.safeParse({
        type: "EMAIL",
        meta: {},
        payload: { email: "not-an-email" },
      });

      expect(invalidResult.success).toBe(false);
    });

    it("should handle z.object().strict() schemas", () => {
      const payloadSchema = z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .strict();

      const StrictMessage = message("STRICT", payloadSchema);

      const result = StrictMessage.safeParse({
        type: "STRICT",
        meta: {},
        payload: { id: "1", name: "Alice" },
      });

      expect(result.success).toBe(true);
    });

    it("should enforce strict mode on non-strict pre-built schemas", () => {
      // Create a NON-strict schema
      const nonStrictPayload = z.object({
        id: z.string(),
      });

      const Message = message("TEST", nonStrictPayload);

      // Extra properties should be rejected even though the input schema was non-strict
      const result = Message.safeParse({
        type: "TEST",
        meta: {},
        payload: { id: "1", extra: "field" },
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Raw shape objects", () => {
    it("should accept raw shape { field: z.type() }", () => {
      const RawMessage = message("RAW", {
        title: z.string(),
        count: z.number(),
      });

      const result = RawMessage.safeParse({
        type: "RAW",
        meta: {},
        payload: { title: "Test", count: 42 },
      });

      expect(result.success).toBe(true);
    });

    it("should enforce strict mode on raw shapes", () => {
      const RawMessage = message("RAW", {
        id: z.string(),
      });

      // Extra properties should be rejected (strict mode)
      const result = RawMessage.safeParse({
        type: "RAW",
        meta: {},
        payload: { id: "1", extra: "field" },
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Complex nested schemas", () => {
    it("should accept pre-built nested schema", () => {
      const userSchema = z.object({
        id: z.string(),
        profile: z.object({
          name: z.string(),
          age: z.number(),
        }),
      });

      const UserMessage = message("USER", userSchema);

      const result = UserMessage.safeParse({
        type: "USER",
        meta: {},
        payload: {
          id: "u1",
          profile: { name: "Alice", age: 30 },
        },
      });

      expect(result.success).toBe(true);
    });

    it("should accept raw nested shape", () => {
      const NestedMessage = message("NESTED", {
        user: z.object({
          id: z.string(),
          name: z.string(),
        }),
      });

      const result = NestedMessage.safeParse({
        type: "NESTED",
        meta: {},
        payload: { user: { id: "1", name: "Bob" } },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("No payload (empty message)", () => {
    it("should create message with no payload schema", () => {
      const PingMessage = message("PING");

      const result = PingMessage.safeParse({
        type: "PING",
        meta: {},
      });

      expect(result.success).toBe(true);
    });

    it("should reject payload when none expected", () => {
      const PingMessage = message("PING");

      const result = PingMessage.safeParse({
        type: "PING",
        meta: {},
        payload: { unexpected: "field" },
      });

      expect(result.success).toBe(false);
    });
  });
});
