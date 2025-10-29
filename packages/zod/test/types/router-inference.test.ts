// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type inference tests for typed Zod router.
 *
 * These tests verify that the createRouter factory provides proper
 * TypeScript type inference for message handlers, eliminating the need
 * for manual type assertions like `(ctx.payload as any)`.
 *
 * Tests are organized by inference scenarios:
 * - Payload inference (schemas with payload)
 * - No-payload handling (schemas without payload)
 * - Meta field inference
 * - Message type literal inference
 * - Send function inference
 */

import { createRouter, message, z } from "@ws-kit/zod";
import { expectTypeOf } from "expect-type";

describe("Type inference in createRouter handlers", () => {
  // ==================================================================================
  // Payload Inference Tests
  // ==================================================================================

  describe("Payload type inference (schemas with payload)", () => {
    it("should infer simple object payload", () => {
      const LoginSchema = message("LOGIN", {
        username: z.string(),
        password: z.string(),
      });

      const router = createRouter();

      // Register handler and verify types within the handler
      router.on(LoginSchema, (ctx) => {
        // ctx.payload should be typed as { username: string; password: string }
        expectTypeOf(ctx.payload).toMatchTypeOf<{
          username: string;
          password: string;
        }>();

        // Should allow accessing properties without type assertions
        const username = ctx.payload.username;
        expectTypeOf(username).toBeString();

        const password = ctx.payload.password;
        expectTypeOf(password).toBeString();

        // Should NOT allow accessing undefined properties
        // @ts-expect-error - missing property
        ctx.payload.nonexistent;
      });
    });

    it("should infer payload with optional fields", () => {
      const UserSchema = message("USER:UPDATE", {
        id: z.string(),
        name: z.string().optional(),
        email: z.string().optional(),
      });

      const router = createRouter();

      router.on(UserSchema, (ctx) => {
        expectTypeOf(ctx.payload).toMatchTypeOf<{
          id: string;
          name?: string;
          email?: string;
        }>();

        // Required fields must be present
        const id = ctx.payload.id;
        expectTypeOf(id).toBeString();

        // Optional fields are optional
        const name = ctx.payload.name;
        expectTypeOf(name).toEqualTypeOf<string | undefined>();

        const email = ctx.payload.email;
        expectTypeOf(email).toEqualTypeOf<string | undefined>();
      });
    });

    it("should infer nested object payloads", () => {
      const PostSchema = message("POST:CREATE", {
        title: z.string(),
        content: z.string(),
        author: z.object({
          id: z.string(),
          name: z.string(),
        }),
        tags: z.array(z.string()),
      });

      const router = createRouter();

      router.on(PostSchema, (ctx) => {
        expectTypeOf(ctx.payload).toMatchTypeOf<{
          title: string;
          content: string;
          author: { id: string; name: string };
          tags: string[];
        }>();

        const author = ctx.payload.author;
        expectTypeOf(author).toMatchTypeOf<{ id: string; name: string }>();

        const tags = ctx.payload.tags;
        expectTypeOf(tags).toEqualTypeOf<string[]>();
      });
    });

    it("should infer union type payloads", () => {
      const ActionSchema = message("ACTION", {
        action: z.union([
          z.literal("start"),
          z.literal("stop"),
          z.literal("pause"),
        ]),
        duration: z.number().optional(),
      });

      const router = createRouter();

      router.on(ActionSchema, (ctx) => {
        expectTypeOf(ctx.payload.action).toEqualTypeOf<
          "start" | "stop" | "pause"
        >();

        // TypeScript can narrow unions
        if (ctx.payload.action === "start") {
          expectTypeOf(ctx.payload.action).toEqualTypeOf<"start">();
        }
      });
    });
  });

  // ==================================================================================
  // No-Payload Schema Tests
  // ==================================================================================

  describe("No-payload schema handling", () => {
    it("should NOT have payload field for empty schemas", () => {
      const PingSchema = message("PING");

      const router = createRouter();

      router.on(PingSchema, (ctx) => {
        // payload should not exist at all
        // @ts-expect-error - payload should not be available
        ctx.payload;

        // Type should be Record<string, never> (no properties)
        expectTypeOf(ctx).toMatchTypeOf<{
          ws: any;
          type: "PING";
          meta: any;
          send: any;
        }>();
      });
    });

    it("should NOT have payload field for schemas with only empty object", () => {
      const PingEmptySchema = message("PING_EMPTY", {});

      const router = createRouter();

      router.on(PingEmptySchema, (ctx) => {
        // @ts-expect-error - payload should not be available
        ctx.payload;
      });
    });
  });

  // ==================================================================================
  // Message Type Literal Inference Tests
  // ==================================================================================

  describe("Message type literal inference", () => {
    it("should infer message type as literal", () => {
      const ConnectSchema = message("CONNECT", {
        version: z.string(),
      });

      const router = createRouter();

      router.on(ConnectSchema, (ctx) => {
        // ctx.type should be literal "CONNECT", not string
        expectTypeOf(ctx.type).toEqualTypeOf<"CONNECT">();

        // Should allow literal type guards
        if (ctx.type === "CONNECT") {
          expectTypeOf(ctx.type).toEqualTypeOf<"CONNECT">();
        }

        // Should NOT allow other values
        // @ts-expect-error - type is not "OTHER"
        if (ctx.type === "OTHER") {
          // ...
        }
      });
    });

    it("should preserve distinct literal types across handlers", () => {
      const LoginSchema = message("LOGIN", { username: z.string() });
      const LogoutSchema = message("LOGOUT");

      const router = createRouter();

      router.on(LoginSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGIN">();
      });

      router.on(LogoutSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGOUT">();
      });
    });
  });

  // ==================================================================================
  // Meta Field Inference Tests
  // ==================================================================================

  describe("Metadata field inference", () => {
    it("should infer base metadata fields", () => {
      const MessageSchema = message("MESSAGE", {
        text: z.string(),
      });

      const router = createRouter();

      router.on(MessageSchema, (ctx) => {
        // Should have base meta fields
        expectTypeOf(ctx.meta).toMatchTypeOf<{
          timestamp?: number;
          correlationId?: string;
        }>();

        const timestamp = ctx.meta.timestamp;
        expectTypeOf(timestamp).toEqualTypeOf<number | undefined>();

        const correlationId = ctx.meta.correlationId;
        expectTypeOf(correlationId).toEqualTypeOf<string | undefined>();
      });
    });

    it("should infer extended meta fields", () => {
      const RoomMessageSchema = message(
        "ROOM:MESSAGE",
        { text: z.string() },
        { roomId: z.string(), priority: z.number().optional() },
      );

      const router = createRouter();

      router.on(RoomMessageSchema, (ctx) => {
        // Should include extended meta fields
        expectTypeOf(ctx.meta).toMatchTypeOf<{
          timestamp?: number;
          correlationId?: string;
          roomId: string;
          priority?: number;
        }>();

        const roomId = ctx.meta.roomId;
        expectTypeOf(roomId).toBeString();

        const priority = ctx.meta.priority;
        expectTypeOf(priority).toEqualTypeOf<number | undefined>();
      });
    });
  });

  // ==================================================================================
  // Send Function Inference Tests
  // ==================================================================================

  describe("Send function overloads", () => {
    it("should require payload for send() when schema has payload", () => {
      const InfoSchema = message("INFO", { message: z.string() });

      const router = createRouter();

      router.on(InfoSchema, (ctx) => {
        const AckSchema = message("ACK", { success: z.boolean() });

        // Should allow sending with payload
        ctx.send(AckSchema, { success: true });

        // Should NOT allow sending without payload
        // @ts-expect-error - payload is required
        ctx.send(AckSchema);

        // Should NOT allow sending with wrong payload shape
        // @ts-expect-error - success must be boolean
        ctx.send(AckSchema, { success: "true" });
      });
    });

    it("should NOT allow payload for send() when schema has no payload", () => {
      const DoneSchema = message("DONE");

      const router = createRouter();

      router.on(DoneSchema, (ctx) => {
        const AckSchema = message("ACK");

        // Should allow sending without payload
        ctx.send(AckSchema);

        // Should NOT allow payload
        // @ts-expect-error - payload should not be provided
        ctx.send(AckSchema, {});

        // @ts-expect-error - payload should not be provided
        ctx.send(AckSchema, { any: "thing" });
      });
    });

    it("should handle send() with extended meta", () => {
      const ChatSchema = message(
        "CHAT",
        { text: z.string() },
        { roomId: z.string() },
      );

      const router = createRouter();

      router.on(ChatSchema, (ctx) => {
        const ReplySchema = message(
          "REPLY",
          { text: z.string() },
          { roomId: z.string() },
        );

        // Should allow send with required extended meta
        ctx.send(
          ReplySchema,
          { text: "Hello" },
          { meta: { roomId: "general" } },
        );

        // Should NOT allow without required extended meta
        // @ts-expect-error - roomId is required in meta
        ctx.send(ReplySchema, { text: "Hello" });

        // Should NOT allow wrong extended meta type
        // @ts-expect-error - roomId must be string
        ctx.send(ReplySchema, { text: "Hello" }, { meta: { roomId: 123 } });
      });
    });
  });

  // ==================================================================================
  // Router Composition Tests
  // ==================================================================================

  describe("Router composition type preservation", () => {
    it("should preserve types when composing routers", () => {
      const AuthSchema = message("AUTH", {
        token: z.string(),
      });
      const ChatSchema = message("CHAT", {
        message: z.string(),
      });

      const authRouter = createRouter();
      authRouter.on(AuthSchema, (ctx) => {
        expectTypeOf(ctx.payload.token).toBeString();
      });

      const chatRouter = createRouter();
      chatRouter.on(ChatSchema, (ctx) => {
        expectTypeOf(ctx.payload.message).toBeString();
      });

      // Compose routers
      const mainRouter = createRouter();
      mainRouter.merge(authRouter);
      mainRouter.merge(chatRouter);

      // Types should still work on the main router
      expectTypeOf(mainRouter).toMatchTypeOf<{ [key: symbol]: any }>();
    });
  });

  // ==================================================================================
  // Connection Data Type Tests
  // ==================================================================================

  describe("WebSocket connection data typing", () => {
    it("should support custom connection data types", () => {
      interface UserData {
        userId: string;
        roles: string[];
      }

      const dataRouter = createRouter<UserData>();
      const AuthSchema = message("AUTH", { token: z.string() });

      dataRouter.on(AuthSchema, (ctx) => {
        // ctx.ws.data should be typed as UserData
        expectTypeOf(ctx.ws.data).toMatchTypeOf<UserData>();

        const userId = ctx.ws.data?.userId;
        expectTypeOf(userId).toEqualTypeOf<string | undefined>();

        const roles = ctx.ws.data?.roles;
        expectTypeOf(roles).toEqualTypeOf<string[] | undefined>();
      });
    });
  });
});
