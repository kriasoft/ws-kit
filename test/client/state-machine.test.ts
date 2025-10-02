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
 * See @client.md#connection-state-machine
 * See @implementation-status.md#GAP-014
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createClient } from "../../client/index";
import type { ClientState } from "../../client/types";
import { createMessageSchema } from "../../zod/schema";
import { createMockWebSocket } from "./helpers";

const { messageSchema } = createMessageSchema(z);
messageSchema("TEST", { id: z.number() });

describe("Client: State Machine Transitions", () => {
  describe("Happy path: closed → connecting → open", () => {
    it("transitions through connecting to open on successful connection", async () => {
      const states: ClientState[] = [];
      const mockWs = createMockWebSocket();

      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

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
      const mockWs = createMockWebSocket();
      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      expect(client.state).toBe("closed");
      expect(client.isConnected).toBe(false);

      await client.connect();
      expect(client.state).toBe("open");
      expect(client.isConnected).toBe(true);
    });
  });

  describe("Graceful close: open → closing → closed", () => {
    it("transitions through closing to closed on manual close", async () => {
      const states: ClientState[] = [];
      const mockWs = createMockWebSocket();

      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

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
      const mockWs = createMockWebSocket();
      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      await client.connect();
      expect(client.isConnected).toBe(true);

      await client.close();
      expect(client.state).toBe("closed");
      expect(client.isConnected).toBe(false);
    });
  });

  describe("Connection failure paths", () => {
    it("transitions closed → connecting → closed on connection failure", async () => {
      const states: ClientState[] = [];

      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          const mockWs = createMockWebSocket();
          // Trigger close event immediately (connection failed)
          setTimeout(() => mockWs.close(1006, "Connection failed"), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

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

      const client = createClient({
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

      client.onState((state) => states.push(state));

      // First attempt will fail, but should auto-reconnect
      try {
        await client.connect();
      } catch (error) {
        // First connection might fail, but reconnect should succeed
      }

      // Wait for reconnect to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have: connecting → closed → reconnecting → connecting → open
      expect(states).toContain("reconnecting");
      expect(client.state).toBe("open");
    });
  });

  describe("Reconnect cycle", () => {
    it.skip("transitions to reconnecting state after unexpected close", async () => {
      const states: ClientState[] = [];
      let currentMockWs: ReturnType<typeof createMockWebSocket> | null = null;

      const client = createClient({
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

      client.onState((state) => states.push(state));

      await client.connect();
      expect(client.state).toBe("open");

      states.length = 0; // Clear initial connection states

      // Simulate server closing connection
      currentMockWs!.close(1006, "Connection lost");

      // Wait briefly for state transition
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should have transitioned to reconnecting
      expect(states).toContain("closed");
      expect(states).toContain("reconnecting");
    });

    it("stops reconnecting after maxAttempts", async () => {
      const states: ClientState[] = [];

      const client = createClient({
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

      client.onState((state) => states.push(state));

      try {
        await client.connect();
      } catch (error) {
        // Expected - initial connection failed
      }

      // Wait for reconnect attempts to exhaust
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should eventually reach closed state (not reconnecting)
      expect(client.state).toBe("closed");
      // Should have attempted reconnecting
      expect(states).toContain("reconnecting");
    });
  });

  describe("Manual close prevents auto-reconnect", () => {
    it("does not reconnect after manual close()", async () => {
      let connectionCount = 0;

      const client = createClient({
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
      let connectionCount = 0;

      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          connectionCount++;
          const mockWs = createMockWebSocket();
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: true },
      });

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
    it("resolves immediately if already open", async () => {
      const mockWs = createMockWebSocket();
      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      await client.connect();
      expect(client.state).toBe("open");

      // onceOpen should resolve immediately
      const start = Date.now();
      await client.onceOpen();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10); // Immediate resolution
    });

    it("waits for state transition to open", async () => {
      const mockWs = createMockWebSocket();
      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          // Delay open event
          setTimeout(() => mockWs._trigger.open(), 20);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      expect(client.state).toBe("closed");

      // Start connection
      const connectPromise = client.connect();
      const onceOpenPromise = client.onceOpen();

      await Promise.all([connectPromise, onceOpenPromise]);

      expect(client.state).toBe("open");
    });
  });

  describe("close() idempotency", () => {
    it("is safe to call close() multiple times", async () => {
      const mockWs = createMockWebSocket();
      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      await client.connect();

      // Multiple close() calls should not error
      await client.close();
      await client.close();
      await client.close();

      expect(client.state).toBe("closed");
    });

    it("is safe to call close() when already closed", async () => {
      const client = createClient({
        url: "ws://test",
        reconnect: { enabled: false },
      });

      expect(client.state).toBe("closed");

      // Close when already closed should not error
      await client.close();

      expect(client.state).toBe("closed");
    });
  });

  describe("connect() idempotency", () => {
    it("returns same promise when already connecting", async () => {
      let wsFactoryCalls = 0;
      const mockWs = createMockWebSocket();

      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          wsFactoryCalls++;
          setTimeout(() => mockWs._trigger.open(), 20);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

      const promise1 = client.connect();
      const promise2 = client.connect();

      // Both promises should resolve (idempotent)
      await Promise.all([promise1, promise2]);

      expect(client.state).toBe("open");
      // Should only create WebSocket once
      expect(wsFactoryCalls).toBe(1);
    });

    it("resolves immediately when already open", async () => {
      const mockWs = createMockWebSocket();
      const client = createClient({
        url: "ws://test",
        wsFactory: () => {
          setTimeout(() => mockWs._trigger.open(), 0);
          return mockWs as unknown as WebSocket;
        },
        reconnect: { enabled: false },
      });

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
