// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type inference tests for Valibot router composition with addRoutes.
 *
 * Mirrors the Zod composition tests to ensure both validator adapters
 * provide equivalent type safety and inference capabilities.
 *
 * These tests verify that:
 * 1. addRoutes preserves message type unions across composed routers
 * 2. Middleware from both routers are properly inherited
 * 3. Context data types are preserved in composed routers
 * 4. Message handlers maintain type safety when routers are composed
 * 5. Send function works correctly with composed message types
 *
 * Tests are run via `tsc --noEmit` to verify type safety.
 */

import { createRouter, message, v } from "@ws-kit/valibot";
import { expectTypeOf } from "expect-type";

describe("Valibot router composition with addRoutes", () => {
  // ==================================================================================
  // Message Union Preservation
  // ==================================================================================

  describe("Message union preservation in composition", () => {
    it("should preserve both routers' message types", () => {
      const AuthSchema = message("AUTH", {
        token: v.pipe(v.string()),
      });

      const ChatSchema = message("CHAT", {
        text: v.pipe(v.string()),
      });

      const authRouter = createRouter();
      authRouter.onMessage(AuthSchema, (ctx) => {
        expectTypeOf(ctx.payload.token).toBeString();
      });

      const chatRouter = createRouter();
      chatRouter.onMessage(ChatSchema, (ctx) => {
        expectTypeOf(ctx.payload.text).toBeString();
      });

      const mainRouter = createRouter();
      mainRouter.addRoutes(authRouter);
      mainRouter.addRoutes(chatRouter);

      // Main router should still have proper types when creating new handlers
      const PingSchema = message("PING");
      mainRouter.onMessage(PingSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"PING">();
      });
    });

    it("should handle multiple message schemas in composed routers", () => {
      const LoginSchema = message("LOGIN", { username: v.pipe(v.string()) });
      const LogoutSchema = message("LOGOUT");

      const authRouter = createRouter();
      authRouter.onMessage(LoginSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGIN">();
        expectTypeOf(ctx.payload.username).toBeString();
      });
      authRouter.onMessage(LogoutSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"LOGOUT">();
      });

      const SendSchema = message("SEND", { message: v.pipe(v.string()) });
      const chatRouter = createRouter();
      chatRouter.onMessage(SendSchema, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"SEND">();
        expectTypeOf(ctx.payload.message).toBeString();
      });

      const mainRouter = createRouter();
      mainRouter.addRoutes(authRouter).addRoutes(chatRouter);

      // All message types should be handleable
      expectTypeOf(mainRouter).toMatchTypeOf<{ addRoutes: any }>();
    });
  });

  // ==================================================================================
  // Middleware Inheritance in Composition
  // ==================================================================================

  describe("Middleware inheritance across composed routers", () => {
    it("should merge middleware from all routers", () => {
      const TestSchema = message("TEST", { value: v.pipe(v.string()) });

      const router1 = createRouter();
      router1.use((ctx, next) => {
        // Global middleware in router1
        return next();
      });

      const router2 = createRouter();
      router2.use((ctx, next) => {
        // Global middleware in router2
        return next();
      });
      router2.onMessage(TestSchema, (ctx) => {
        expectTypeOf(ctx.payload.value).toBeString();
      });

      const mainRouter = createRouter();
      mainRouter.addRoutes(router1).addRoutes(router2);

      // Main router should have merged middleware
      expectTypeOf(mainRouter).toHaveProperty("use");
      expectTypeOf(mainRouter.use).toBeFunction();
    });

    it("should preserve per-route middleware after composition", () => {
      const MessageSchema = message("MESSAGE", { text: v.pipe(v.string()) });

      const router1 = createRouter();
      // Per-route middleware for MESSAGE in router1
      router1.use(MessageSchema, (ctx, next) => {
        return next();
      });
      router1.onMessage(MessageSchema, (ctx) => {
        expectTypeOf(ctx.payload.text).toBeString();
      });

      const router2 = createRouter();

      const mainRouter = createRouter();
      mainRouter.addRoutes(router1).addRoutes(router2);

      // Should still be able to use schema for per-route middleware in main router
      mainRouter.use(MessageSchema, (ctx, next) => {
        return next();
      });

      expectTypeOf(mainRouter).toHaveProperty("use");
    });
  });

  // ==================================================================================
  // Context Data Type Preservation
  // ==================================================================================

  describe("Connection data type preservation in composition", () => {
    it("should preserve data type across all composed routers", () => {
      interface AppData {
        userId?: string;
        roles?: string[];
      }

      const AuthSchema = message("AUTH", { token: v.pipe(v.string()) });
      const ChatSchema = message("CHAT", { text: v.pipe(v.string()) });

      const authRouter = createRouter<AppData>();
      authRouter.onMessage(AuthSchema, (ctx) => {
        expectTypeOf(ctx.ws.data.userId).toEqualTypeOf<string | undefined>();
        expectTypeOf(ctx.ws.data.roles).toEqualTypeOf<string[] | undefined>();
      });

      const chatRouter = createRouter<AppData>();
      chatRouter.onMessage(ChatSchema, (ctx) => {
        expectTypeOf(ctx.ws.data.userId).toEqualTypeOf<string | undefined>();
        expectTypeOf(ctx.ws.data.roles).toEqualTypeOf<string[] | undefined>();
      });

      const mainRouter = createRouter<AppData>();
      mainRouter.addRoutes(authRouter).addRoutes(chatRouter);

      // Main router handlers should have same AppData type
      const StatusSchema = message("STATUS");
      mainRouter.onMessage(StatusSchema, (ctx) => {
        expectTypeOf(ctx.ws.data).toMatchTypeOf<AppData>();
      });
    });

    it("should allow middleware to modify shared data across routers", () => {
      interface SessionData {
        sessionId?: string;
        isValid?: boolean;
      }

      const router1 = createRouter<SessionData>();
      router1.use((ctx, next) => {
        ctx.ws.data.sessionId = "session-123";
        return next();
      });

      const router2 = createRouter<SessionData>();
      router2.use((ctx, next) => {
        if (ctx.ws.data.sessionId) {
          ctx.ws.data.isValid = true;
        }
        return next();
      });

      const mainRouter = createRouter<SessionData>();
      mainRouter.addRoutes(router1).addRoutes(router2);

      mainRouter.use((ctx, next) => {
        expectTypeOf(ctx.ws.data.sessionId).toEqualTypeOf<string | undefined>();
        expectTypeOf(ctx.ws.data.isValid).toEqualTypeOf<boolean | undefined>();
        return next();
      });
    });
  });

  // ==================================================================================
  // Send Function Type Safety in Composition
  // ==================================================================================

  describe("Send function in composed routers", () => {
    it("should type send correctly in handlers from composed routers", () => {
      const RequestSchema = message("REQUEST", { query: v.pipe(v.string()) });
      const ResponseSchema = message("RESPONSE", {
        result: v.pipe(v.string()),
      });

      const router1 = createRouter();
      router1.onMessage(RequestSchema, (ctx) => {
        // Should be able to send ResponseSchema from composed router
        ctx.send(ResponseSchema, { result: "done" });
      });

      const router2 = createRouter();
      const AckSchema = message("ACK");
      router2.onMessage(AckSchema, (ctx) => {
        // Should be able to send any message schema
        ctx.send(ResponseSchema, { result: "ack" });
      });

      const mainRouter = createRouter();
      mainRouter.addRoutes(router1).addRoutes(router2);

      // Main router handlers can also send these schemas
      mainRouter.onMessage(RequestSchema, (ctx) => {
        ctx.send(ResponseSchema, { result: "composed" });
      });
    });

    it("should enforce payload requirements in composed context", () => {
      const PayloadSchema = message("WITH_PAYLOAD", {
        data: v.pipe(v.string()),
      });
      const NoPayloadSchema = message("NO_PAYLOAD");

      const router = createRouter();
      router.onMessage(PayloadSchema, (ctx) => {
        const ReplySchema = message("REPLY", { status: v.pipe(v.string()) });

        // Should require payload
        ctx.send(ReplySchema, { status: "ok" });

        // Should NOT allow missing payload
        // @ts-expect-error - payload required for ReplySchema
        ctx.send(ReplySchema);

        // Should handle no-payload schemas
        ctx.send(NoPayloadSchema);

        // Should NOT allow payload for no-payload schema
        // @ts-expect-error - payload not allowed for NoPayloadSchema
        ctx.send(NoPayloadSchema, {});
      });

      const mainRouter = createRouter();
      mainRouter.addRoutes(router);

      expectTypeOf(mainRouter).toHaveProperty("onMessage");
    });
  });

  // ==================================================================================
  // Handler Specificity in Composition
  // ==================================================================================

  describe("Handler specificity preservation", () => {
    it("should preserve payload type in composed router handlers", () => {
      const UserSchema = message("USER:UPDATE", {
        id: v.pipe(v.string()),
        name: v.optional(v.pipe(v.string())),
      });

      const userRouter = createRouter();
      userRouter.onMessage(UserSchema, (ctx) => {
        expectTypeOf(ctx.payload).toMatchTypeOf<{
          id: string;
          name?: string;
        }>();

        // id is required
        const id = ctx.payload.id;
        expectTypeOf(id).toBeString();

        // name is optional
        const name = ctx.payload.name;
        expectTypeOf(name).toEqualTypeOf<string | undefined>();
      });

      const mainRouter = createRouter();
      mainRouter.addRoutes(userRouter);

      // Types should still be preserved after composition
      mainRouter.onMessage(UserSchema, (ctx) => {
        expectTypeOf(ctx.payload.id).toBeString();
        expectTypeOf(ctx.payload.name).toEqualTypeOf<string | undefined>();
      });
    });

    it("should preserve nested object types in composition", () => {
      const ComplexSchema = message("COMPLEX", {
        metadata: v.object({
          version: v.pipe(v.number()),
          tags: v.pipe(v.array(v.pipe(v.string()))),
        }),
      });

      const complexRouter = createRouter();
      complexRouter.onMessage(ComplexSchema, (ctx) => {
        const version = ctx.payload.metadata.version;
        expectTypeOf(version).toBeNumber();

        const tags = ctx.payload.metadata.tags;
        expectTypeOf(tags).toEqualTypeOf<string[]>();
      });

      const mainRouter = createRouter();
      mainRouter.addRoutes(complexRouter);

      expectTypeOf(mainRouter).toHaveProperty("onMessage");
    });
  });

  // ==================================================================================
  // Chained Composition
  // ==================================================================================

  describe("Chained addRoutes calls", () => {
    it("should support chaining multiple addRoutes calls", () => {
      const Schema1 = message("MSG1", { data: v.pipe(v.string()) });
      const Schema2 = message("MSG2", { value: v.pipe(v.number()) });
      const Schema3 = message("MSG3", { active: v.pipe(v.boolean()) });

      const router1 = createRouter();
      router1.onMessage(Schema1, (ctx) => {
        expectTypeOf(ctx.payload.data).toBeString();
      });

      const router2 = createRouter();
      router2.onMessage(Schema2, (ctx) => {
        expectTypeOf(ctx.payload.value).toBeNumber();
      });

      const router3 = createRouter();
      router3.onMessage(Schema3, (ctx) => {
        expectTypeOf(ctx.payload.active).toBeBoolean();
      });

      // Should support chaining
      const mainRouter = createRouter()
        .addRoutes(router1)
        .addRoutes(router2)
        .addRoutes(router3);

      expectTypeOf(mainRouter).toHaveProperty("addRoutes");
      expectTypeOf(mainRouter.addRoutes).toBeFunction();
    });

    it("should return this for method chaining", () => {
      const router1 = createRouter();
      const router2 = createRouter();

      const mainRouter = createRouter();
      const result = mainRouter.addRoutes(router1).addRoutes(router2);

      // Should return the same router instance (typed as this)
      expectTypeOf(result).toMatchTypeOf<typeof mainRouter>();
    });
  });

  // ==================================================================================
  // Intersection of Features
  // ==================================================================================

  describe("Intersection of composed router features", () => {
    it("should combine middleware, handlers, and data types", () => {
      interface TrackingData {
        requestId?: string;
      }

      const QuerySchema = message("QUERY", { sql: v.pipe(v.string()) });
      const ResultSchema = message("RESULT", { rows: v.pipe(v.number()) });

      // Router 1: Tracking middleware + handler
      const queryRouter = createRouter<TrackingData>();
      queryRouter.use((ctx, next) => {
        ctx.ws.data.requestId = Math.random().toString();
        return next();
      });
      queryRouter.onMessage(QuerySchema, (ctx) => {
        expectTypeOf(ctx.ws.data.requestId).toEqualTypeOf<string | undefined>();
        expectTypeOf(ctx.payload.sql).toBeString();
      });

      // Router 2: Logging middleware + different handler
      const resultRouter = createRouter<TrackingData>();
      resultRouter.use((ctx, next) => {
        console.log(ctx.ws.data.requestId);
        return next();
      });
      resultRouter.onMessage(ResultSchema, (ctx) => {
        expectTypeOf(ctx.ws.data.requestId).toEqualTypeOf<string | undefined>();
        expectTypeOf(ctx.payload.rows).toBeNumber();
      });

      // Composed router: Has both middleware and handlers
      const mainRouter = createRouter<TrackingData>();
      mainRouter.addRoutes(queryRouter).addRoutes(resultRouter);

      // Can use new handlers with inherited data type
      mainRouter.onMessage(QuerySchema, (ctx) => {
        expectTypeOf(ctx.ws.data.requestId).toEqualTypeOf<string | undefined>();
      });
    });
  });
});
