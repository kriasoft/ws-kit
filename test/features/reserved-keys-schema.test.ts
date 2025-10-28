// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Reserved Key Schema Validation Tests
 *
 * Validates that schema creation fails when extended meta attempts to
 * define reserved server-only keys.
 *
 * Spec: @specs/schema.md#Reserved-Server-Only-Meta-Keys
 * Spec: @specs/rules.md#reserved-keys
 * Spec: @specs/validation.md#normalization-rules
 */

import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { z } from "zod";
import { createMessageSchema as createValibotSchema } from "../../packages/valibot/src/schema";
import { createMessageSchema as createZodSchema } from "../../packages/zod/src/schema";

const { messageSchema: zodMessageSchema } = createZodSchema(z);
const { messageSchema: valibotMessageSchema } = createValibotSchema(v);

describe("Reserved Key Schema Validation", () => {
  describe("Zod Adapter - Reserved Key Detection", () => {
    it("should reject schema with clientId in extended meta", () => {
      expect(() => {
        zodMessageSchema(
          "TEST",
          { id: z.number() },
          {
            clientId: z.string(), // ❌ Reserved key
          },
        );
      }).toThrow(/Reserved meta keys not allowed in schema.*clientId/);
    });

    it("should reject schema with receivedAt in extended meta", () => {
      expect(() => {
        zodMessageSchema(
          "TEST",
          { id: z.number() },
          {
            receivedAt: z.number(), // ❌ Reserved key
          },
        );
      }).toThrow(/Reserved meta keys not allowed in schema.*receivedAt/);
    });

    it("should reject schema with multiple reserved keys", () => {
      expect(() => {
        zodMessageSchema(
          "TEST",
          { id: z.number() },
          {
            clientId: z.string(), // ❌ Reserved
            receivedAt: z.number(), // ❌ Reserved
            userId: z.string(), // ✅ Valid, but mixed with reserved
          },
        );
      }).toThrow(/Reserved meta keys not allowed in schema/);
    });

    it("should accept schema with similar but non-reserved names", () => {
      expect(() => {
        zodMessageSchema(
          "TEST",
          { id: z.number() },
          {
            client: z.string(), // ✅ Not reserved
            received: z.number(), // ✅ Not reserved
            clientInfo: z.string(), // ✅ Not reserved
            receivedFrom: z.string(), // ✅ Not reserved
          },
        );
      }).not.toThrow();
    });

    it("should accept schema with application-level identity fields", () => {
      expect(() => {
        zodMessageSchema(
          "TEST",
          { text: z.string() },
          {
            userId: z.string(), // ✅ Application-level identity
            senderId: z.string(), // ✅ Message sender
            authorId: z.string(), // ✅ Content author
          },
        );
      }).not.toThrow();
    });

    it("should provide clear error message with all reserved keys", () => {
      try {
        zodMessageSchema("TEST", undefined, {
          clientId: z.string(),
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

  describe("Valibot Adapter - Reserved Key Detection", () => {
    it("should reject schema with clientId in extended meta", () => {
      expect(() => {
        valibotMessageSchema(
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
        valibotMessageSchema(
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
        valibotMessageSchema(
          "TEST",
          { id: v.number() },
          {
            clientId: v.string(),
            receivedAt: v.number(),
            userId: v.string(),
          },
        );
      }).toThrow(/Reserved meta keys not allowed in schema/);
    });

    it("should accept schema with valid application fields", () => {
      expect(() => {
        valibotMessageSchema(
          "TEST",
          { text: v.string() },
          {
            userId: v.string(),
            roomId: v.string(),
            priority: v.number(),
          },
        );
      }).not.toThrow();
    });
  });

  describe("Reserved Keys List Completeness", () => {
    it("should enforce exactly two reserved keys (clientId, receivedAt)", () => {
      const reservedKeys = ["clientId", "receivedAt"];

      for (const key of reservedKeys) {
        expect(() => {
          zodMessageSchema("TEST", undefined, {
            [key]: z.string(),
          });
        }).toThrow(/Reserved meta keys not allowed/);
      }
    });

    it("should reject any combination of reserved keys", () => {
      const combinations = [
        { clientId: z.string() },
        { receivedAt: z.number() },
        { clientId: z.string(), receivedAt: z.number() },
      ];

      for (const meta of combinations) {
        expect(() => {
          zodMessageSchema("TEST", undefined, meta as never);
        }).toThrow(/Reserved meta keys not allowed/);
      }
    });
  });

  describe("Schema Creation Success Cases", () => {
    it("should create schema without extended meta", () => {
      const schema = zodMessageSchema("TEST");
      expect(schema).toBeDefined();
    });

    it("should create schema with only payload", () => {
      const schema = zodMessageSchema("TEST", { id: z.number() });
      expect(schema).toBeDefined();
    });

    it("should create schema with valid extended meta", () => {
      const schema = zodMessageSchema(
        "TEST",
        { text: z.string() },
        {
          userId: z.string(),
          roomId: z.string(),
          priority: z.number().optional(),
        },
      );
      expect(schema).toBeDefined();
    });

    it("should create complex schema with nested structures", () => {
      const schema = zodMessageSchema(
        "COMPLEX",
        {
          data: z.object({
            items: z.array(z.string()),
            count: z.number(),
          }),
        },
        {
          sessionId: z.string(),
          metadata: z.record(z.string(), z.unknown()),
        },
      );
      expect(schema).toBeDefined();
    });
  });

  describe("Error Message Quality", () => {
    it("should provide actionable error message", () => {
      try {
        zodMessageSchema("TEST", undefined, {
          clientId: z.string(),
          userId: z.string(),
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
        zodMessageSchema("TEST", undefined, {
          clientId: z.string(),
          receivedAt: z.number(),
          userId: z.string(),
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
        zodMessageSchema("TEST", undefined, { clientId: z.string() });
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
        zodMessageSchema("TEST", undefined, {
          clientId: z.string(), // Intended as required
        });
      }).toThrow(/Reserved meta keys not allowed/);
    });
  });

  describe("Cross-Adapter Consistency", () => {
    it("should have identical behavior across Zod and Valibot", () => {
      // Test reserved key rejection
      expect(() => {
        zodMessageSchema("TEST", undefined, { clientId: z.string() });
      }).toThrow();

      expect(() => {
        valibotMessageSchema("TEST", undefined, { clientId: v.string() });
      }).toThrow();

      // Test valid schema creation
      expect(() => {
        zodMessageSchema("TEST", undefined, { userId: z.string() });
      }).not.toThrow();

      expect(() => {
        valibotMessageSchema("TEST", undefined, { userId: v.string() });
      }).not.toThrow();
    });

    it("should provide similar error messages", () => {
      let zodError: string | undefined;
      let valibotError: string | undefined;

      try {
        zodMessageSchema("TEST", undefined, { clientId: z.string() });
      } catch (error) {
        zodError = (error as Error).message;
      }

      try {
        valibotMessageSchema("TEST", undefined, { clientId: v.string() });
      } catch (error) {
        valibotError = (error as Error).message;
      }

      expect(zodError).toBeDefined();
      expect(valibotError).toBeDefined();

      // Both should mention the key problem
      expect(zodError).toContain("clientId");
      expect(valibotError).toContain("clientId");

      // Both should list reserved keys
      expect(zodError).toContain("Reserved keys:");
      expect(valibotError).toContain("Reserved keys:");
    });
  });
});
