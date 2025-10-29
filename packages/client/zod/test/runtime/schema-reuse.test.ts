// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Integration tests for @ws-kit/client/zod
 *
 * Verifies:
 * - Schema reuse from server-side definitions
 * - Type system integration with vanilla client
 * - No runtime type-checking (it's compile-time only)
 */

import { describe, expect, it } from "bun:test";
import { z, message } from "@ws-kit/zod";
import type { ZodWebSocketClient } from "../../src/index.js";

describe("@ws-kit/client/zod: Integration", () => {
  it("schema creation works correctly", () => {
    const HelloMessage = message("HELLO", { text: z.string() });

    expect(HelloMessage).toBeDefined();
    expect(HelloMessage.shape.type.value).toBe("HELLO");
    expect(HelloMessage.shape.payload).toBeDefined();
  });

  it("multiple schemas can be created", () => {
    const Messages = {
      HELLO: message("HELLO", { text: z.string() }),
      PING: message("PING"),
      PONG: message("PONG", { latency: z.number() }),
    };

    expect(Messages.HELLO.shape.type.value).toBe("HELLO");
    expect(Messages.PING.shape.type.value).toBe("PING");
    expect(Messages.PONG.shape.type.value).toBe("PONG");
  });

  it("complex schemas with nested types work", () => {
    const UserMessage = message("USER", {
      id: z.number(),
      name: z.string(),
      email: z.string().email(),
      age: z.number().optional(),
      tags: z.array(z.string()),
    });

    expect(UserMessage.shape.type.value).toBe("USER");
    expect(UserMessage.shape.payload).toBeDefined();
  });

  it("schemas can be shared across modules", () => {
    // Simulate server/messages.ts
    const ServerMessages = {
      NOTIFICATION: message("NOTIFICATION", {
        title: z.string(),
        body: z.string(),
      }),
    };

    // Simulate client using the schema
    const NotificationSchema = ServerMessages.NOTIFICATION;

    expect(NotificationSchema.shape.type.value).toBe("NOTIFICATION");
  });

  it("discriminated union types are preserved", () => {
    const Messages = {
      SUCCESS: message("SUCCESS", { result: z.string() }),
      ERROR: message("ERROR", { message: z.string() }),
    };

    expect(Messages.SUCCESS.shape.type.value).toBe("SUCCESS");
    expect(Messages.ERROR.shape.type.value).toBe("ERROR");
  });

  it("schema payloads can be validated", () => {
    const UserMessage = message("USER", {
      id: z.number(),
      name: z.string(),
    });

    // Valid message
    const validMsg = {
      type: "USER",
      payload: { id: 123, name: "Alice" },
      meta: {},
    };

    const result = UserMessage.safeParse(validMsg);
    expect(result.success).toBe(true);
  });

  it("invalid messages fail validation", () => {
    const UserMessage = message("USER", {
      id: z.number(),
      name: z.string(),
    });

    // Invalid: missing required field
    const invalidMsg = {
      type: "USER",
      payload: { id: 123 }, // Missing name
      meta: {},
    };

    const result = UserMessage.safeParse(invalidMsg);
    expect(result.success).toBe(false);
  });
});
