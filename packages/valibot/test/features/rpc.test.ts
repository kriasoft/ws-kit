// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * RPC Schema Helper Tests (Valibot)
 *
 * Mirrors the Zod implementation tests to ensure feature parity.
 * Validates that rpc() creates properly bound request-response pairs
 * and works seamlessly with router handlers and client requests.
 *
 * Spec: Request-response pattern binding
 */

import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { message, rpc } from "@ws-kit/valibot";

describe("RPC Schema Helper (Valibot)", () => {
  describe("rpc() Creation", () => {
    it("should create RPC schema with request and response bound together", () => {
      const ping = rpc("PING", { text: v.string() }, "PONG", {
        reply: v.string(),
      });

      // Should have both properties
      expect(ping).toBeDefined();
      expect((ping as any).response).toBeDefined();
      expect((ping as any).responseType).toBe("PONG");
    });

    it("should attach response schema as non-enumerable property", () => {
      const ping = rpc("PING", { text: v.string() }, "PONG", {
        reply: v.string(),
      });

      const descriptor = Object.getOwnPropertyDescriptor(ping, "response");
      expect(descriptor?.enumerable).toBe(false);
      expect(descriptor?.configurable).toBe(true);
    });

    it("should preserve request schema as valid message schema", () => {
      const ping = rpc("PING", { text: v.string() }, "PONG", {
        reply: v.string(),
      });

      // Should validate as normal message schema (safeParse added by adapter)
      const result = (ping as any).safeParse({
        type: "PING",
        meta: {},
        payload: { text: "hello" },
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid request payloads", () => {
      const ping = rpc("PING", { text: v.string() }, "PONG", {
        reply: v.string(),
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
      const ping = rpc("PING", { text: v.string() }, "PONG", {
        reply: v.string(),
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
      const ping = rpc("PING", { text: v.string() }, "PONG", {
        reply: v.string(),
      });

      const explicitPong = message("PONG", { reply: v.string() });

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
      const start = rpc("START", { id: v.string() }, "STARTED", undefined);

      const result = (start as any).safeParse({
        type: "START",
        meta: {},
        payload: { id: "123" },
      });

      expect(result.success).toBe(true);
    });

    it("should support RPC with no request but response payload", () => {
      const fetch = rpc("FETCH", undefined, "DATA", {
        items: v.array(v.any()),
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
          user: v.object({
            name: v.string(),
            email: v.string([v.email()]),
          }),
        },
        "USER_CREATED",
        {
          userId: v.string(),
          user: v.object({
            id: v.string(),
            name: v.string(),
            email: v.string([v.email()]),
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

    it("should support RPC with arrays", () => {
      const query = rpc(
        "QUERY",
        {
          filters: v.array(
            v.object({
              field: v.string(),
              value: v.string(),
            }),
          ),
        },
        "QUERY_RESULT",
        {
          results: v.array(v.record(v.string(), v.any())),
          count: v.number(),
        },
      );

      const result = (query as any).safeParse({
        type: "QUERY",
        meta: {},
        payload: {
          filters: [{ field: "age", value: "25" }],
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("RPC with Extended Meta", () => {
    it("should support RPC with extended meta on request", () => {
      const scoped = rpc(
        "SCOPED_REQUEST",
        { action: v.string() },
        "SCOPED_RESPONSE",
        { result: v.string() },
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
        { text: v.string(), count: v.number() },
        "PONG",
        { reply: v.string() },
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
      const ping = rpc("PING", { text: v.string() }, "PONG", {
        reply: v.string(),
        code: v.number(),
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
    it("should be usable with standard message schemas", () => {
      const rpcMessage = rpc("RPC_MSG", { data: v.string() }, "RPC_REPLY", {
        result: v.string(),
      });
      const standardMsg = message("STANDARD", { value: v.number() });

      // Both should be independently valid
      const rpcResult = rpcMessage.safeParse({
        type: "RPC_MSG",
        meta: {},
        payload: { data: "test" },
      });
      expect(rpcResult.success).toBe(true);

      const standardResult = standardMsg.safeParse({
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
        { enabled: v.boolean() },
        "TOGGLE", // Same type
        { enabled: v.boolean() },
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
        { name: v.string() }, // Raw shape
        "RAW_RESPONSE",
        { result: v.string() }, // Raw shape
      );

      const result = (raw as any).safeParse({
        type: "RAW_REQUEST",
        meta: {},
        payload: { name: "test" },
      });

      expect(result.success).toBe(true);
    });

    it("should preserve strict mode on RPC schemas", () => {
      const strict = rpc("STRICT", { field: v.string() }, "STRICT_REPLY", {
        result: v.string(),
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
