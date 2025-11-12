// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Strict Schema Validation Tests
 *
 * Validates that schemas reject unknown keys at all levels (root, meta, payload)
 * and enforce payload presence rules.
 *
 * Spec: docs/specs/schema.md#strict-schemas-required
 * Spec: docs/specs/validation.md#strict-mode-enforcement
 */

import { describe, expect, it } from "bun:test";
import { z, message } from "@ws-kit/zod";

describe("Strict Schema Validation (Zod)", () => {
  describe("Unknown Key Rejection - Root Level", () => {
    it("should reject unknown keys at message root", () => {
      const TestMsg = message("TEST", { id: z.number() });

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {},
        payload: { id: 123 },
        unknownField: "should-fail", // ❌ Unknown key at root
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.code === "unrecognized_keys"),
        ).toBe(true);
      }
    });

    it("should reject extra field at root even with valid structure", () => {
      const TestMsg = message("TEST");

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {},
        extraRoot: 123, // ❌ Extra field at root
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Unknown Key Rejection - Meta Level", () => {
    it("should reject unknown keys in meta", () => {
      const TestMsg = message("TEST", { id: z.number() });

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {
          timestamp: Date.now(), // ✅ Standard field
          junkField: "invalid", // ❌ Unknown key in meta
        },
        payload: { id: 123 },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.path.includes("meta") && i.code === "unrecognized_keys",
          ),
        ).toBe(true);
      }
    });

    it("should reject unknown meta keys even when extended meta present", () => {
      const TestMsg = message(
        "TEST",
        { id: z.number() },
        { roomId: z.string() }, // Extended meta
      );

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {
          roomId: "room-1", // ✅ Required by extended meta
          unknownMeta: "bad", // ❌ Not in schema
        },
        payload: { id: 123 },
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Unknown Key Rejection - Payload Level", () => {
    it("should reject unknown keys in payload", () => {
      const TestMsg = message("TEST", {
        name: z.string(),
        count: z.number(),
      });

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {},
        payload: {
          name: "test",
          count: 42,
          extraField: "not-allowed", // ❌ Unknown key in payload
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.path.includes("payload") && i.code === "unrecognized_keys",
          ),
        ).toBe(true);
      }
    });

    it("should reject deeply nested unknown keys", () => {
      const TestMsg = message("TEST", {
        nested: z
          .object({
            allowed: z.string(),
          })
          .strict(),
      });

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {},
        payload: {
          nested: {
            allowed: "value",
            notAllowed: "extra", // ❌ Unknown nested key
          },
        },
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Payload Presence Rules", () => {
    it("should reject unexpected payload key when schema defines none", () => {
      const NoPayloadMsg = message("NO_PAYLOAD");

      // payload key present with empty object
      const result1 = NoPayloadMsg.safeParse({
        type: "NO_PAYLOAD",
        meta: {},
        payload: {}, // ❌ Unexpected key
      });
      expect(result1.success).toBe(false);

      // payload key present with undefined
      const result2 = NoPayloadMsg.safeParse({
        type: "NO_PAYLOAD",
        meta: {},
        payload: undefined, // ❌ Unexpected key
      });
      expect(result2.success).toBe(false);

      // payload key present with null
      const result3 = NoPayloadMsg.safeParse({
        type: "NO_PAYLOAD",
        meta: {},
        payload: null, // ❌ Unexpected key
      });
      expect(result3.success).toBe(false);
    });

    it("should accept message without payload key when schema defines none", () => {
      const NoPayloadMsg = message("NO_PAYLOAD");

      const result = NoPayloadMsg.safeParse({
        type: "NO_PAYLOAD",
        meta: {},
        // ✅ No payload key
      });

      expect(result.success).toBe(true);
    });

    it("should reject missing payload when schema requires it", () => {
      const WithPayloadMsg = message("WITH_PAYLOAD", {
        required: z.string(),
      });

      const result = WithPayloadMsg.safeParse({
        type: "WITH_PAYLOAD",
        meta: {},
        // ❌ Missing payload
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.includes("payload")),
        ).toBe(true);
      }
    });

    it("should accept valid payload when schema requires it", () => {
      const WithPayloadMsg = message("WITH_PAYLOAD", {
        data: z.string(),
      });

      const result = WithPayloadMsg.safeParse({
        type: "WITH_PAYLOAD",
        meta: {},
        payload: { data: "test" },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Meta Presence Rules", () => {
    it("should accept empty meta when no extended meta required", () => {
      const TestMsg = message("TEST");

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {},
      });

      expect(result.success).toBe(true);
    });

    it("should reject missing required extended meta fields", () => {
      const TestMsg = message(
        "TEST",
        undefined,
        { roomId: z.string() }, // Required extended meta
      );

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {}, // ❌ Missing roomId
      });

      expect(result.success).toBe(false);
    });

    it("should accept optional extended meta fields", () => {
      const TestMsg = message("TEST", undefined, {
        optional: z.string().optional(),
      });

      // Without optional field
      const result1 = TestMsg.safeParse({
        type: "TEST",
        meta: {},
      });
      expect(result1.success).toBe(true);

      // With optional field
      const result2 = TestMsg.safeParse({
        type: "TEST",
        meta: { optional: "value" },
      });
      expect(result2.success).toBe(true);
    });
  });

  describe("Standard Meta Fields", () => {
    it("should accept standard timestamp field", () => {
      const TestMsg = message("TEST");

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: { timestamp: Date.now() },
      });

      expect(result.success).toBe(true);
    });

    it("should accept standard correlationId field", () => {
      const TestMsg = message("TEST");

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: { correlationId: "req-123" },
      });

      expect(result.success).toBe(true);
    });

    it("should accept both standard fields together", () => {
      const TestMsg = message("TEST");

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: {
          timestamp: Date.now(),
          correlationId: "req-456",
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Client-Side Validation Symmetry", () => {
    it("should enable client-side validation (no server-only fields)", () => {
      const TestMsg = message("TEST", { data: z.string() });

      // Client creates message
      const clientMessage = {
        type: "TEST" as const,
        meta: { timestamp: Date.now() },
        payload: { data: "test" },
      };

      // Client validates before sending
      const clientResult = TestMsg.safeParse(clientMessage);
      expect(clientResult.success).toBe(true);

      // Server receives and validates (after normalization)
      const serverResult = TestMsg.safeParse(clientMessage);
      expect(serverResult.success).toBe(true);
    });
  });

  describe("Complex Validation Scenarios", () => {
    it("should reject combination of root and meta unknown keys", () => {
      const TestMsg = message("TEST");

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: { junk: "xyz" }, // ❌ Unknown in meta
        rootJunk: 123, // ❌ Unknown at root
      });

      expect(result.success).toBe(false);
    });

    it("should reject combination of meta and payload unknown keys", () => {
      const TestMsg = message("TEST", { id: z.number() });

      const result = TestMsg.safeParse({
        type: "TEST",
        meta: { extra: "meta" }, // ❌ Unknown in meta
        payload: {
          id: 123,
          extra: "payload", // ❌ Unknown in payload
        },
      });

      expect(result.success).toBe(false);
    });

    it("should accept valid complex message with extended meta", () => {
      const ComplexMsg = message(
        "COMPLEX",
        {
          nested: z.object({
            field: z.string(),
          }),
          array: z.array(z.number()),
        },
        {
          roomId: z.string(),
          priority: z.number(),
        },
      );

      const result = ComplexMsg.safeParse({
        type: "COMPLEX",
        meta: {
          timestamp: Date.now(),
          correlationId: "req-789",
          roomId: "room-1",
          priority: 5,
        },
        payload: {
          nested: { field: "value" },
          array: [1, 2, 3],
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Meta Field Schema Defaults", () => {
    it("should default meta to empty object when omitted", () => {
      const TestMsg = message("TEST", { id: z.string() });

      // Parse without meta field at all
      const result = TestMsg.safeParse({
        type: "TEST",
        payload: { id: "123" },
        // ← no meta field
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta).toEqual({});
      }
    });

    it("should default meta to empty object for message without payload", () => {
      const TestMsg = message("PING");

      // Parse without meta field
      const result = TestMsg.safeParse({
        type: "PING",
        // ← no meta field
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta).toEqual({});
      }
    });

    it("should use provided meta instead of defaulting", () => {
      const TestMsg = message("TEST", { id: z.string() });

      const result = TestMsg.safeParse({
        type: "TEST",
        payload: { id: "456" },
        meta: { timestamp: 1234567890, correlationId: "abc" },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta).toEqual({
          timestamp: 1234567890,
          correlationId: "abc",
        });
      }
    });

    it("should default meta with extended schema when omitted", () => {
      const TestMsg = message(
        "TEST",
        { id: z.string() },
        { roomId: z.string().optional() }, // Optional extended meta
      );

      // Parse without meta field
      const result = TestMsg.safeParse({
        type: "TEST",
        payload: { id: "789" },
        // ← no meta field
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta).toEqual({});
      }
    });
  });
});
