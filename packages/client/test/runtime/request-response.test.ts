// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client Request/Response Correlation Tests
 *
 * Critical correctness tests for four-way dispatch logic:
 * 1. Correct type + valid data → resolve
 * 2. ERROR type → reject with ServerError
 * 3. Wrong type → reject with ValidationError
 * 4. Malformed reply → reject with ValidationError
 *
 * See @docs/specs/client.md#Correlation
 * See @docs/specs/test-requirements.md#Runtime-Testing
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  ConnectionClosedError,
  StateError,
  TimeoutError,
  ValidationError,
} from "../../src/errors.js";
import { createClient } from "../../src/index.js";
import type { WebSocketClient } from "../../src/types.js";
import { z, message, rpc } from "@ws-kit/zod";
import { createMockWebSocket } from "./helpers.js";

// Test schemas
const Hello = message("HELLO", { name: z.string() });
const HelloOk = message("HELLO_OK", { text: z.string() });

// RPC schemas
const Ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });
const Query = rpc("QUERY", { id: z.string() }, "QUERY_RESULT", {
  data: z.string(),
});

describe("Client: Request/Response Correlation", () => {
  let client: WebSocketClient;
  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    mockWs = createMockWebSocket();

    client = createClient({
      url: "ws://test",
      wsFactory: () => {
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });
  });

  // Helper to simulate receiving a message
  function simulateReceive(msg: any) {
    mockWs._trigger.message(msg);
  }

  it("resolves with correct type and valid data", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
      correlationId: "req-123",
    });

    // Server sends correct reply
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: "req-123" },
      payload: { text: "Hello, test!" },
    });

    const reply = (await promise) as z.infer<typeof HelloOk>;
    expect(reply.type).toBe("HELLO_OK");
    expect(reply.payload.text).toBe("Hello, test!");
  });

  it("rejects with ServerError on ERROR type with matching correlationId", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
      correlationId: "req-456",
    });

    // Server sends ERROR
    simulateReceive({
      type: "ERROR",
      meta: { correlationId: "req-456" },
      payload: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong",
        context: { detail: "database failure" },
      },
    });

    await expect(promise).rejects.toThrow("Something went wrong");
    // Note: ServerError class would need to be exported from errors.ts
  });

  it("rejects with ValidationError on wrong type (non-ERROR)", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
      correlationId: "req-789",
    });

    // Server sends wrong type (GOODBYE instead of HELLO_OK)
    simulateReceive({
      type: "GOODBYE",
      meta: { correlationId: "req-789" },
      payload: { message: "Unexpected response" },
    });

    await expect(promise).rejects.toThrow(ValidationError);
    await expect(promise).rejects.toMatchObject({
      message: expect.stringContaining("Expected type HELLO_OK, got GOODBYE"),
    });
  });

  it("rejects with ValidationError on malformed reply payload", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
      correlationId: "req-999",
    });

    // Server sends correct type but invalid payload structure
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: "req-999" },
      payload: { text: 123 }, // Should be string, not number
    });

    await expect(promise).rejects.toThrow(ValidationError);
  });

  it("ignores duplicate replies with same correlationId", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
      correlationId: "req-dup",
    });

    // First reply - should settle the promise
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: "req-dup" },
      payload: { text: "first" },
    });

    const reply = (await promise) as z.infer<typeof HelloOk>;
    expect(reply.payload.text).toBe("first");

    // Second reply with same correlationId - should be dropped silently
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: "req-dup" },
      payload: { text: "second" },
    });

    // Third reply - also dropped silently
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: "req-dup" },
      payload: { text: "third" },
    });

    // No errors thrown; duplicates ignored after first settles
  });

  it("rejects with TimeoutError when no reply within timeoutMs", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 100, // Very short timeout
    });

    // Don't send reply - let it timeout
    await expect(promise).rejects.toThrow(TimeoutError);
  });

  it("rejects with ConnectionClosedError when connection closes before reply", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
    });

    // Close connection before reply arrives
    const closePromise = client.close();

    // The request should reject with ConnectionClosedError
    await expect(promise).rejects.toThrow(ConnectionClosedError);

    // Wait for close to complete
    await closePromise;
  });

  it("rejects with StateError when queue: off and disconnected", async () => {
    const offlineMockWs = createMockWebSocket();
    const offlineClient = createClient({
      url: "ws://test",
      wsFactory: () => {
        setTimeout(() => offlineMockWs._trigger.open(), 0);
        return offlineMockWs as any;
      },
      queue: "off",
    });

    // Not connected - queue disabled
    const promise = offlineClient.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 1000,
    });

    await expect(promise).rejects.toThrow(StateError);
    await expect(promise).rejects.toMatchObject({
      message: expect.stringContaining(
        "Cannot send request while disconnected with queue disabled",
      ),
    });
  });

  it("rejects with ValidationError on outbound validation failure", async () => {
    await client.connect();

    const promise = client.request(
      Hello,
      { name: 123 } as any, // Invalid type
      HelloOk,
      { timeoutMs: 1000 },
    );

    await expect(promise).rejects.toThrow(ValidationError); // Client throws ValidationError for outbound validation
    await expect(promise).rejects.toMatchObject({
      message: expect.stringContaining("Outbound validation failed"),
    });
  });

  it("auto-generates correlationId if not provided", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
    });

    // Get the sent message
    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);

    // Check that correlationId was auto-generated (UUIDv4 format)
    expect(sent[0].meta.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // Reply with the auto-generated correlationId
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: sent[0].meta.correlationId },
      payload: { text: "ok" },
    });

    await promise; // Should resolve
  });

  it("handles correlationId in both request and reply meta", async () => {
    await client.connect();

    // User provides explicit correlationId
    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 5000,
      correlationId: "explicit-id",
    });

    // Server echoes correlationId in reply
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: "explicit-id", timestamp: Date.now() },
      payload: { text: "ok" },
    });

    const reply = (await promise) as z.infer<typeof HelloOk>;
    expect(reply.meta.correlationId).toBe("explicit-id");
  });

  it("cleans up pending map after rejection", async () => {
    await client.connect();

    const promise = client.request(Hello, { name: "test" }, HelloOk, {
      timeoutMs: 100,
      correlationId: "cleanup-test",
    });

    // Let timeout occur
    await expect(promise).rejects.toThrow(TimeoutError);

    // Late reply should be ignored (pending map cleaned)
    simulateReceive({
      type: "HELLO_OK",
      meta: { correlationId: "cleanup-test" },
      payload: { text: "too late" },
    });

    // No errors thrown; late reply dropped silently
  });

  describe("RPC-Style Requests (Auto-Detected Response)", () => {
    it("sends and receives with auto-detected response schema from rpc()", async () => {
      await client.connect();

      // RPC-style: response schema auto-detected from Ping
      const promise = client.request(
        Ping,
        { text: "hello" },
        {
          timeoutMs: 5000,
          correlationId: "rpc-1",
        },
      );

      // Server sends correct reply
      simulateReceive({
        type: "PONG",
        meta: { correlationId: "rpc-1" },
        payload: { reply: "world" },
      });

      const reply = (await promise) as z.infer<typeof Ping>["response"];
      expect(reply.type).toBe("PONG");
      expect(reply.payload.reply).toBe("world");
    });

    it("works with multiple RPC requests in parallel", async () => {
      await client.connect();

      // Send two RPC requests
      const promise1 = client.request(
        Ping,
        { text: "first" },
        {
          timeoutMs: 5000,
          correlationId: "rpc-p1",
        },
      );

      const promise2 = client.request(
        Query,
        { id: "123" },
        {
          timeoutMs: 5000,
          correlationId: "rpc-p2",
        },
      );

      // Reply to both in different order
      simulateReceive({
        type: "QUERY_RESULT",
        meta: { correlationId: "rpc-p2" },
        payload: { data: "result" },
      });

      simulateReceive({
        type: "PONG",
        meta: { correlationId: "rpc-p1" },
        payload: { reply: "second" },
      });

      const [reply1, reply2] = await Promise.all([promise1, promise2]);
      expect((reply1 as any).type).toBe("PONG");
      expect((reply2 as any).type).toBe("QUERY_RESULT");
    });

    it("rejects with ValidationError when RPC response has wrong type", async () => {
      await client.connect();

      const promise = client.request(
        Ping,
        { text: "test" },
        {
          timeoutMs: 5000,
          correlationId: "rpc-wrong",
        },
      );

      // Server sends wrong type
      simulateReceive({
        type: "GOODBYE", // Expected PONG
        meta: { correlationId: "rpc-wrong" },
        payload: { message: "bye" },
      });

      await expect(promise).rejects.toThrow(ValidationError);
      await expect(promise).rejects.toMatchObject({
        message: expect.stringContaining("Expected type PONG, got GOODBYE"),
      });
    });

    it("rejects with ValidationError when RPC response payload is invalid", async () => {
      await client.connect();

      const promise = client.request(
        Ping,
        { text: "test" },
        {
          timeoutMs: 5000,
          correlationId: "rpc-invalid",
        },
      );

      // Server sends correct type but invalid payload
      simulateReceive({
        type: "PONG",
        meta: { correlationId: "rpc-invalid" },
        payload: { reply: 123 }, // Should be string
      });

      await expect(promise).rejects.toThrow(ValidationError);
    });

    it("times out when RPC response doesn't arrive", async () => {
      await client.connect();

      const promise = client.request(
        Ping,
        { text: "test" },
        {
          timeoutMs: 100,
          correlationId: "rpc-timeout",
        },
      );

      // Don't send reply
      await expect(promise).rejects.toThrow(TimeoutError);
    });

    it("auto-generates correlationId for RPC requests", async () => {
      await client.connect();

      const promise = client.request(
        Ping,
        { text: "test" },
        {
          timeoutMs: 5000,
        },
      );

      // Get the sent message
      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(1);
      expect(sent[0].meta.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      // Reply with auto-generated ID
      simulateReceive({
        type: "PONG",
        meta: { correlationId: sent[0].meta.correlationId },
        payload: { reply: "ok" },
      });

      await promise;
    });
  });

  describe("Backward Compatibility: Explicit Response Schema", () => {
    it("still works with explicit response schema (not using rpc())", async () => {
      await client.connect();

      // Traditional style with explicit response
      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        timeoutMs: 5000,
        correlationId: "traditional",
      });

      simulateReceive({
        type: "HELLO_OK",
        meta: { correlationId: "traditional" },
        payload: { text: "Hello, test!" },
      });

      const reply = (await promise) as z.infer<typeof HelloOk>;
      expect(reply.type).toBe("HELLO_OK");
      expect(reply.payload.text).toBe("Hello, test!");
    });

    it("can override RPC response schema with explicit schema", async () => {
      await client.connect();

      // Use RPC schema but provide explicit response (for testing edge cases)
      const ExplicitPong = message("PONG", {
        reply: z.string(),
        extra: z.string().optional(),
      });

      const promise = client.request(Ping, { text: "test" }, ExplicitPong, {
        timeoutMs: 5000,
        correlationId: "override",
      });

      simulateReceive({
        type: "PONG",
        meta: { correlationId: "override" },
        payload: { reply: "world", extra: "data" },
      });

      const reply = (await promise) as any;
      expect(reply.payload.extra).toBe("data");
    });

    it("detects legacy style (schema, payload, reply) correctly", async () => {
      await client.connect();

      // This is the legacy way with 4 args (before RPC auto-detection)
      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        timeoutMs: 5000,
        correlationId: "legacy",
      });

      simulateReceive({
        type: "HELLO_OK",
        meta: { correlationId: "legacy" },
        payload: { text: "Hello!" },
      });

      const reply = (await promise) as z.infer<typeof HelloOk>;
      expect(reply.type).toBe("HELLO_OK");
    });
  });
});
