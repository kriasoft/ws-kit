// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime Normalization Integration Tests (Valibot)
 *
 * Validates that the Valibot validator correctly receives normalized messages
 * with reserved server-only keys stripped before validation.
 *
 * This test ensures the contract between @ws-kit/core normalization and
 * @ws-kit/valibot validation is never broken.
 *
 * Spec: @docs/specs/validation.md#normalization-rules
 * See also: @ws-kit/core/test/features/normalization.test.ts
 */

import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { message } from "@ws-kit/valibot";
import { normalizeInboundMessage } from "@ws-kit/core";

describe("Runtime Normalization (Valibot Validator)", () => {
  describe("Validator Receives Normalized Messages", () => {
    it("should validate message after clientId is stripped from meta", () => {
      const TestMsg = message("TEST", { id: v.number() });

      // Malicious message from client with spoofed clientId
      const malicious = {
        type: "TEST",
        meta: { clientId: "spoofed-id-123", timestamp: Date.now() },
        payload: { id: 456 },
      };

      // Normalize (strips reserved keys)
      const normalized = normalizeInboundMessage(malicious);

      // Valibot validator should receive normalized message and accept it
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload?.id).toBe(456);
        expect(
          (result.data.meta as Record<string, unknown>).clientId,
        ).toBeUndefined();
        expect((result.data.meta as Record<string, unknown>).timestamp).toBe(
          malicious.meta.timestamp,
        );
      }
    });

    it("should validate message after receivedAt is stripped from meta", () => {
      const TestMsg = message("TEST", { text: v.string() });

      // Malicious message with spoofed receivedAt
      const malicious = {
        type: "TEST",
        meta: { receivedAt: 999999999, correlationId: "req-123" },
        payload: { text: "hello" },
      };

      // Normalize
      const normalized = normalizeInboundMessage(malicious);

      // Should pass validation
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload?.text).toBe("hello");
        expect(
          (result.data.meta as Record<string, unknown>).receivedAt,
        ).toBeUndefined();
        expect(
          (result.data.meta as Record<string, unknown>).correlationId,
        ).toBe("req-123");
      }
    });

    it("should reject raw message WITHOUT normalization (security boundary)", () => {
      const TestMsg = message("TEST");

      // Raw message with reserved key (no normalization)
      const raw = {
        type: "TEST",
        meta: { clientId: "spoofed" },
      };

      // Validate WITHOUT normalization - should FAIL (strict mode)
      const result = TestMsg.safeParse(raw);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Should fail due to unrecognized key
        expect(result.issues && result.issues.length > 0).toBe(true);
      }
    });

    it("should handle message with both reserved keys stripped", () => {
      const TestMsg = message("TEST", { value: v.string() });

      // Malicious message with both reserved keys
      const malicious = {
        type: "TEST",
        meta: {
          clientId: "spoofed",
          receivedAt: 12345,
          timestamp: Date.now(),
        },
        payload: { value: "test" },
      };

      // Normalize (both reserved keys stripped)
      const normalized = normalizeInboundMessage(malicious);

      // Should pass - only timestamp preserved
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload?.value).toBe("test");
        const meta = result.data.meta as Record<string, unknown>;
        expect(meta.clientId).toBeUndefined();
        expect(meta.receivedAt).toBeUndefined();
        expect(meta.timestamp).toBe(malicious.meta.timestamp);
      }
    });
  });

  describe("Contract Validation", () => {
    it("should maintain validator contract: normalized input always passes validation (if schema matches)", () => {
      const TestMsg = message("TEST", {
        count: v.pipe(v.number(), v.minValue(1)),
      });

      // Valid payload, but with spoofed reserved keys
      const malicious = {
        type: "TEST",
        meta: {
          clientId: "fake",
          receivedAt: 999,
        },
        payload: { count: 42 },
      };

      // After normalization, should pass because payload is valid
      const normalized = normalizeInboundMessage(malicious);
      const result = TestMsg.safeParse(normalized);

      expect(result.success).toBe(true);
    });

    it("should maintain validator contract: invalid payload still fails after normalization", () => {
      const TestMsg = message("TEST", {
        count: v.pipe(v.number(), v.minValue(1)),
      });

      // Invalid payload (negative number) + spoofed reserved keys
      const malicious = {
        type: "TEST",
        meta: { clientId: "fake" },
        payload: { count: -5 }, // Invalid: must be >= 1
      };

      // Normalization strips clientId, but payload validation still fails
      const normalized = normalizeInboundMessage(malicious);
      const result = TestMsg.safeParse(normalized);

      expect(result.success).toBe(false);
    });
  });

  describe("Meta Field Preservation", () => {
    it("should preserve custom meta fields while stripping reserved ones", () => {
      const TestMsg = message("TEST", undefined, {
        sessionId: v.string(),
        priority: v.picklist(["low", "high"]),
      });

      // Message with mix of reserved and custom meta
      const malicious = {
        type: "TEST",
        meta: {
          clientId: "spoofed", // Reserved - will be stripped
          receivedAt: 999, // Reserved - will be stripped
          sessionId: "sess-123", // Custom - will be preserved
          priority: "high", // Custom - will be preserved
        },
      };

      // Normalize
      const normalized = normalizeInboundMessage(malicious);

      // Validate
      const result = TestMsg.safeParse(normalized);
      expect(result.success).toBe(true);
      if (result.success) {
        const meta = result.data.meta as Record<string, unknown>;
        expect(meta.clientId).toBeUndefined();
        expect(meta.receivedAt).toBeUndefined();
        expect(meta.sessionId).toBe("sess-123");
        expect(meta.priority).toBe("high");
      }
    });
  });
});
