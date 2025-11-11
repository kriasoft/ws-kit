// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Schema Detection Test
 *
 * Verifies that message() correctly handles raw shape objects ({ field: v.type() }).
 * Note: Valibot doesn't support pre-built schema objects as payload (Zod does),
 * so we test the raw shape path only.
 */

import { describe, it, expect } from "bun:test";
import * as v from "valibot";
import { message } from "@ws-kit/valibot";

describe("Raw Shape Objects", () => {
  it("should accept raw shape { field: v.type() }", () => {
    const RawMessage = message("RAW", {
      title: v.string(),
      count: v.number(),
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
      id: v.string(),
    });

    // Extra properties should be rejected (strict mode)
    const result = RawMessage.safeParse({
      type: "RAW",
      meta: {},
      payload: { id: "1", extra: "field" },
    });

    expect(result.success).toBe(false);
  });

  it("should accept raw nested shape", () => {
    const NestedMessage = message("NESTED", {
      user: v.object({
        id: v.string(),
        name: v.string(),
      }),
    });

    const result = NestedMessage.safeParse({
      type: "NESTED",
      meta: {},
      payload: { user: { id: "1", name: "Bob" } },
    });

    expect(result.success).toBe(true);
  });

  it("should validate with Valibot validators", () => {
    const ValidatedMessage = message("VALIDATED", {
      email: v.pipe(v.string(), v.email()),
      website: v.optional(v.pipe(v.string(), v.url())),
    });

    const validResult = ValidatedMessage.safeParse({
      type: "VALIDATED",
      meta: {},
      payload: {
        email: "test@example.com",
        website: "https://example.com",
      },
    });

    expect(validResult.success).toBe(true);

    const invalidResult = ValidatedMessage.safeParse({
      type: "VALIDATED",
      meta: {},
      payload: {
        email: "not-an-email",
        website: "not-a-url",
      },
    });

    expect(invalidResult.success).toBe(false);
  });
});

describe("Empty Messages", () => {
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
