// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client Queue Behavior Tests
 *
 * Tests message queueing when state !== "open":
 * - drop-newest: Queue up to limit, reject overflow
 * - drop-oldest: Queue up to limit, evict oldest on overflow
 * - off: Drop immediately (no queue)
 *
 * See docs/specs/client.md#queue-behavior
 */

import type { WebSocketClient } from "@ws-kit/client";
import { createClient } from "@ws-kit/client";
import { message, z } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockWebSocket } from "../helpers.js";

// Test schema
const TestMsg = message("TEST", { id: z.number() });

describe("Client: Queue Behavior", () => {
  describe("drop-newest mode (default)", () => {
    let mockWs: ReturnType<typeof createMockWebSocket>;
    let client: WebSocketClient;

    beforeEach(() => {
      mockWs = createMockWebSocket();
      client = createClient({
        url: "ws://test",
        queue: "drop-newest",
        queueSize: 3,
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

    it("queues messages while disconnected", () => {
      // Not connected - messages should queue
      const sent1 = client.send(TestMsg, { id: 1 });
      const sent2 = client.send(TestMsg, { id: 2 });

      expect(sent1).toBe(true); // Queued
      expect(sent2).toBe(true); // Queued
    });

    it("rejects overflow when queue full", () => {
      // Fill queue (size: 3)
      expect(client.send(TestMsg, { id: 1 })).toBe(true);
      expect(client.send(TestMsg, { id: 2 })).toBe(true);
      expect(client.send(TestMsg, { id: 3 })).toBe(true);

      // Overflow - should reject (drop newest)
      expect(client.send(TestMsg, { id: 4 })).toBe(false);
    });

    it("flushes queued messages on connection open", async () => {
      // Queue messages while disconnected
      client.send(TestMsg, { id: 1 });
      client.send(TestMsg, { id: 2 });
      client.send(TestMsg, { id: 3 });

      // Connect - should flush queue
      await client.connect();

      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(3);
      expect(sent[0].payload.id).toBe(1);
      expect(sent[1].payload.id).toBe(2);
      expect(sent[2].payload.id).toBe(3);
    });

    it("sends messages immediately when connected", async () => {
      await client.connect();

      const sent1 = client.send(TestMsg, { id: 10 });
      const sent2 = client.send(TestMsg, { id: 20 });

      expect(sent1).toBe(true);
      expect(sent2).toBe(true);

      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(2);
      expect(sent[0].payload.id).toBe(10);
      expect(sent[1].payload.id).toBe(20);
    });

    it("preserves message order after flush", async () => {
      // Queue 3 messages
      client.send(TestMsg, { id: 1 });
      client.send(TestMsg, { id: 2 });
      client.send(TestMsg, { id: 3 });

      // Connect and flush
      await client.connect();

      // Send immediate message
      client.send(TestMsg, { id: 4 });

      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(4);
      expect(sent.map((m) => m.payload.id)).toEqual([1, 2, 3, 4]);
    });
  });

  describe("drop-oldest mode", () => {
    let mockWs: ReturnType<typeof createMockWebSocket>;
    let client: WebSocketClient;

    beforeEach(() => {
      mockWs = createMockWebSocket();
      client = createClient({
        url: "ws://test",
        queue: "drop-oldest",
        queueSize: 3,
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

    it("evicts oldest on overflow", () => {
      // Fill queue
      expect(client.send(TestMsg, { id: 1 })).toBe(true); // Queue: [1]
      expect(client.send(TestMsg, { id: 2 })).toBe(true); // Queue: [1, 2]
      expect(client.send(TestMsg, { id: 3 })).toBe(true); // Queue: [1, 2, 3]

      // Overflow - should evict oldest (id: 1), accept newest (id: 4)
      expect(client.send(TestMsg, { id: 4 })).toBe(true); // Queue: [2, 3, 4]
    });

    it("flushes only retained messages after eviction", async () => {
      // Queue 4 messages (queue size: 3)
      client.send(TestMsg, { id: 1 }); // Will be evicted
      client.send(TestMsg, { id: 2 });
      client.send(TestMsg, { id: 3 });
      client.send(TestMsg, { id: 4 }); // Evicts id: 1

      // Connect - should flush only [2, 3, 4]
      await client.connect();

      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(3);
      expect(sent.map((m) => m.payload.id)).toEqual([2, 3, 4]);
    });

    it("continues accepting messages after overflow", () => {
      // Fill and overflow
      client.send(TestMsg, { id: 1 });
      client.send(TestMsg, { id: 2 });
      client.send(TestMsg, { id: 3 });
      client.send(TestMsg, { id: 4 }); // Evicts 1

      // Should still accept new messages
      expect(client.send(TestMsg, { id: 5 })).toBe(true); // Evicts 2
    });
  });

  describe("off mode", () => {
    let mockWs: ReturnType<typeof createMockWebSocket>;
    let client: WebSocketClient;

    beforeEach(() => {
      mockWs = createMockWebSocket();
      client = createClient({
        url: "ws://test",
        queue: "off",
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

    it("drops messages immediately when disconnected", () => {
      // Not connected - should drop immediately
      const sent1 = client.send(TestMsg, { id: 1 });
      const sent2 = client.send(TestMsg, { id: 2 });

      expect(sent1).toBe(false); // Dropped
      expect(sent2).toBe(false); // Dropped
    });

    it("sends nothing after connection (no queue)", async () => {
      // Try to send while disconnected
      client.send(TestMsg, { id: 1 });
      client.send(TestMsg, { id: 2 });

      // Connect
      await client.connect();

      // No messages should be sent (dropped before connection)
      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(0);
    });

    it("sends immediately when connected", async () => {
      await client.connect();

      const sent1 = client.send(TestMsg, { id: 10 });
      const sent2 = client.send(TestMsg, { id: 20 });

      expect(sent1).toBe(true);
      expect(sent2).toBe(true);

      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(2);
    });
  });

  describe("queue interaction with close()", () => {
    let mockWs: ReturnType<typeof createMockWebSocket>;
    let client: WebSocketClient;

    beforeEach(() => {
      mockWs = createMockWebSocket();
      client = createClient({
        url: "ws://test",
        queue: "drop-newest",
        queueSize: 10,
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

    it("clears queue on manual close", async () => {
      // Queue messages while disconnected
      client.send(TestMsg, { id: 1 });
      client.send(TestMsg, { id: 2 });
      client.send(TestMsg, { id: 3 });

      // Close before connecting
      await client.close();

      // Now connect - queue should have been cleared
      await client.connect();

      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(0); // Queue cleared by close()
    });
  });

  describe("invalid payloads", () => {
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

    afterEach(async () => {
      await client.close();
    });

    it("returns false for invalid payload type", () => {
      // TestMsg expects { id: number }, but we pass string
      const sent = client.send(TestMsg, { id: "invalid" } as unknown as Record<
        string,
        number
      >);
      expect(sent).toBe(false);
    });

    it("returns false for missing required payload field", () => {
      const sent = client.send(TestMsg, {} as Record<string, number>);
      expect(sent).toBe(false);
    });

    it("drops nothing to queue when validation fails", async () => {
      // Send invalid, then connect
      client.send(TestMsg, { id: "invalid" } as unknown as Record<
        string,
        number
      >);
      await client.connect();

      const sent = mockWs._getSentMessages();
      expect(sent).toHaveLength(0); // No message sent, none queued
    });
  });
});
