// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Reserved Key Schema Validation Tests (Valibot)
 *
 * Validates that schema creation fails when extended meta attempts to
 * define reserved server-only keys.
 *
 * Spec: @docs/specs/schema.md#Reserved-Server-Only-Meta-Keys
 * Spec: @docs/specs/rules.md#reserved-keys
 * Spec: @docs/specs/validation.md#normalization-rules
 */

import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { message } from "@ws-kit/valibot";

describe("Reserved Key Schema Validation (Valibot)", () => {
  describe("Reserved Key Detection", () => {
    it("should reject schema with clientId in extended meta", () => {
      expect(() => {
        message(
          "TEST",
          { id: v.number() },
          {
            clientId: v.string(), // ❌ Reserved key
          },
        );
      }).toThrow(/Reserved meta keys not allowed in schema.*clientId/);
    });

    it("should reject schema with receivedAt in extended meta", () => {
      expect(() => {
        message(
          "TEST",
          { id: v.number() },
          {
            receivedAt: v.number(), // ❌ Reserved key
          },
        );
      }).toThrow(/Reserved meta keys not allowed in schema.*receivedAt/);
    });

    it("should reject schema with multiple reserved keys", () => {
      expect(() => {
        message(
          "TEST",
          { id: v.number() },
          {
            clientId: v.string(), // ❌ Reserved
            receivedAt: v.number(), // ❌ Reserved
            userId: v.string(), // ✅ Valid, but mixed with reserved
          },
        );
      }).toThrow(/Reserved meta keys not allowed in schema/);
    });

    it("should accept schema with similar but non-reserved names", () => {
      expect(() => {
        message(
          "TEST",
          { id: v.number() },
          {
            client: v.string(), // ✅ Not reserved
            received: v.number(), // ✅ Not reserved
            clientInfo: v.string(), // ✅ Not reserved
            receivedFrom: v.string(), // ✅ Not reserved
          },
        );
      }).not.toThrow();
    });

    it("should accept schema with application-level identity fields", () => {
      expect(() => {
        message(
          "TEST",
          { text: v.string() },
          {
            userId: v.string(), // ✅ Application-level identity
            senderId: v.string(), // ✅ Message sender
            authorId: v.string(), // ✅ Content author
          },
        );
      }).not.toThrow();
    });

    it("should provide clear error message with all reserved keys", () => {
      try {
        message("TEST", undefined, {
          clientId: v.string(),
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;

        // Should mention the offending key
        expect(message).toContain("clientId");

        // Should list all reserved keys
        expect(message).toContain("Reserved keys:");
        expect(message).toMatch(/clientId.*receivedAt|receivedAt.*clientId/);
      }
    });
  });

  describe("Reserved Keys List Completeness", () => {
    it("should enforce exactly two reserved keys (clientId, receivedAt)", () => {
      const reservedKeys = ["clientId", "receivedAt"];

      for (const key of reservedKeys) {
        expect(() => {
          message("TEST", undefined, {
            [key]: v.string(),
          });
        }).toThrow(/Reserved meta keys not allowed/);
      }
    });

    it("should reject any combination of reserved keys", () => {
      const combinations = [
        { clientId: v.string() },
        { receivedAt: v.number() },
        { clientId: v.string(), receivedAt: v.number() },
      ];

      for (const meta of combinations) {
        expect(() => {
          message("TEST", undefined, meta as never);
        }).toThrow(/Reserved meta keys not allowed/);
      }
    });
  });

  describe("Schema Creation Success Cases", () => {
    it("should create schema without extended meta", () => {
      const schema = message("TEST");
      expect(schema).toBeDefined();
    });

    it("should create schema with only payload", () => {
      const schema = message("TEST", { id: v.number() });
      expect(schema).toBeDefined();
    });

    it("should create schema with valid extended meta", () => {
      const schema = message(
        "TEST",
        { text: v.string() },
        {
          userId: v.string(),
          roomId: v.string(),
          priority: v.optional(v.number()),
        },
      );
      expect(schema).toBeDefined();
    });

    it("should create complex schema with nested structures", () => {
      const schema = message(
        "COMPLEX",
        {
          data: v.object({
            items: v.array(v.string()),
            count: v.number(),
          }),
        },
        {
          sessionId: v.string(),
          metadata: v.record(v.string(), v.unknown()),
        },
      );
      expect(schema).toBeDefined();
    });
  });

  describe("Error Message Quality", () => {
    it("should provide actionable error message", () => {
      try {
        message("TEST", undefined, {
          clientId: v.string(),
          userId: v.string(),
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        const message = (error as Error).message;

        // Should be clear about what's wrong
        expect(message.toLowerCase()).toContain("reserved");
        expect(message.toLowerCase()).toContain("not allowed");

        // Should identify the problem key
        expect(message).toContain("clientId");

        // Should list all reserved keys for reference
        expect(message).toContain("Reserved keys:");
      }
    });

    it("should handle multiple violations in error message", () => {
      try {
        message("TEST", undefined, {
          clientId: v.string(),
          receivedAt: v.number(),
          userId: v.string(),
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        const message = (error as Error).message;

        // Should mention all reserved keys found
        expect(message).toContain("clientId");
        expect(message).toContain("receivedAt");

        // Should not mention valid keys
        expect(message).not.toMatch(/userId.*not allowed/);
      }
    });
  });

  describe("Rationale Documentation", () => {
    it("should fail fast at design time (not runtime)", () => {
      // This test documents the design decision:
      // We detect reserved keys at schema creation (design time),
      // not during validation (runtime), for better DX.

      // Design time: Schema creation fails immediately
      expect(() => {
        message("TEST", undefined, { clientId: v.string() });
      }).toThrow();

      // Runtime: If we somehow got a schema with clientId,
      // normalization would strip it before validation anyway.
      // But we prevent this at design time for clarity.
    });

    it("should prevent silent validation failures", () => {
      // Without this check, a developer could:
      // 1. Define clientId in extended meta
      // 2. Normalization strips it from inbound messages
      // 3. Validation fails on required field (confusing!)
      //
      // By throwing at schema creation, we provide clear feedback.

      expect(() => {
        message("TEST", undefined, {
          clientId: v.string(), // Intended as required
        });
      }).toThrow(/Reserved meta keys not allowed/);
    });
  });
});
