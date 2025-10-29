// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Zod v4 Built-in Validators Test
 *
 * Tests Zod v4's built-in validator support (email, url, jwt, ip, ulid, datetime)
 * to ensure proper message validation with these specialized schema validators.
 */

import { describe, it, expect } from "bun:test";
import { z, message } from "@ws-kit/zod";

describe("Zod v4 Built-in Validators", () => {
  describe("Email validation (z.email)", () => {
    it("should validate valid email addresses", () => {
      const EmailMessage = message("EMAIL_VERIFY", {
        email: z.email(),
      });

      const validResult = EmailMessage.safeParse({
        type: "EMAIL_VERIFY",
        meta: {},
        payload: { email: "test@example.com" },
      });
      expect(validResult.success).toBe(true);
    });

    it("should reject invalid email addresses", () => {
      const EmailMessage = message("EMAIL_VERIFY", {
        email: z.email(),
      });

      const invalidResult = EmailMessage.safeParse({
        type: "EMAIL_VERIFY",
        meta: {},
        payload: { email: "not-an-email" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("URL validation (z.url)", () => {
    it("should validate valid URLs", () => {
      const WebhookMessage = message("WEBHOOK", {
        url: z.url(),
      });

      const validResult = WebhookMessage.safeParse({
        type: "WEBHOOK",
        meta: {},
        payload: { url: "https://example.com/webhook" },
      });
      expect(validResult.success).toBe(true);
    });

    it("should reject invalid URLs", () => {
      const WebhookMessage = message("WEBHOOK", {
        url: z.url(),
      });

      const invalidResult = WebhookMessage.safeParse({
        type: "WEBHOOK",
        meta: {},
        payload: { url: "not a url" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("JWT validation (z.jwt)", () => {
    it("should validate valid JWT tokens", () => {
      const JWTMessage = message("JWT_AUTH", {
        token: z.string().jwt(),
      });

      // Valid JWT from jwt.io
      const validJWT =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

      const result = JWTMessage.safeParse({
        type: "JWT_AUTH",
        meta: {},
        payload: { token: validJWT },
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid JWT tokens", () => {
      const JWTMessage = message("JWT_AUTH", {
        token: z.string().jwt(),
      });

      const result = JWTMessage.safeParse({
        type: "JWT_AUTH",
        meta: {},
        payload: { token: "not-a-jwt" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Date validation (z.date, z.coerce.date)", () => {
    it("should validate dates from ISO strings", () => {
      const DateMessage = message("DATE_CHECK", {
        date: z.coerce.date(),
      });

      const validResult = DateMessage.safeParse({
        type: "DATE_CHECK",
        meta: {},
        payload: { date: "2024-01-01T00:00:00Z" },
      });
      expect(validResult.success).toBe(true);
    });

    it("should reject invalid date strings", () => {
      const DateMessage = message("DATE_CHECK", {
        date: z.coerce.date(),
      });

      const invalidResult = DateMessage.safeParse({
        type: "DATE_CHECK",
        meta: {},
        payload: { date: "not-a-date" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("UUID validation (z.uuid)", () => {
    it("should validate valid UUIDs", () => {
      const UUIDMessage = message("UUID_TEST", {
        id: z.string().uuid(),
      });

      const validResult = UUIDMessage.safeParse({
        type: "UUID_TEST",
        meta: {},
        payload: { id: "550e8400-e29b-41d4-a716-446655440000" },
      });
      expect(validResult.success).toBe(true);
    });

    it("should reject invalid UUIDs", () => {
      const UUIDMessage = message("UUID_TEST", {
        id: z.string().uuid(),
      });

      const invalidResult = UUIDMessage.safeParse({
        type: "UUID_TEST",
        meta: {},
        payload: { id: "not-a-uuid" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("DateTime validation (z.string().datetime)", () => {
    it("should validate valid ISO datetime strings", () => {
      const DateTimeMessage = message("DATETIME", {
        timestamp: z.string().datetime(),
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
    });

    it("should reject invalid datetime strings", () => {
      const DateTimeMessage = message("DATETIME", {
        timestamp: z.string().datetime(),
      });

      const invalidResult = DateTimeMessage.safeParse({
        type: "DATETIME",
        meta: {},
        payload: { timestamp: "not-a-date" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("Complex nested validation", () => {
    it("should handle complex nested schemas with multiple v4 validators", () => {
      const ComplexMessage = message("COMPLEX", {
        user: z.object({
          id: z.string().uuid(),
          email: z.email(),
          profile: z.object({
            name: z.string(),
            website: z.string().url().optional(),
          }),
        }),
        registeredAt: z.string().datetime(),
      });

      const validData = {
        type: "COMPLEX",
        meta: {},
        payload: {
          user: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            email: "test@example.com",
            profile: {
              name: "John",
              website: "https://example.com",
            },
          },
          registeredAt: "2024-01-01T00:00:00Z",
        },
      };

      const result = ComplexMessage.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should reject complex schema with invalid nested values", () => {
      const ComplexMessage = message("COMPLEX", {
        user: z.object({
          id: z.string().uuid(),
          email: z.email(),
        }),
      });

      const invalidData = {
        type: "COMPLEX",
        meta: {},
        payload: {
          user: {
            id: "not-a-uuid",
            email: "invalid-email",
          },
        },
      };

      const result = ComplexMessage.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
