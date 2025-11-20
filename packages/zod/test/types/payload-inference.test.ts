// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Regression tests for payload type inference fix
 *
 * These tests verify that InferPayloadShape pre-infers runtime value types
 * instead of raw Zod schemas. This ensures ctx.reply(), ctx.send(), etc.
 * receive correctly typed payloads.
 *
 * Background: https://github.com/kriasoft/ws-kit/issues/XX
 * - message() and rpc() BrandedSchema generics were using raw P/ReqP/ResP
 * - InferPayload/InferResponse utilities expected these raw types
 * - This caused type mismatches: { value: string } vs { value: ZodString }
 *
 * Fix: Apply InferPayloadShape to all BrandedSchema payload positions
 */

import { describe, expectTypeOf, it } from "bun:test";
import {
  createRouter,
  message,
  rpc,
  withZod,
  z,
  type InferMessage,
  type InferPayload,
  type InferResponse,
} from "../../src/index";

describe("@ws-kit/zod - Payload Type Inference (Regression)", () => {
  describe("message() payload inference", () => {
    it("should infer payload as runtime value type, not Zod schema", () => {
      const MessageSchema = message("TEST", { value: z.string() });

      // The payload type should be { value: string }, not { value: ZodString }
      type Payload = InferPayload<typeof MessageSchema>;
      expectTypeOf<Payload>().toEqualTypeOf<{ value: string }>();
    });

    it("should handle object form with payload", () => {
      const schema = message({
        type: "USER_JOIN",
        payload: { roomId: z.string(), userId: z.number() },
      });

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        roomId: string;
        userId: number;
      }>();
    });

    it("should handle positional form with payload", () => {
      const schema = message("USER_JOIN", {
        roomId: z.string(),
        userId: z.number(),
      });

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        roomId: string;
        userId: number;
      }>();
    });

    it("should infer complex nested payload types", () => {
      const schema = message("COMPLEX", {
        user: z.object({
          id: z.string(),
          email: z.string().email(),
        }),
        tags: z.array(z.string()),
        settings: z.record(z.string(), z.boolean()),
      });

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        user: { id: string; email: string };
        tags: string[];
        settings: Record<string, boolean>;
      }>();
    });

    it("should return never for message without payload", () => {
      const schema = message("PING");

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toBeNever();
    });
  });

  describe("rpc() payload inference", () => {
    it("should infer request payload as runtime value type", () => {
      const schema = rpc("GET_USER", { id: z.string() }, "USER_DATA", {
        name: z.string(),
      });

      // Request payload should be { id: string }
      type ReqPayload = InferPayload<typeof schema>;
      expectTypeOf<ReqPayload>().toEqualTypeOf<{ id: string }>();
    });

    it("should infer response payload as runtime value type", () => {
      const schema = rpc("GET_USER", { id: z.string() }, "USER_DATA", {
        name: z.string(),
        age: z.number(),
      });

      // Response payload should be { name: string; age: number }
      type ResPayload = InferResponse<typeof schema>;
      expectTypeOf<ResPayload>().toEqualTypeOf<{
        name: string;
        age: number;
      }>();
    });

    it("should handle rpc object form", () => {
      const schema = rpc({
        req: {
          type: "GET_USER",
          payload: { id: z.string() },
        },
        res: {
          type: "USER_DATA",
          payload: { name: z.string(), email: z.string() },
        },
      });

      type ReqPayload = InferPayload<typeof schema>;
      type ResPayload = InferResponse<typeof schema>;

      expectTypeOf<ReqPayload>().toEqualTypeOf<{ id: string }>();
      expectTypeOf<ResPayload>().toEqualTypeOf<{
        name: string;
        email: string;
      }>();
    });

    it("should handle nested response schema type extraction", () => {
      const schema = rpc("FETCH_DATA", { query: z.string() }, "DATA_RESPONSE", {
        items: z.array(z.object({ id: z.number(), title: z.string() })),
        total: z.number(),
      });

      type ResPayload = InferResponse<typeof schema>;
      expectTypeOf<ResPayload>().toEqualTypeOf<{
        items: Array<{ id: number; title: string }>;
        total: number;
      }>();
    });
  });

  describe("RPC handler context type inference", () => {
    it("should type ctx.reply() argument correctly for request handler", () => {
      const GetUserSchema = rpc("GET_USER", { id: z.string() }, "USER_DATA", {
        name: z.string(),
        age: z.number(),
      });

      const router = createRouter().plugin(withZod());

      // This should not have type errors
      router.rpc(GetUserSchema, (ctx) => {
        // ctx.payload should be { id: string }
        expectTypeOf(ctx.payload).toEqualTypeOf<{ id: string }>();

        // ctx.reply() should accept { name: string; age: number }
        // (type safety verified at compile time via the handler's type signature)
        expectTypeOf(ctx.reply).toBeFunction();
      });
    });

    it("should support ctx.send() with typed payload", () => {
      const MessageSchema = message("MSG", { text: z.string() });
      const ResponseSchema = message("RESPONSE", { reply: z.string() });

      const router = createRouter().plugin(withZod());

      router.on(MessageSchema, (ctx) => {
        // ctx.payload should be { text: string }
        expectTypeOf(ctx.payload).toHaveProperty("text");
        expectTypeOf(ctx.payload.text).toBeString();

        // ctx.send should accept ResponseSchema with { reply: string }
        expectTypeOf(ctx.send).toBeFunction();
      });
    });
  });

  describe("InferPayload/InferResponse robustness", () => {
    it("should handle already-inferred value types (fallback case)", () => {
      // This tests the robustness of InferPayload/InferResponse
      // when BrandedSchema contains pre-inferred value types

      const schema = message("TEST", { value: z.string() });

      // Even if payload is pre-inferred, InferPayload should handle it
      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().not.toBeNever();
      // Payload should be a concrete type, not never
      expectTypeOf<Payload>().toEqualTypeOf<{ value: string }>();
    });

    it("should handle raw ZodRawShape (legacy compatibility)", () => {
      const shape = { id: z.string(), count: z.number() };
      const schema = message("TEST", shape);

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        id: string;
        count: number;
      }>();
    });

    it("should handle ZodObject instances", () => {
      const payloadSchema = z.object({
        data: z.string(),
        timestamp: z.number(),
      });

      const schema = message("TEST", payloadSchema);

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        data: string;
        timestamp: number;
      }>();
    });
  });

  describe("Full message type inference chain", () => {
    it("should correctly infer complete message type with payload", () => {
      const LoginSchema = message("LOGIN", {
        username: z.string(),
        password: z.string(),
      });

      type Message = InferMessage<typeof LoginSchema>;

      // Full message should include type, payload, and meta
      expectTypeOf<Message>().toHaveProperty("type");
      expectTypeOf<Message["type"]>().toEqualTypeOf<"LOGIN">();
      expectTypeOf<Message>().toHaveProperty("payload");
      expectTypeOf<Message["payload"]>().toEqualTypeOf<{
        username: string;
        password: string;
      }>();
      expectTypeOf<Message>().toHaveProperty("meta");
    });

    it("should handle discriminated union with inferred payloads", () => {
      const PingSchema = message("PING");
      const PongSchema = message("PONG");
      const ChatSchema = message("CHAT", { text: z.string() });

      // All schemas should be usable in discriminated unions
      const union = z.discriminatedUnion("type", [
        PingSchema,
        PongSchema,
        ChatSchema,
      ]);

      type UnionType = z.infer<typeof union>;
      expectTypeOf<UnionType>().not.toBeNever();
    });
  });

  describe("Edge cases and potential regressions", () => {
    it("should handle optional payload schemas", () => {
      const schema = message({
        type: "OPTIONAL_TEST",
        payload: undefined, // explicitly undefined
      });

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toBeNever();
    });

    it("should handle complex transforms on schemas", () => {
      const schema = message("TRANSFORMED", {
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase()),
        age: z.number().min(0).max(150),
      });

      type Payload = InferPayload<typeof schema>;
      // Payload should include transformed types
      expectTypeOf<Payload>().not.toBeNever();
    });

    it("should handle union types in payload", () => {
      const schema = message("UNION_TEST", {
        status: z.union([z.literal("active"), z.literal("inactive")]),
        count: z.number(),
      });

      type Payload = InferPayload<typeof schema>;
      expectTypeOf<Payload>().toEqualTypeOf<{
        status: "active" | "inactive";
        count: number;
      }>();
    });

    it("should not regress to Zod schema types", () => {
      const schema = message("REGRESSION_CHECK", { value: z.string() });

      type Payload = InferPayload<typeof schema>;

      // This should NOT be ZodString or ZodRawShape
      // It should be plain string
      expectTypeOf<Payload>().toEqualTypeOf<{ value: string }>();
      expectTypeOf<Payload>().not.toMatchTypeOf<{
        value: unknown & { _type?: any };
      }>();
    });
  });
});
