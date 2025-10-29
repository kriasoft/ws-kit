// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type inference tests for typed Valibot router.
 *
 * These tests verify that the createValibotRouter factory provides proper
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

import { createValibotRouter, createMessageSchema } from "@ws-kit/valibot";
import * as v from "valibot";
import { expectTypeOf } from "expect-type";

describe("Type inference in createValibotRouter handlers", () => {
  const { messageSchema } = createMessageSchema(v);

  // ==================================================================================
  // Payload Inference Tests
  // ==================================================================================

  describe("Payload type inference (schemas with payload)", () => {
    it("should infer simple object payload", () => {
      const LoginSchema = messageSchema("LOGIN", {
        username: v.string(),
        password: v.string(),
      });

      const router = createValibotRouter();

      // Register handler and verify types within the handler
      router.onMessage(LoginSchema, (ctx) => {
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
      const UserSchema = messageSchema("USER:UPDATE", {
        id: v.string(),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
      });

      const router = createValibotRouter();

      router.onMessage(UserSchema, (ctx) => {
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
      const PostSchema = messageSchema("POST:CREATE", {
        title: v.string(),
        content: v.string(),
        author: v.object({
          id: v.string(),
          name: v.string(),
        }),
        tags: v.array(v.string()),
      });

      const router = createValibotRouter();

      router.onMessage(PostSchema, (ctx) => {
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
      const ActionSchema = messageSchema("ACTION", {
        action: v.union([
          v.literal("start"),
          v.literal("stop"),
          v.literal("pause"),
        ]),
        duration: v.optional(v.number()),
      });

      const router = createValibotRouter();

      router.onMessage(ActionSchema, (ctx) => {
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
      const PingSchema = messageSchema("PING");

      const router = createValibotRouter();

      router.onMessage(PingSchema, (ctx) => {
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
      const PingEmptySchema = messageSchema("PING_EMPTY", {});

      const router = createValibotRouter();

      router.onMessage(PingEmptySchema, (ctx) => {
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
      const ConnectSchema = messageSchema("CONNECT", {
        version: v.string(),
      });

      const router = createValibotRouter();

      router.onMessage(ConnectSchema, (ctx) => {
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
      const LoginSchema = messageSchema("LOGIN", { username: v.string() });
      const LogoutSchema = messageSchema("LOGOUT");

      const router = createValibotRouter();

      router.onMessage(LoginSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGIN">();
      });

      router.onMessage(LogoutSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGOUT">();
      });
    });
  });

  // ==================================================================================
  // Meta Field Inference Tests
  // ==================================================================================

  describe("Metadata field inference", () => {
    it("should infer base metadata fields", () => {
      const MessageSchema = messageSchema("MESSAGE", {
        text: v.string(),
      });

      const router = createValibotRouter();

      router.onMessage(MessageSchema, (ctx) => {
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
      const RoomMessageSchema = messageSchema(
        "ROOM:MESSAGE",
        { text: v.string() },
        { roomId: v.string(), priority: v.optional(v.number()) },
      );

      const router = createValibotRouter();

      router.onMessage(RoomMessageSchema, (ctx) => {
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
      const InfoSchema = messageSchema("INFO", { message: v.string() });

      const router = createValibotRouter();

      router.onMessage(InfoSchema, (ctx) => {
        const AckSchema = messageSchema("ACK", { success: v.boolean() });

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
      const DoneSchema = messageSchema("DONE");

      const router = createValibotRouter();

      router.onMessage(DoneSchema, (ctx) => {
        const AckSchema = messageSchema("ACK");

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
      const ChatSchema = messageSchema(
        "CHAT",
        { text: v.string() },
        { roomId: v.string() },
      );

      const router = createValibotRouter();

      router.onMessage(ChatSchema, (ctx) => {
        const ReplySchema = messageSchema(
          "REPLY",
          { text: v.string() },
          { roomId: v.string() },
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
      const AuthSchema = messageSchema("AUTH", {
        token: v.string(),
      });
      const ChatSchema = messageSchema("CHAT", {
        message: v.string(),
      });

      const authRouter = createValibotRouter();
      authRouter.onMessage(AuthSchema, (ctx) => {
        expectTypeOf(ctx.payload.token).toBeString();
      });

      const chatRouter = createValibotRouter();
      chatRouter.onMessage(ChatSchema, (ctx) => {
        expectTypeOf(ctx.payload.message).toBeString();
      });

      // Compose routers
      const mainRouter = createValibotRouter();
      mainRouter.addRoutes(authRouter);
      mainRouter.addRoutes(chatRouter);

      // Types should still work on the main router
      expectTypeOf(mainRouter).toMatchTypeOf<{ _core: any }>();
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

      const dataRouter = createValibotRouter<UserData>();
      const AuthSchema = messageSchema("AUTH", { token: v.string() });

      dataRouter.onMessage(AuthSchema, (ctx) => {
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
