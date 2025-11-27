// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client Auto-Connect Edge Case Tests
 *
 * Tests autoConnect behavior with different queue modes,
 * focusing on edge cases around connection failure.
 *
 * See docs/specs/client.md#queue-behavior
 * See docs/specs/test-requirements.md#runtime-testing
 */

import { createClient, StateError } from "@ws-kit/client";
import { message, z } from "@ws-kit/zod";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from "bun:test";
import { createMockWebSocket, waitForState } from "../helpers.js";

const Hello = message("HELLO", { name: z.string() });
const HelloOk = message("HELLO_OK", { text: z.string() });

describe("Client: Auto-Connect Edge Cases", () => {
  describe("autoConnect + queue:off → connection error priority", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
      client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "off", // Critical: queue disabled
        wsFactory: () => {
          throw new Error("Connection refused");
        },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("rejects with connection error (not StateError) on first request", async () => {
      // Auto-connect triggers but fails
      // Should reject with connection error, NOT StateError
      await expect(
        client.request(Hello, { name: "test" }, HelloOk, { timeoutMs: 1000 }),
      ).rejects.toThrow("Connection refused");

      // Wait for connection attempt to complete
      await waitForState(client, "closed");
    });

    it("subsequent requests reject with StateError after failed auto-connect", async () => {
      // First request fails auto-connect
      await expect(
        client.request(Hello, { name: "1" }, HelloOk, {}),
      ).rejects.toThrow("Connection refused");

      // Wait for connection attempt to fully complete
      await waitForState(client, "closed");

      expect(client.state).toBe("closed");

      // Second request does NOT auto-reconnect (per spec: only on "never connected")
      // Should reject with StateError (queue: off + disconnected)
      await expect(
        client.request(Hello, { name: "2" }, HelloOk, {}),
      ).rejects.toThrow(StateError);

      await expect(
        client.request(Hello, { name: "3" }, HelloOk, {}),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "Cannot send request while disconnected with queue disabled",
        ),
      });
    });
  });

  describe("autoConnect + queue:drop-newest → queues on success", () => {
    let client: ReturnType<typeof createClient>;
    let connectCalled: boolean;

    beforeEach(() => {
      connectCalled = false;

      client = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "drop-newest", // Default queue mode
        wsFactory: () => {
          connectCalled = true;
          // Return mock WebSocket that never opens (simulates slow connection)
          return createMockWebSocket() as unknown as WebSocket;
        },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("triggers auto-connect and queues message", async () => {
      // send() triggers async connect but returns immediately
      const sent = client.send(Hello, { name: "test" });

      // Wait for async connect to start
      await waitForState(client, "connecting");

      expect(connectCalled).toBe(true);
      expect(client.state).toBe("connecting");
      expect(sent).toBe(true); // Queued successfully
    });
  });

  describe("autoConnect + send() → returns false on failure", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
      client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          throw new Error("Connection refused");
        },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("returns false when auto-connect fails", async () => {
      // send() never throws - returns false on auto-connect failure
      const sent = client.send(Hello, { name: "test" });

      // Auto-connect failure should return false (message dropped)
      expect(sent).toBe(false);
    });

    it("queues message with queue:drop-newest even on slow connect", async () => {
      const localClient = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "drop-newest",
        wsFactory: () => {
          // Return mock WebSocket (never opens)
          return createMockWebSocket() as unknown as WebSocket;
        },
      });

      onTestFinished(async () => {
        await localClient.close();
      });

      // Should queue message while connecting
      const sent = localClient.send(Hello, { name: "test" });

      expect(sent).toBe(true); // Queued successfully
      expect(localClient.state).toBe("connecting");
    });
  });

  describe("autoConnect does not retry after failure", () => {
    let client: ReturnType<typeof createClient>;
    let connectAttempts: number;

    beforeEach(() => {
      connectAttempts = 0;

      client = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "drop-newest",
        wsFactory: () => {
          connectAttempts++;
          throw new Error("Connection refused");
        },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("does not trigger on second send() after failed auto-connect", async () => {
      // First send triggers auto-connect
      client.send(Hello, { name: "1" });

      // Wait for first connection attempt to fail
      await waitForState(client, "closed");

      // Second send should NOT trigger another auto-connect
      client.send(Hello, { name: "2" });

      // Verify state remains closed (no new connection attempt)
      await waitForState(client, "closed");

      // Should only attempt once
      expect(connectAttempts).toBe(1);
    });

    it("allows manual reconnect after failed auto-connect", async () => {
      const factoryState = { shouldSucceed: false };
      let mockWs: ReturnType<typeof createMockWebSocket>;

      const localClient = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          if (!factoryState.shouldSucceed) {
            throw new Error("Connection refused");
          }
          // Return mock WebSocket that opens successfully
          mockWs = createMockWebSocket();
          // Defer open trigger to allow event listeners to attach
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
      });

      onTestFinished(async () => {
        await localClient.close();
      });

      // First auto-connect fails
      await expect(
        localClient.request(Hello, { name: "1" }, HelloOk, {}),
      ).rejects.toThrow("Connection refused");

      expect(localClient.state).toBe("closed");

      // Enable successful connection for manual reconnect
      factoryState.shouldSucceed = true;

      // Manually reconnect (per spec: auto-connect does not retry after failure)
      await localClient.connect();

      expect(localClient.state).toBe("open");

      // Now send() should succeed and return true
      const sent = localClient.send(Hello, { name: "2" });
      expect(sent).toBe(true);
    });
  });

  describe("Order of operations validation", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
      client = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          throw new Error("Connection refused");
        },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("checks queue policy only after auto-connect completes", async () => {
      const executionOrder: string[] = [];

      const localClient = createClient({
        url: "ws://test",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          executionOrder.push("wsFactory");
          throw new Error("Connection refused");
        },
      });

      onTestFinished(async () => {
        await localClient.close();
      });

      try {
        await localClient.request(Hello, { name: "test" }, HelloOk, {});
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

      const localClient = createClient({
        url: "ws://invalid",
        autoConnect: true,
        queue: "off",
        wsFactory: () => {
          wsFactoryCalls++;
          throw new Error("Connection refused");
        },
      });

      onTestFinished(async () => {
        await localClient.close();
      });

      // First request triggers auto-connect
      await expect(
        localClient.request(Hello, { name: "1" }, HelloOk, {}),
      ).rejects.toThrow("Connection refused");

      expect(wsFactoryCalls).toBe(1);

      // Second request does NOT trigger auto-connect (already attempted)
      // Should reject immediately with StateError
      const startTime = Date.now();
      await expect(
        localClient.request(Hello, { name: "2" }, HelloOk, {}),
      ).rejects.toThrow(StateError);
      const elapsed = Date.now() - startTime;

      // Should fail immediately (not wait for connection attempt)
      expect(elapsed).toBeLessThan(50);
      expect(wsFactoryCalls).toBe(1); // No second attempt
    });
  });
});
