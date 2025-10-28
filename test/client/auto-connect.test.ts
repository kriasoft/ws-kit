// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client Auto-Connect Edge Case Tests
 *
 * Tests autoConnect behavior with different queue modes,
 * focusing on edge cases around connection failure.
 *
 * See @specs/client.md#queue-behavior
 * See @specs/test-requirements.md#L873
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createClient, StateError } from "../../client/index";
import { createMessageSchema } from "../../packages/zod/src/schema";
import { createMockWebSocket } from "./helpers";

const { messageSchema } = createMessageSchema(z);
const Hello = messageSchema("HELLO", { name: z.string() });
const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

describe("Client: Auto-Connect Edge Cases", () => {
  describe("autoConnect + queue:off → connection error priority", () => {
    it("rejects with connection error (not StateError) on first request", async () => {
      const client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "off", // Critical: queue disabled
        wsFactory: () => {
          throw new Error("Connection refused");
        },
      });

      // Auto-connect triggers but fails
      // Should reject with connection error, NOT StateError
      await expect(
        client.request(Hello, { name: "test" }, HelloOk, { timeoutMs: 1000 }),
      ).rejects.toThrow("Connection refused");

      // Wait for connection attempt to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(client.state).toBe("closed");
    });

    it("subsequent requests reject with StateError after failed auto-connect", async () => {
      const client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          throw new Error("Connection refused");
        },
      });

      // First request fails auto-connect
      await expect(
        client.request(Hello, { name: "1" }, HelloOk),
      ).rejects.toThrow("Connection refused");

      // Wait for connection attempt to fully complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(client.state).toBe("closed");

      // Second request does NOT auto-reconnect (per spec: only on "never connected")
      // Should reject with StateError (queue: off + disconnected)
      await expect(
        client.request(Hello, { name: "2" }, HelloOk),
      ).rejects.toThrow(StateError);

      await expect(
        client.request(Hello, { name: "3" }, HelloOk),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "Cannot send request while disconnected with queue disabled",
        ),
      });
    });
  });

  describe("autoConnect + queue:drop-newest → queues on success", () => {
    it("triggers auto-connect and queues message", async () => {
      let connectCalled = false;

      const client = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "drop-newest", // Default queue mode
        wsFactory: () => {
          connectCalled = true;
          // Return mock WebSocket that never opens (simulates slow connection)
          return {
            send: () => {},
            close: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            readyState: 0, // CONNECTING
          } as unknown as WebSocket;
        },
      });

      // send() triggers async connect but returns immediately
      const sent = client.send(Hello, { name: "test" });

      // Wait for async connect to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(connectCalled).toBe(true);
      expect(client.state).toBe("connecting");
      expect(sent).toBe(true); // Queued successfully
    });
  });

  describe("autoConnect + send() → returns false on failure", () => {
    it("returns false when auto-connect fails", async () => {
      const client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          throw new Error("Connection refused");
        },
      });

      // send() never throws - returns false on auto-connect failure
      const sent = client.send(Hello, { name: "test" });

      // Auto-connect failure should return false (message dropped)
      expect(sent).toBe(false);
    });

    it("queues message with queue:drop-newest even on slow connect", async () => {
      const client = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "drop-newest",
        wsFactory: () => {
          // Return mock WebSocket (never opens)
          return {
            send: () => {},
            close: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            readyState: 0,
          } as unknown as WebSocket;
        },
      });

      // Should queue message while connecting
      const sent = client.send(Hello, { name: "test" });

      expect(sent).toBe(true); // Queued successfully
      expect(client.state).toBe("connecting");
    });
  });

  describe("autoConnect does not retry after failure", () => {
    it("does not trigger on second send() after failed auto-connect", async () => {
      let connectAttempts = 0;

      const client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "drop-newest",
        wsFactory: () => {
          connectAttempts++;
          throw new Error("Connection refused");
        },
      });

      // First send triggers auto-connect
      client.send(Hello, { name: "1" });

      // Wait briefly for connection attempt
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second send should NOT trigger another auto-connect
      client.send(Hello, { name: "2" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should only attempt once
      expect(connectAttempts).toBe(1);
    });

    it("allows manual reconnect after failed auto-connect", async () => {
      let connectAttempts = 0;
      let shouldSucceed = false;

      const client = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          connectAttempts++;
          if (!shouldSucceed) {
            throw new Error("Connection refused");
          }
          // Return mock WebSocket that opens successfully
          const mockWs = createMockWebSocket();
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
      });

      // First auto-connect fails
      await expect(
        client.request(Hello, { name: "1" }, HelloOk),
      ).rejects.toThrow("Connection refused");

      expect(connectAttempts).toBe(1);

      // Manual reconnect should work
      shouldSucceed = true;
      await client.connect();

      expect(connectAttempts).toBe(2);
      expect(client.state).toBe("open");
    });
  });

  describe("Order of operations validation", () => {
    it("checks queue policy only after auto-connect completes", async () => {
      const executionOrder: string[] = [];

      const client = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          executionOrder.push("wsFactory");
          throw new Error("Connection refused");
        },
      });

      try {
        await client.request(Hello, { name: "test" }, HelloOk);
      } catch (err) {
        executionOrder.push(
          err instanceof StateError ? "StateError" : "ConnectionError",
        );
      }

      // Should attempt connection before checking queue policy
      expect(executionOrder).toEqual(["wsFactory", "ConnectionError"]);
    });

    it("checks queue policy immediately on second request (no auto-reconnect)", async () => {
      let wsFactoryCalls = 0;

      const client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          wsFactoryCalls++;
          throw new Error("Connection refused");
        },
      });

      // First request triggers auto-connect
      await expect(
        client.request(Hello, { name: "1" }, HelloOk),
      ).rejects.toThrow("Connection refused");

      expect(wsFactoryCalls).toBe(1);

      // Second request does NOT trigger auto-connect (already attempted)
      // Should reject immediately with StateError
      const startTime = Date.now();
      await expect(
        client.request(Hello, { name: "2" }, HelloOk),
      ).rejects.toThrow(StateError);
      const elapsed = Date.now() - startTime;

      // Should fail immediately (not wait for connection attempt)
      expect(elapsed).toBeLessThan(50);
      expect(wsFactoryCalls).toBe(1); // No second attempt
    });
  });
});
