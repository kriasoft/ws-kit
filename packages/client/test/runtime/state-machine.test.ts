// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client State Machine Tests
 *
 * Tests state transitions and their guarantees:
 * - Happy path: closed → connecting → open
 * - Graceful close: open → closing → closed
 * - Connection failure paths
 * - Reconnect cycle: closed → reconnecting → connecting → open
 * - Manual close prevents auto-reconnect
 *
 * See @docs/specs/client.md#connection-state-machine
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from "bun:test";
import { createClient } from "../../src/index.js";
import type { ClientState } from "../../src/types.js";
import { z, message } from "@ws-kit/zod";
import { createMockWebSocket, waitForState } from "./helpers.js";

message("TEST", { id: z.number() });

describe("Client: State Machine Transitions", () => {
  describe("Happy path: closed → connecting → open", () => {
    let client: ReturnType<typeof createClient>;
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

    afterEach(async () => {
      await client.close();
    });

    it("transitions through connecting to open on successful connection", async () => {
      const states: ClientState[] = [];
      client.onState((state) => states.push(state));

      expect(client.state).toBe("closed");

      const connectPromise = client.connect();
      expect(client.state).toBe("connecting");

      await connectPromise;
      expect(client.state).toBe("open");

      // State transitions: closed → connecting → open
      expect(states).toEqual(["connecting", "open"]);
    });

    it("isConnected getter reflects state === open", async () => {
      expect(client.state).toBe("closed");
      expect(client.isConnected).toBe(false);

      await client.connect();
      expect(client.state).toBe("open");
      expect(client.isConnected).toBe(true);
    });
  });

  describe("Graceful close: open → closing → closed", () => {
    let client: ReturnType<typeof createClient>;
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

    afterEach(async () => {
      await client.close();
    });

    it("transitions through closing to closed on manual close", async () => {
      const states: ClientState[] = [];

      await client.connect();
      states.length = 0; // Clear connection states

      client.onState((state) => states.push(state));

      const closePromise = client.close({ code: 1000, reason: "Done" });
      expect(client.state).toBe("closing");

      await closePromise;
      expect(client.state).toBe("closed");

      // State transitions: open → closing → closed
      expect(states).toEqual(["closing", "closed"]);
    });

    it("isConnected becomes false after close", async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);

      await client.close();
      expect(client.state).toBe("closed");
      expect(client.isConnected).toBe(false);
    });
  });

  describe("Connection failure paths", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
      client = createClient({
        url: "ws://test",
        wsFactory: () => {
          const mockWs = createMockWebSocket();
          // Trigger close event immediately (connection failed)
          setTimeout(() => mockWs.close(1006, "Connection failed"), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("transitions closed → connecting → closed on connection failure", async () => {
      const states: ClientState[] = [];
      client.onState((state) => states.push(state));

      try {
        await client.connect();
      } catch (error) {
        // Expected failure
      }

      expect(client.state).toBe("closed");
      expect(states).toContain("connecting");
      expect(states).toContain("closed");
    });

    it("transitions to reconnecting when reconnect enabled", async () => {
      const states: ClientState[] = [];
      let attemptCount = 0;

      const reconnectClient = createClient({
        url: "ws://test",
        wsFactory: () => {
          attemptCount++;
          const mockWs = createMockWebSocket();
          // Fail first attempt, succeed second
          if (attemptCount === 1) {
            setTimeout(() => mockWs.close(1006, "First attempt failed"), 0);
          } else {
            setTimeout(() => mockWs._trigger.open(), 0);
          }
          return mockWs as unknown as WebSocket;
        },
        reconnect: {
          enabled: true,
          maxAttempts: 2,
          initialDelayMs: 10,
          jitter: "none",
        },
      });

      onTestFinished(async () => {
        await reconnectClient.close();
      });

      reconnectClient.onState((state) => states.push(state));

      // First attempt will fail, but should auto-reconnect
      try {
        await reconnectClient.connect();
      } catch (error) {
        // First connection might fail, but reconnect should succeed
      }

      // Wait for reconnect to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have: connecting → closed → reconnecting → connecting → open
      expect(states).toContain("reconnecting");
      expect(reconnectClient.state).toBe("open");
    });
  });

  describe("Reconnect cycle", () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
      client = createClient({
        url: "ws://test",
        wsFactory: () => {
          const mockWs = createMockWebSocket();
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: {
          enabled: true,
          initialDelayMs: 10,
          maxAttempts: 5,
          jitter: "none",
        },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("transitions to reconnecting state after unexpected close", async () => {
      const states: ClientState[] = [];
      let currentMockWs: ReturnType<typeof createMockWebSocket> | null = null;

      const reconnectClient = createClient({
        url: "ws://test",
        wsFactory: () => {
          const mockWs = createMockWebSocket();
          currentMockWs = mockWs;
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: {
          enabled: true,
          initialDelayMs: 10,
          maxAttempts: 5,
          jitter: "none",
        },
      });

      onTestFinished(async () => {
        await reconnectClient.close();
      });

      // Register state listener before connecting to capture all transitions
      reconnectClient.onState((state) => states.push(state));

      await reconnectClient.connect();
      expect(reconnectClient.state).toBe("open");

      // Clear states captured during initial connection
      const postConnectIndex = states.length;

      // Simulate server closing connection
      currentMockWs!.close(1006, "Connection lost");

      // Wait deterministically for reconnecting state
      await waitForState(reconnectClient, "reconnecting", 500);

      // On unexpected close, client immediately enters reconnecting state
      const reconnectStates = states.slice(postConnectIndex);
      expect(reconnectStates[0]).toBe("reconnecting");
      expect(reconnectClient.state).toBe("reconnecting");
    });

    it("stops reconnecting after maxAttempts", async () => {
      const states: ClientState[] = [];

      const failingClient = createClient({
        url: "ws://test",
        wsFactory: () => {
          const mockWs = createMockWebSocket();
          // Always fail
          setTimeout(() => mockWs.close(1006, "Failed"), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: {
          enabled: true,
          maxAttempts: 2,
          initialDelayMs: 10,
          jitter: "none",
        },
      });

      onTestFinished(async () => {
        await failingClient.close();
      });

      failingClient.onState((state) => states.push(state));

      try {
        await failingClient.connect();
      } catch (error) {
        // Expected - initial connection failed
      }

      // Wait for reconnect attempts to exhaust
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should eventually reach closed state (not reconnecting)
      expect(failingClient.state).toBe("closed");
      // Should have attempted reconnecting
      expect(states).toContain("reconnecting");
    });
  });

  describe("Manual close prevents auto-reconnect", () => {
    let client: ReturnType<typeof createClient>;
    let connectionCount: number;

    beforeEach(() => {
      connectionCount = 0;

      client = createClient({
        url: "ws://test",
        wsFactory: () => {
          connectionCount++;
          const mockWs = createMockWebSocket();
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: {
          enabled: true,
          initialDelayMs: 10,
        },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("does not reconnect after manual close()", async () => {
      await client.connect();
      expect(connectionCount).toBe(1);

      // Manual close
      await client.close();
      expect(client.state).toBe("closed");

      // Wait to ensure no reconnect happens
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(connectionCount).toBe(1); // No reconnect
      expect(client.state).toBe("closed");
    });

    it("allows manual reconnect after manual close", async () => {
      await client.connect();
      expect(connectionCount).toBe(1);

      await client.close();
      expect(client.state).toBe("closed");

      // Manual reconnect should work
      await client.connect();
      expect(connectionCount).toBe(2);
      expect(client.state).toBe("open");
    });
  });

  describe("State transitions with onceOpen()", () => {
    let client: ReturnType<typeof createClient>;
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

    afterEach(async () => {
      await client.close();
    });

    it("resolves immediately if already open", async () => {
      await client.connect();
      expect(client.state).toBe("open");

      // onceOpen should resolve immediately
      const start = Date.now();
      await client.onceOpen();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10); // Immediate resolution
    });

    it("waits for state transition to open", async () => {
      const delayedMockWs = createMockWebSocket();
      const delayedClient = createClient({
        url: "ws://test",
        wsFactory: () => {
          // Delay open event
          setTimeout(() => delayedMockWs._trigger.open(), 20);
          return delayedMockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      onTestFinished(async () => {
        await delayedClient.close();
      });

      expect(delayedClient.state).toBe("closed");

      // Start connection
      const connectPromise = delayedClient.connect();
      const onceOpenPromise = delayedClient.onceOpen();

      await Promise.all([connectPromise, onceOpenPromise]);

      expect(delayedClient.state).toBe("open");
    });
  });

  describe("close() idempotency", () => {
    let client: ReturnType<typeof createClient>;
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

    afterEach(async () => {
      await client.close();
    });

    it("is safe to call close() multiple times", async () => {
      await client.connect();

      // Multiple close() calls should not error
      await client.close();
      await client.close();
      await client.close();

      expect(client.state).toBe("closed");
    });

    it("is safe to call close() when already closed", async () => {
      expect(client.state).toBe("closed");

      // Close when already closed should not error
      await client.close();

      expect(client.state).toBe("closed");
    });
  });

  describe("connect() idempotency", () => {
    let client: ReturnType<typeof createClient>;
    let mockWs: ReturnType<typeof createMockWebSocket>;
    let wsFactoryCalls: number;

    beforeEach(() => {
      wsFactoryCalls = 0;
      mockWs = createMockWebSocket();

      client = createClient({
        url: "ws://test",
        wsFactory: () => {
          wsFactoryCalls++;
          setTimeout(() => mockWs._trigger.open(), 20);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });
    });

    afterEach(async () => {
      await client.close();
    });

    it("returns same promise when already connecting", async () => {
      const promise1 = client.connect();
      const promise2 = client.connect();

      // Both promises should resolve (idempotent)
      await Promise.all([promise1, promise2]);

      expect(client.state).toBe("open");
      // Should only create WebSocket once
      expect(wsFactoryCalls).toBe(1);
    });

    it("resolves immediately when already open", async () => {
      await client.connect();
      expect(client.state).toBe("open");

      // Second connect should resolve immediately
      const start = Date.now();
      await client.connect();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10);
      expect(client.state).toBe("open");
    });
  });
});
