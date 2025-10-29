// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Normalization Security Boundary Tests
 *
 * Validates that reserved server-only keys are stripped before validation
 * to prevent client spoofing attacks.
 *
 * Spec: @docs/specs/validation.md#normalization-rules
 * Implementation: shared/normalize.ts
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { normalizeInboundMessage } from "../../src/normalize";
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z);

describe("Message Normalization (Security Boundary)", () => {
  describe("Reserved Key Stripping", () => {
    it("should strip clientId from meta before validation", () => {
      const TestMsg = messageSchema("TEST", { id: z.number() });

      // Client attempts to inject clientId
      const malicious = {
        type: "TEST",
        meta: { clientId: "fake-spoofed-id", timestamp: Date.now() },
        payload: { id: 123 },
      };

      // Normalize (security boundary)
      const normalized = normalizeInboundMessage(malicious);

      // Reserved key should be stripped
      expect(normalized.meta).not.toHaveProperty("clientId");
      expect(normalized.meta).toHaveProperty("timestamp");

      // Message should pass validation (no unknown keys after stripping)
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
    });

    it("should strip receivedAt from meta before validation", () => {
      const TestMsg = messageSchema("TEST", { id: z.number() });

      // Client attempts to inject receivedAt
      const malicious = {
        type: "TEST",
        meta: { receivedAt: 999999, correlationId: "test-123" },
        payload: { id: 456 },
      };

      // Normalize (security boundary)
      const normalized = normalizeInboundMessage(malicious);

      // Reserved key should be stripped
      expect(normalized.meta).not.toHaveProperty("receivedAt");
      expect(normalized.meta).toHaveProperty("correlationId");

      // Message should pass validation
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
    });

    it("should strip multiple reserved keys simultaneously", () => {
      const TestMsg = messageSchema("TEST");

      // Client attempts to inject both reserved keys
      const malicious = {
        type: "TEST",
        meta: {
          clientId: "fake-id",
          receivedAt: 12345,
          timestamp: Date.now(),
        },
      };

      // Normalize
      const normalized = normalizeInboundMessage(malicious);

      // Both reserved keys should be stripped
      expect(normalized.meta).not.toHaveProperty("clientId");
      expect(normalized.meta).not.toHaveProperty("receivedAt");
      expect(normalized.meta).toHaveProperty("timestamp");

      // Message should pass validation
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
    });
  });

  describe("Meta Defaulting", () => {
    it("should default missing meta to empty object", () => {
      const TestMsg = messageSchema("TEST");

      // Client omits meta entirely
      const message = {
        type: "TEST",
      };

      // Normalize
      const normalized = normalizeInboundMessage(message);

      // Meta should be defaulted
      expect(normalized).toHaveProperty("meta");
      expect(normalized.meta).toEqual({});

      // Message should pass validation
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
    });

    it("should replace null meta with empty object", () => {
      const TestMsg = messageSchema("TEST");

      // Client sends null meta
      const message = {
        type: "TEST",
        meta: null,
      };

      // Normalize
      const normalized = normalizeInboundMessage(message);

      // Meta should be replaced
      expect(normalized.meta).toEqual({});

      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
    });

    it("should replace array meta with empty object", () => {
      const TestMsg = messageSchema("TEST");

      // Client sends array as meta (invalid structure)
      const message = {
        type: "TEST",
        meta: ["invalid", "array"],
      };

      // Normalize
      const normalized = normalizeInboundMessage(message);

      // Meta should be replaced
      expect(normalized.meta).toEqual({});

      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
    });
  });

  describe("Normalization Before Validation Flow", () => {
    it("should normalize THEN validate (correct order)", () => {
      const TestMsg = messageSchema("TEST", { value: z.string() });

      // Message with reserved key and valid data
      const message = {
        type: "TEST",
        meta: { clientId: "spoofed" },
        payload: { value: "test" },
      };

      // Step 1: Normalize (strips clientId)
      const normalized = normalizeInboundMessage(message);
      expect(normalized.meta).not.toHaveProperty("clientId");

      // Step 2: Validate normalized message (should pass)
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
    });

    it("should fail validation if reserved key NOT stripped", () => {
      const TestMsg = messageSchema("TEST");

      // Message with reserved key
      const message = {
        type: "TEST",
        meta: { clientId: "spoofed" },
      };

      // Skip normalization (security violation)
      // Validate raw message directly
      const result = TestMsg.safeParse(message);

      // Should FAIL due to unknown key (strict mode)
      expect(result.success).toBe(false);
    });
  });

  describe("Performance Characteristics", () => {
    it("should mutate message in place (not clone)", () => {
      const message = {
        type: "TEST",
        meta: { clientId: "fake", timestamp: 12345 },
      };

      const normalized = normalizeInboundMessage(message);

      // Should be same reference (mutated in place)
      expect(normalized).toBe(message);
    });

    it("should be O(k) complexity where k = reserved keys count", () => {
      // This test documents the performance characteristic
      // O(2) for current implementation (clientId, receivedAt)

      const message = {
        type: "TEST",
        meta: {
          clientId: "fake",
          receivedAt: 999,
          field1: "a",
          field2: "b",
          field3: "c",
          field4: "d",
          field5: "e",
          // Many fields, but still O(k) where k = 2
        },
      };

      const start = performance.now();
      normalizeInboundMessage(message);
      const duration = performance.now() - start;

      // Should complete in microseconds (not dependent on meta field count)
      expect(duration).toBeLessThan(1); // 1ms threshold
    });
  });

  describe("Edge Cases", () => {
    it("should handle non-object input gracefully", () => {
      const normalized = normalizeInboundMessage("invalid" as never);
      expect(normalized as unknown).toBe("invalid");
    });

    it("should handle null input gracefully", () => {
      const normalized = normalizeInboundMessage(null as never);
      expect(normalized as unknown).toBe(null);
    });

    it("should handle undefined input gracefully", () => {
      const normalized = normalizeInboundMessage(undefined as never);
      expect(normalized as unknown).toBe(undefined);
    });

    it("should preserve non-reserved meta fields", () => {
      const message = {
        type: "TEST",
        meta: {
          clientId: "fake", // Reserved - should be stripped
          timestamp: 12345, // Standard - should be kept
          correlationId: "test-123", // Standard - should be kept
          customField: "value", // Custom - should be kept
        },
      };

      const normalized = normalizeInboundMessage(message);

      expect(normalized.meta).not.toHaveProperty("clientId");
      expect(normalized.meta).toHaveProperty("timestamp", 12345);
      expect(normalized.meta).toHaveProperty("correlationId", "test-123");
      expect(normalized.meta).toHaveProperty("customField", "value");
    });
  });
});
