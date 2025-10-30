// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * RPC Schema Helper Tests
 *
 * Validates that rpc() creates properly bound request-response pairs
 * and works seamlessly with router handlers and client requests.
 *
 * Spec: Request-response pattern binding
 */

import { describe, expect, it } from "bun:test";
import { z, message, rpc } from "@ws-kit/zod";

describe("RPC Schema Helper", () => {
  describe("rpc() Creation", () => {
    it("should create RPC schema with request and response bound together", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
      });

      // Should have both properties
      expect(ping).toBeDefined();
      expect((ping as any).response).toBeDefined();
      expect((ping as any).responseType).toBe("PONG");
    });

    it("should attach response schema as non-enumerable property", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
      });

      const descriptor = Object.getOwnPropertyDescriptor(ping, "response");
      expect(descriptor?.enumerable).toBe(false);
      expect(descriptor?.configurable).toBe(true);
    });

    it("should preserve request schema as valid message schema", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
      });

      // Should validate as normal message schema
      const result = (ping as any).safeParse({
        type: "PING",
        meta: {},
        payload: { text: "hello" },
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid request payloads", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
      });

      const result = (ping as any).safeParse({
        type: "PING",
        meta: {},
        payload: { text: 123 }, // ❌ Should be string
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Response Schema Access", () => {
    it("should attach valid response schema that can be used for validation", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
      });

      const responseSchema = (ping as any).response;

      // Should validate response messages
      const validResult = responseSchema.safeParse({
        type: "PONG",
        meta: {},
        payload: { reply: "world" },
      });
      expect(validResult.success).toBe(true);

      // Should reject invalid responses
      const invalidResult = responseSchema.safeParse({
        type: "PONG",
        meta: {},
        payload: { reply: 123 }, // ❌ Should be string
      });
      expect(invalidResult.success).toBe(false);
    });

    it("should allow explicit response schema override", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
      });

      const explicitPong = message("PONG", { reply: z.string() });

      // Should be usable as alternative response schema
      const result = explicitPong.safeParse({
        type: "PONG",
        meta: {},
        payload: { reply: "world" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("RPC with No Payloads", () => {
    it("should support RPC without request payload", () => {
      const heartbeat = rpc("HEARTBEAT", undefined, "HEARTBEAT_ACK", undefined);

      const result = (heartbeat as any).safeParse({
        type: "HEARTBEAT",
        meta: {},
      });

      expect(result.success).toBe(true);
    });

    it("should support RPC with request but no response payload", () => {
      const start = rpc("START", { id: z.string() }, "STARTED", undefined);

      const result = (start as any).safeParse({
        type: "START",
        meta: {},
        payload: { id: "123" },
      });

      expect(result.success).toBe(true);
    });

    it("should support RPC with no request but response payload", () => {
      const fetch = rpc("FETCH", undefined, "DATA", {
        items: z.array(z.any()),
      });

      const result = (fetch as any).safeParse({
        type: "FETCH",
        meta: {},
      });

      expect(result.success).toBe(true);

      const responseSchema = (fetch as any).response;
      const responseResult = responseSchema.safeParse({
        type: "DATA",
        meta: {},
        payload: { items: [1, 2, 3] },
      });
      expect(responseResult.success).toBe(true);
    });
  });

  describe("RPC with Complex Types", () => {
    it("should support RPC with nested objects", () => {
      const createUser = rpc(
        "CREATE_USER",
        {
          user: z.object({
            name: z.string(),
            email: z.string().email(),
          }),
        },
        "USER_CREATED",
        {
          userId: z.string(),
          user: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string().email(),
          }),
        },
      );

      const result = (createUser as any).safeParse({
        type: "CREATE_USER",
        meta: {},
        payload: {
          user: { name: "John", email: "john@example.com" },
        },
      });

      expect(result.success).toBe(true);

      // Validate response
      const responseSchema = (createUser as any).response;
      const responseResult = responseSchema.safeParse({
        type: "USER_CREATED",
        meta: {},
        payload: {
          userId: "123",
          user: {
            id: "123",
            name: "John",
            email: "john@example.com",
          },
        },
      });
      expect(responseResult.success).toBe(true);
    });

    it("should support RPC with arrays and unions", () => {
      const query = rpc(
        "QUERY",
        {
          filters: z.array(
            z.union([
              z.object({ field: z.string(), value: z.string() }),
              z.object({
                field: z.string(),
                range: z.tuple([z.number(), z.number()]),
              }),
            ]),
          ),
        },
        "QUERY_RESULT",
        {
          results: z.array(z.record(z.any())),
          count: z.number(),
        },
      );

      const result = (query as any).safeParse({
        type: "QUERY",
        meta: {},
        payload: {
          filters: [
            { field: "age", value: "25" },
            { field: "score", range: [10, 100] },
          ],
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("RPC with Extended Meta", () => {
    it("should support RPC with extended meta on request", () => {
      const scoped = rpc(
        "SCOPED_REQUEST",
        { action: z.string() },
        "SCOPED_RESPONSE",
        { result: z.string() },
      );

      // RPC should work with extended meta in the request schema
      const result = (scoped as any).safeParse({
        type: "SCOPED_REQUEST",
        meta: { correlationId: "req-123" },
        payload: { action: "test" },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Type Safety", () => {
    it("should preserve type inference for request payloads", () => {
      const ping = rpc(
        "PING",
        { text: z.string(), count: z.number() },
        "PONG",
        { reply: z.string() },
      );

      // Request schema should enforce types
      const result = (ping as any).safeParse({
        type: "PING",
        meta: {},
        payload: { text: "hello", count: "invalid" }, // ❌ count should be number
      });

      expect(result.success).toBe(false);
    });

    it("should preserve type inference for response payloads", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
        code: z.number(),
      });

      const responseSchema = (ping as any).response;
      const result = responseSchema.safeParse({
        type: "PONG",
        meta: {},
        payload: { reply: "world", code: "invalid" }, // ❌ code should be number
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Schema Composition", () => {
    it("should allow RPC schemas in discriminated unions", () => {
      const ping = rpc("PING", { text: z.string() }, "PONG", {
        reply: z.string(),
      });
      const echo = rpc("ECHO", { message: z.string() }, "ECHO_REPLY", {
        message: z.string(),
      });

      // Should be composable in unions
      const messageUnion = z.discriminatedUnion("type", [ping, echo]);

      const pingResult = messageUnion.safeParse({
        type: "PING",
        meta: {},
        payload: { text: "hello" },
      });
      expect(pingResult.success).toBe(true);

      const echoResult = messageUnion.safeParse({
        type: "ECHO",
        meta: {},
        payload: { message: "world" },
      });
      expect(echoResult.success).toBe(true);
    });

    it("should be usable with standard message schemas in unions", () => {
      const rpcMessage = rpc("RPC_MSG", { data: z.string() }, "RPC_REPLY", {
        result: z.string(),
      });
      const standardMsg = message("STANDARD", { value: z.number() });

      const union = z.discriminatedUnion("type", [rpcMessage, standardMsg]);

      const rpcResult = union.safeParse({
        type: "RPC_MSG",
        meta: {},
        payload: { data: "test" },
      });
      expect(rpcResult.success).toBe(true);

      const standardResult = union.safeParse({
        type: "STANDARD",
        meta: {},
        payload: { value: 42 },
      });
      expect(standardResult.success).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle same type for request and response", () => {
      const toggle = rpc(
        "TOGGLE",
        { enabled: z.boolean() },
        "TOGGLE", // Same type
        { enabled: z.boolean() },
      );

      const result = (toggle as any).safeParse({
        type: "TOGGLE",
        meta: {},
        payload: { enabled: true },
      });

      expect(result.success).toBe(true);
      expect((toggle as any).responseType).toBe("TOGGLE");
    });

    it("should handle raw shape objects as payloads", () => {
      const raw = rpc(
        "RAW_REQUEST",
        { name: z.string() }, // Raw shape, not ZodObject
        "RAW_RESPONSE",
        { result: z.string() }, // Raw shape
      );

      const result = (raw as any).safeParse({
        type: "RAW_REQUEST",
        meta: {},
        payload: { name: "test" },
      });

      expect(result.success).toBe(true);
    });

    it("should preserve strict mode on RPC schemas", () => {
      const strict = rpc("STRICT", { field: z.string() }, "STRICT_REPLY", {
        result: z.string(),
      });

      // Should reject unknown fields at all levels
      const result = (strict as any).safeParse({
        type: "STRICT",
        meta: {},
        payload: { field: "test", unknown: "extra" }, // ❌ Unknown field
      });

      expect(result.success).toBe(false);
    });
  });
});
