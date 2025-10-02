// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createMessageSchema } from "../../zod/schema";
import { formatValidationError } from "../../zod/utils";

const { messageSchema } = createMessageSchema(z);

describe("Zod v4 Features", () => {
  describe("Enhanced String Validators", () => {
    it("should validate JWT tokens", () => {
      const JWTMessage = messageSchema("JWT_AUTH", {
        token: z.jwt(),
      });

      const validJWT = {
        type: "JWT_AUTH",
        meta: {},
        payload: {
          token:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        },
      };

      const result = JWTMessage.safeParse(validJWT);
      expect(result.success).toBe(true);

      const invalidJWT = {
        type: "JWT_AUTH",
        meta: {},
        payload: { token: "not-a-jwt" },
      };

      const invalidResult = JWTMessage.safeParse(invalidJWT);
      expect(invalidResult.success).toBe(false);
    });

    it("should validate email addresses", () => {
      const EmailMessage = messageSchema("EMAIL_VERIFY", {
        email: z.email(),
      });

      const validEmail = {
        type: "EMAIL_VERIFY",
        meta: {},
        payload: { email: "test@example.com" },
      };

      expect(EmailMessage.safeParse(validEmail).success).toBe(true);

      const invalidEmail = {
        type: "EMAIL_VERIFY",
        meta: {},
        payload: { email: "not-an-email" },
      };

      expect(EmailMessage.safeParse(invalidEmail).success).toBe(false);
    });

    it("should validate URLs", () => {
      const WebhookMessage = messageSchema("WEBHOOK", {
        url: z.url(),
      });

      const validURL = {
        type: "WEBHOOK",
        meta: {},
        payload: { url: "https://example.com/webhook" },
      };

      expect(WebhookMessage.safeParse(validURL).success).toBe(true);

      const invalidURL = {
        type: "WEBHOOK",
        meta: {},
        payload: { url: "not a url" },
      };

      expect(WebhookMessage.safeParse(invalidURL).success).toBe(false);
    });

    it("should validate datetime strings", () => {
      const DateTimeMessage = messageSchema("DATETIME", {
        timestamp: z.iso.datetime(),
      });

      const validDateTimes = [
        "2024-01-01T00:00:00Z",
        "2024-01-01T12:34:56.789Z",
        "2024-01-01T00:00:00.000Z",
      ];

      for (const timestamp of validDateTimes) {
        const result = DateTimeMessage.safeParse({
          type: "DATETIME",
          meta: {},
          payload: { timestamp },
        });
        expect(result.success).toBe(true);
      }

      const invalidDateTime = {
        type: "DATETIME",
        meta: {},
        payload: { timestamp: "not-a-date" },
      };

      expect(DateTimeMessage.safeParse(invalidDateTime).success).toBe(false);
    });

    it("should validate IP addresses", () => {
      const IPMessage = messageSchema("IP_CHECK", {
        ipv4: z.ipv4(),
        ipv6: z.ipv6(),
      });

      const validIPs = {
        type: "IP_CHECK",
        meta: {},
        payload: {
          ipv4: "192.168.1.1",
          ipv6: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
        },
      };

      expect(IPMessage.safeParse(validIPs).success).toBe(true);

      const invalidIPs = {
        type: "IP_CHECK",
        meta: {},
        payload: {
          ipv4: "256.256.256.256",
          ipv6: "not-an-ip",
        },
      };

      expect(IPMessage.safeParse(invalidIPs).success).toBe(false);
    });

    it("should validate ULID strings", () => {
      const ULIDMessage = messageSchema("ULID_TEST", {
        id: z.ulid(),
      });

      const validULID = {
        type: "ULID_TEST",
        meta: {},
        payload: { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      };

      expect(ULIDMessage.safeParse(validULID).success).toBe(true);

      const invalidULID = {
        type: "ULID_TEST",
        meta: {},
        payload: { id: "invalid-ulid" },
      };

      expect(ULIDMessage.safeParse(invalidULID).success).toBe(false);
    });

    it("should validate nanoid strings", () => {
      const NanoIDMessage = messageSchema("NANOID_TEST", {
        id: z.nanoid(),
      });

      const validNanoID = {
        type: "NANOID_TEST",
        meta: {},
        payload: { id: "V1StGXR8_Z5jdHi6B-myT" },
      };

      expect(NanoIDMessage.safeParse(validNanoID).success).toBe(true);

      const invalidNanoID = {
        type: "NANOID_TEST",
        meta: {},
        payload: { id: "invalid#chars!" },
      };

      expect(NanoIDMessage.safeParse(invalidNanoID).success).toBe(false);
    });
  });

  describe("Numeric Validators", () => {
    it("should validate multipleOf", () => {
      const MultipleMessage = messageSchema("MULTIPLE", {
        price: z.number().multipleOf(0.01), // For currency
        quantity: z.number().int().multipleOf(5),
      });

      const valid = {
        type: "MULTIPLE",
        meta: {},
        payload: { price: 19.99, quantity: 15 },
      };

      expect(MultipleMessage.safeParse(valid).success).toBe(true);

      const invalid = {
        type: "MULTIPLE",
        meta: {},
        payload: { price: 19.999, quantity: 13 },
      };

      expect(MultipleMessage.safeParse(invalid).success).toBe(false);
    });
  });

  describe("Error Formatting", () => {
    it("should format validation errors nicely", () => {
      const TestMessage = messageSchema("ERROR_TEST", {
        email: z.email(),
        age: z.number().int().min(18),
      });

      const invalid = {
        type: "ERROR_TEST",
        meta: {},
        payload: { email: "not-email", age: 15 },
      };

      const result = TestMessage.safeParse(invalid);
      expect(result.success).toBe(false);

      if (!result.success) {
        const formatted = formatValidationError({
          issues: result.error.issues,
          formatted: z.prettifyError(result.error),
        });

        expect(formatted).toContain("payload.email");
        expect(formatted).toContain("payload.age");
      }
    });
  });
});
