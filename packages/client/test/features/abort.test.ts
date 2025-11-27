// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client AbortSignal Tests
 *
 * Tests request cancellation via AbortSignal:
 * - Abort before dispatch → StateError immediately
 * - Abort while pending → StateError + cleanup
 * - Abort cancels timeout timer
 * - Pending map cleanup
 *
 * See docs/specs/client.md#request-timeout
 * See docs/specs/test-requirements.md#runtime-testing
 */

import type { WebSocketClient } from "@ws-kit/client";
import { StateError, createClient } from "@ws-kit/client";
import { message, z } from "@ws-kit/zod";
import { beforeEach, describe, expect, it } from "bun:test";
import { createMockWebSocket } from "../helpers.js";

const Hello = message("HELLO", { name: z.string() });
const HelloOk = message("HELLO_OK", { text: z.string() });

describe("Client: AbortSignal Support", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;
  let client: WebSocketClient;

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

  describe("Abort before dispatch", () => {
    it("rejects immediately with StateError when already aborted", async () => {
      await client.connect();

      const controller = new AbortController();
      controller.abort(); // Abort before request

      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        signal: controller.signal,
      });

      await expect(promise).rejects.toThrow(StateError);
      await expect(promise).rejects.toMatchObject({
        message: expect.stringContaining("aborted before dispatch"),
      });
    });

    it("does not send message when aborted before dispatch", async () => {
      await client.connect();

      const controller = new AbortController();
      controller.abort();

      try {
        await client.request(Hello, { name: "test" }, HelloOk, {
          signal: controller.signal,
        });
      } catch (error) {
        // Expected
      }

      // Message should not have been sent
      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(0);
    });
  });

  describe("Abort while pending", () => {
    it("rejects with StateError when aborted after dispatch", async () => {
      await client.connect();

      const controller = new AbortController();

      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        timeoutMs: 60000,
        signal: controller.signal,
      });

      // Message sent, now abort
      controller.abort();

      await expect(promise).rejects.toThrow(StateError);
      await expect(promise).rejects.toMatchObject({
        message: expect.stringContaining("Request aborted"),
      });
    });

    it("cancels timeout when aborted", async () => {
      await client.connect();

      const controller = new AbortController();

      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        timeoutMs: 100,
        signal: controller.signal,
      });

      // Abort immediately
      controller.abort();

      const startTime = Date.now();

      try {
        await promise;
      } catch (error) {
        // Expected StateError
      }

      const elapsed = Date.now() - startTime;

      // Should reject immediately, not wait for timeout
      expect(elapsed).toBeLessThan(50);
    });

    it("cleans up pending request map", async () => {
      await client.connect();

      const controller = new AbortController();

      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        signal: controller.signal,
      });

      // Get the correlationId from sent message
      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(1);
      const correlationId = sent[0].meta.correlationId;

      // Abort
      controller.abort();

      try {
        await promise;
      } catch (error) {
        // Expected
      }

      // Send late reply - should be ignored (pending map cleaned)
      mockWs._trigger.message({
        type: "HELLO_OK",
        meta: { correlationId },
        payload: { text: "late reply" },
      });

      // No errors should be thrown (late reply silently ignored)
    });
  });

  describe("Multiple requests with same controller", () => {
    it("aborts all requests tied to same controller", async () => {
      await client.connect();

      const controller = new AbortController();

      const promise1 = client.request(Hello, { name: "req1" }, HelloOk, {
        signal: controller.signal,
      });

      const promise2 = client.request(Hello, { name: "req2" }, HelloOk, {
        signal: controller.signal,
      });

      const promise3 = client.request(Hello, { name: "req3" }, HelloOk, {
        signal: controller.signal,
      });

      // Abort all
      controller.abort();

      // All should reject with StateError
      await expect(promise1).rejects.toThrow(StateError);
      await expect(promise2).rejects.toThrow(StateError);
      await expect(promise3).rejects.toThrow(StateError);
    });
  });

  describe("Abort does not affect other requests", () => {
    it("only aborts requests with matching signal", async () => {
      await client.connect();

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const promise1 = client.request(Hello, { name: "req1" }, HelloOk, {
        signal: controller1.signal,
        correlationId: "req1",
      });

      const promise2 = client.request(Hello, { name: "req2" }, HelloOk, {
        signal: controller2.signal,
        correlationId: "req2",
      });

      // Abort only first request
      controller1.abort();

      // First should reject
      await expect(promise1).rejects.toThrow(StateError);

      // Second should still be pending - send reply
      mockWs._trigger.message({
        type: "HELLO_OK",
        meta: { correlationId: "req2" },
        payload: { text: "Reply to req2" },
      });

      // Second should resolve
      const reply2 = (await promise2) as z.infer<typeof HelloOk>;
      expect(reply2.payload.text).toBe("Reply to req2");
    });
  });

  describe("Abort after successful response", () => {
    it("does nothing when aborted after promise already resolved", async () => {
      await client.connect();

      const controller = new AbortController();

      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        signal: controller.signal,
        correlationId: "req-123",
      });

      // Send reply
      mockWs._trigger.message({
        type: "HELLO_OK",
        meta: { correlationId: "req-123" },
        payload: { text: "Success" },
      });

      // Wait for resolution
      const reply = (await promise) as z.infer<typeof HelloOk>;
      expect(reply.payload.text).toBe("Success");

      // Abort after resolution - should do nothing
      controller.abort();

      // No errors
    });
  });

  describe("Signal without explicit correlationId", () => {
    it("works with auto-generated correlationId", async () => {
      await client.connect();

      const controller = new AbortController();

      const promise = client.request(
        Hello,
        { name: "test" },
        HelloOk,
        { signal: controller.signal },
        // No explicit correlationId - should auto-generate
      );

      // Verify message sent with auto-generated ID
      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(1);
      expect(sent[0].meta.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      // Abort
      controller.abort();

      await expect(promise).rejects.toThrow(StateError);
    });
  });

  describe("Abort during connection", () => {
    it("aborts queued request during connection attempt", async () => {
      const client = createClient({
        url: "ws://test",
        queue: "drop-newest",
        wsFactory: () => {
          // Delay connection open
          const mockWs = createMockWebSocket();
          setTimeout(() => mockWs._trigger.open(), 50);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      const controller = new AbortController();

      // Start connection
      const connectPromise = client.connect();

      // Make request while connecting (will be queued)
      const requestPromise = client.request(Hello, { name: "test" }, HelloOk, {
        signal: controller.signal,
      });

      // Abort before connection completes
      controller.abort();

      await expect(requestPromise).rejects.toThrow(StateError);

      // Wait for connection to complete
      await connectPromise;
    });
  });

  describe("Abort with queue: off", () => {
    it("aborts request when disconnected with queue disabled", async () => {
      const client = createClient({
        url: "ws://test",
        queue: "off",
        reconnect: { enabled: false },
      });

      const controller = new AbortController();

      // Not connected - should reject with StateError (queue disabled)
      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        signal: controller.signal,
      });

      // Abort while still rejected due to queue
      controller.abort();

      await expect(promise).rejects.toThrow(StateError);
    });
  });
});
