// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Valibot Built-in Validators Test
 *
 * Tests Valibot's built-in validator support (email, url, uuid, datetime, etc.)
 * to ensure proper message validation with these specialized schema validators.
 */

import { message, v } from "@ws-kit/valibot";
import { describe, expect, it } from "bun:test";

describe("Valibot Built-in Validators", () => {
  describe("Email validation (v.email)", () => {
    it("should validate valid email addresses", () => {
      const EmailMessage = message("EMAIL_VERIFY", {
        email: v.pipe(v.string(), v.email()),
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
        email: v.pipe(v.string(), v.email()),
      });

      const invalidResult = EmailMessage.safeParse({
        type: "EMAIL_VERIFY",
        meta: {},
        payload: { email: "not-an-email" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("URL validation (v.url)", () => {
    it("should validate valid URLs", () => {
      const WebhookMessage = message("WEBHOOK", {
        url: v.pipe(v.string(), v.url()),
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
        url: v.pipe(v.string(), v.url()),
      });

      const invalidResult = WebhookMessage.safeParse({
        type: "WEBHOOK",
        meta: {},
        payload: { url: "not a url" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("UUID validation (v.uuid)", () => {
    it("should validate valid UUIDs", () => {
      const UUIDMessage = message("UUID_TEST", {
        id: v.pipe(v.string(), v.uuid()),
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
        id: v.pipe(v.string(), v.uuid()),
      });

      const invalidResult = UUIDMessage.safeParse({
        type: "UUID_TEST",
        meta: {},
        payload: { id: "not-a-uuid" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("ISO DateTime validation (v.isoDateTime, v.isoTimestamp)", () => {
    it("should validate valid ISO datetime strings", () => {
      const DateTimeMessage = message("DATETIME", {
        timestamp: v.pipe(v.string(), v.isoDateTime()),
      });

      const validDateTimes = ["2024-01-01T00:00", "2024-01-01T12:34"];

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
        timestamp: v.pipe(v.string(), v.isoDateTime()),
      });

      const invalidResult = DateTimeMessage.safeParse({
        type: "DATETIME",
        meta: {},
        payload: { timestamp: "not-a-date" },
      });
      expect(invalidResult.success).toBe(false);
    });

    it("should validate ISO timestamps with seconds", () => {
      const TimestampMessage = message("TIMESTAMP", {
        timestamp: v.pipe(v.string(), v.isoTimestamp()),
      });

      const validResult = TimestampMessage.safeParse({
        type: "TIMESTAMP",
        meta: {},
        payload: { timestamp: "2024-01-01T00:00:00Z" },
      });
      expect(validResult.success).toBe(true);
    });
  });

  describe("Decimal validation (v.decimal)", () => {
    it("should validate valid decimal values", () => {
      const PriceMessage = message("PRICE", {
        amount: v.pipe(v.string(), v.decimal()),
      });

      const validResult = PriceMessage.safeParse({
        type: "PRICE",
        meta: {},
        payload: { amount: "99.99" },
      });
      expect(validResult.success).toBe(true);
    });

    it("should reject invalid decimal values", () => {
      const PriceMessage = message("PRICE", {
        amount: v.pipe(v.string(), v.decimal()),
      });

      const invalidResult = PriceMessage.safeParse({
        type: "PRICE",
        meta: {},
        payload: { amount: "not-a-number" },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("Complex nested validation", () => {
    it("should handle complex nested schemas with multiple validators", () => {
      const ComplexMessage = message("COMPLEX", {
        user: v.object({
          id: v.pipe(v.string(), v.uuid()),
          email: v.pipe(v.string(), v.email()),
          profile: v.object({
            name: v.string(),
            website: v.optional(v.pipe(v.string(), v.url())),
          }),
        }),
        registeredAt: v.pipe(v.string(), v.isoTimestamp()),
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
        user: v.object({
          id: v.pipe(v.string(), v.uuid()),
          email: v.pipe(v.string(), v.email()),
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
