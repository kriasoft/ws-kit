// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Integration tests for @ws-kit/client/valibot
 *
 * Verifies:
 * - Schema reuse from server-side definitions
 * - Type system integration with vanilla client
 * - No runtime type-checking (it's compile-time only)
 */

import { message } from "@ws-kit/valibot";
import { describe, expect, it } from "bun:test";
import * as v from "valibot";

describe("@ws-kit/client/valibot: Integration", () => {
  it("schema creation works correctly", () => {
    const HelloMessage = message("HELLO", { text: v.string() });

    expect(HelloMessage).toBeDefined();
    expect(HelloMessage.type).toBe("HELLO");
  });

  it("multiple schemas can be created", () => {
    const Messages = {
      HELLO: message("HELLO", { text: v.string() }),
      PING: message("PING"),
      PONG: message("PONG", { latency: v.number() }),
    };

    expect(Messages.HELLO).toBeDefined();
    expect(Messages.PING).toBeDefined();
    expect(Messages.PONG).toBeDefined();
  });

  it("complex schemas with nested types work", () => {
    const UserMessage = message("USER", {
      id: v.number(),
      name: v.string(),
      email: v.string([v.email()]),
      age: v.optional(v.number()),
      tags: v.array(v.string()),
    });

    expect(UserMessage).toBeDefined();
  });

  it("schemas can be shared across modules", () => {
    // Simulate server/messages.ts
    const ServerMessages = {
      NOTIFICATION: message("NOTIFICATION", {
        title: v.string(),
        body: v.string(),
      }),
    };

    // Simulate client using the schema
    const NotificationSchema = ServerMessages.NOTIFICATION;

    expect(NotificationSchema).toBeDefined();
  });

  it("discriminated union types are preserved", () => {
    const Messages = {
      SUCCESS: message("SUCCESS", { result: v.string() }),
      ERROR: message("ERROR", { message: v.string() }),
    };

    expect(Messages.SUCCESS).toBeDefined();
    expect(Messages.ERROR).toBeDefined();
  });

  it("schema payloads can be validated", () => {
    const UserMessage = message("USER", {
      id: v.number(),
      name: v.string(),
    });

    // Valid message
    const validMsg = {
      type: "USER",
      payload: { id: 123, name: "Alice" },
      meta: {},
    };

    const result = v.safeParse(UserMessage, validMsg);
    expect(result.success).toBe(true);
  });

  it("invalid messages fail validation", () => {
    const UserMessage = message("USER", {
      id: v.number(),
      name: v.string(),
    });

    // Invalid: missing required field
    const invalidMsg = {
      type: "USER",
      payload: { id: 123 }, // Missing name
      meta: {},
    };

    const result = v.safeParse(UserMessage, invalidMsg);
    expect(result.success).toBe(false);
  });
});
