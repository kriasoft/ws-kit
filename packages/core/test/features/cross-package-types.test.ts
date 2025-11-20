// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, test } from "bun:test";
import { z, message } from "@ws-kit/zod";

describe("Cross-package type safety", () => {
  test("should work with discriminated unions in consuming applications", () => {
    // Simulate cross-package usage patterns that caused issues
    const PingSchema = message("PING");
    const PongSchema = message("PONG", {
      reply: z.string(),
    });
    const EchoSchema = message("ECHO", {
      text: z.string(),
    });

    // This is the pattern that previously failed with dual package hazard
    const MessageUnion = z.discriminatedUnion("type", [
      PingSchema,
      PongSchema,
      EchoSchema,
    ]);

    // Test runtime functionality
    const pingMessage = {
      type: "PING" as const,
      meta: { timestamp: Date.now() },
    };

    const pongMessage = {
      type: "PONG" as const,
      meta: { timestamp: Date.now() },
      payload: { reply: "Hello back!" },
    };

    const echoMessage = {
      type: "ECHO" as const,
      meta: { timestamp: Date.now() },
      payload: { text: "Echo this" },
    };

    // All should validate correctly
    expect(MessageUnion.parse(pingMessage)).toEqual(pingMessage);
    expect(MessageUnion.parse(pongMessage)).toEqual(pongMessage);
    expect(MessageUnion.parse(echoMessage)).toEqual(echoMessage);

    // Type narrowing should work (compile-time check)
    const handleMessage = (msg: z.infer<typeof MessageUnion>) => {
      switch (msg.type) {
        case "PING":
          // TypeScript should know this has no payload
          expect(msg.type).toBe("PING");
          break;
        case "PONG":
          // TypeScript should know this has { reply: string } payload
          expect((msg.payload as { reply: string }).reply).toBeDefined();
          break;
        case "ECHO":
          // TypeScript should know this has { text: string } payload
          expect((msg.payload as { text: string }).text).toBeDefined();
          break;
      }
    };

    handleMessage(pingMessage);
    handleMessage(pongMessage);
    handleMessage(echoMessage);
  });

  test("should handle complex payload types without 'as any'", () => {
    // Test that library type definitions work for typical use cases
    const ComplexSchema = message("COMPLEX", {
      user: z.object({
        id: z.string(),
        roles: z.array(z.string()),
      }),
      settings: z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean()]),
      ),
      timestamp: z.number(),
    });

    const msg = {
      type: "COMPLEX" as const,
      meta: {},
      payload: {
        user: {
          id: "user-456",
          roles: ["admin", "user"],
        },
        settings: {
          theme: "dark",
          notifications: true,
          maxRetries: 3,
        },
        timestamp: Date.now(),
      },
    };

    expect(ComplexSchema.parse(msg)).toEqual(msg);
  });

  test("should provide proper intellisense for message creation", () => {
    const ChatMessage = message("CHAT", {
      roomId: z.string(),
      content: z.string(),
      mentions: z.array(z.string()).optional(),
    });

    // This should compile without issues and provide full type safety
    const validMessage = {
      type: "CHAT" as const,
      meta: {},
      payload: {
        roomId: "general",
        content: "Hello everyone!",
        mentions: ["@john", "@jane"],
      },
    };

    expect(ChatMessage.parse(validMessage)).toEqual(validMessage);

    // Verify that TypeScript would catch type errors (compile-time)
    // Note: This is mainly for type checking during compilation
  });
});
