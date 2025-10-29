// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Timestamp Usage Pattern Tests
 *
 * Validates correct usage of ctx.receivedAt (server authoritative time)
 * vs meta.timestamp (client producer time).
 *
 * Spec: @docs/specs/schema.md#Which-timestamp-to-use
 * Spec: @docs/specs/router.md#Server-provided-context-fields
 */

import { describe, expect, expectTypeOf, it, mock } from "bun:test";
import { createRouter, message, z } from "@ws-kit/zod";

// Mock WebSocket
class MockServerWebSocket {
  data: { clientId: string } & Record<string, unknown>;
  sentMessages: unknown[] = [];

  constructor(data: { clientId: string } & Record<string, unknown>) {
    this.data = data;
  }

  send(message: string) {
    this.sentMessages.push(JSON.parse(message));
  }

  close() {
    /* Mock */
  }
}

describe("Timestamp Usage Patterns", () => {
  describe("ctx.receivedAt - Server Authoritative Time", () => {
    it("should provide receivedAt in message context", async () => {
      const TestMsg = message("TEST", { id: z.number() });
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      const handlerMock = mock((ctx) => {
        expect(ctx.receivedAt).toBeDefined();
        expect(typeof ctx.receivedAt).toBe("number");
      });

      router.onMessage(TestMsg, handlerMock);

      await router._core.handleOpen(ws as never);

      // Now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "TEST",
          meta: {},
          payload: { id: 123 },
        }),
      );

      expect(handlerMock).toHaveBeenCalled();
    });

    it("should capture receivedAt before parsing (ingress time)", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      let capturedReceivedAt: number | undefined;
      const before = Date.now();

      router.onMessage(TestMsg, (ctx) => {
        capturedReceivedAt = ctx.receivedAt;
      });

      await router._core.handleOpen(ws as never);

      // Now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({ type: "TEST", meta: {} }),
      );

      const after = Date.now();

      expect(capturedReceivedAt).toBeDefined();
      expect(capturedReceivedAt!).toBeGreaterThanOrEqual(before);
      expect(capturedReceivedAt!).toBeLessThanOrEqual(after);
    });

    it("should use receivedAt for server-side ordering", async () => {
      const TestMsg = message("TEST", { data: z.string() });
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      const receivedTimes: number[] = [];

      router.onMessage(TestMsg, (ctx) => {
        receivedTimes.push(ctx.receivedAt);
      });

      await router._core.handleOpen(ws as never);

      // Send multiple messages
      // Now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({ type: "TEST", meta: {}, payload: { data: "1" } }),
      );
      // Now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({ type: "TEST", meta: {}, payload: { data: "2" } }),
      );
      // Now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({ type: "TEST", meta: {}, payload: { data: "3" } }),
      );

      // receivedAt should be monotonically increasing (or equal)
      expect(receivedTimes.length).toBe(3);
      expect(receivedTimes[1]!).toBeGreaterThanOrEqual(receivedTimes[0]!);
      expect(receivedTimes[2]!).toBeGreaterThanOrEqual(receivedTimes[1]!);
    });

    it("should be independent of client-provided meta.timestamp", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      let serverTime: number | undefined;
      let clientTime: number | undefined;

      router.onMessage(TestMsg, (ctx) => {
        serverTime = ctx.receivedAt;
        clientTime = ctx.meta.timestamp;
      });

      await router._core.handleOpen(ws as never);

      // Client sends message with future timestamp (clock skew)
      const futureTimestamp = Date.now() + 100000; // 100 seconds in future

      // Now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "TEST",
          meta: { timestamp: futureTimestamp },
        }),
      );

      expect(serverTime).toBeDefined();
      expect(clientTime).toBe(futureTimestamp);
      expect(serverTime!).toBeLessThan(futureTimestamp); // Server time is current
    });
  });

  describe("meta.timestamp - Client Producer Time", () => {
    it("should be optional in message context", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();

      router.onMessage(TestMsg, (ctx) => {
        // Type check: timestamp is optional
        expectTypeOf(ctx.meta.timestamp).toEqualTypeOf<number | undefined>();
      });
    });

    it("should accept messages without timestamp", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      const handlerMock = mock((ctx) => {
        expect(ctx.meta.timestamp).toBeUndefined();
      });

      router.onMessage(TestMsg, handlerMock);

      await router._core.handleOpen(ws as never);

      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "TEST",
          meta: {}, // No timestamp
        }),
      );

      expect(handlerMock).toHaveBeenCalled();
    });

    it("should preserve client-provided timestamp", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      const clientTimestamp = 1234567890;
      const handlerMock = mock((ctx) => {
        expect(ctx.meta.timestamp).toBe(clientTimestamp);
      });

      router.onMessage(TestMsg, handlerMock);

      await router._core.handleOpen(ws as never);

      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "TEST",
          meta: { timestamp: clientTimestamp },
        }),
      );

      expect(handlerMock).toHaveBeenCalled();
    });

    it("should be used for UI display (not server logic)", async () => {
      const ChatMsg = message("CHAT", { text: z.string() });
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      router.onMessage(ChatMsg, (ctx) => {
        // UI: Show "sent at" time
        const sentAt = ctx.meta.timestamp;
        if (sentAt !== undefined) {
          // Format for display: new Date(sentAt).toLocaleString()
          expect(typeof sentAt).toBe("number");
        }

        // Server logic: Use receivedAt for ordering, rate limiting, etc.
        const serverTime = ctx.receivedAt;
        expect(typeof serverTime).toBe("number");
        expect(serverTime).toBeGreaterThan(0);
      });

      await router._core.handleOpen(ws as never);

      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "CHAT",
          meta: { timestamp: Date.now() },
          payload: { text: "hello" },
        }),
      );
    });
  });

  describe("Timestamp Decision Matrix", () => {
    it("should use receivedAt for rate limiting", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      // Rate limiter state
      const rateLimits = new Map<string, number[]>();

      router.onMessage(TestMsg, (ctx) => {
        const clientId = ctx.ws.data.clientId as string;
        const history = rateLimits.get(clientId) || [];

        // ✅ CORRECT: Use server time for rate limiting
        history.push(ctx.receivedAt);

        // ❌ WRONG: Using client time allows bypass
        // history.push(ctx.meta.timestamp || Date.now());

        rateLimits.set(clientId, history);
      });

      await router._core.handleOpen(ws as never);

      // Send messages - now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({ type: "TEST", meta: {} }),
      );

      const history = rateLimits.get("test-123");
      expect(history).toBeDefined();
      expect(history!.length).toBe(1);
      expect(history![0]).toBeGreaterThan(0);
    });

    it("should use receivedAt for event ordering", async () => {
      const EventMsg = message("EVENT", { action: z.string() });
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      const events: { action: string; serverTime: number }[] = [];

      router.onMessage(EventMsg, (ctx) => {
        // ✅ CORRECT: Use server time for authoritative ordering
        events.push({
          action: ctx.payload.action,
          serverTime: ctx.receivedAt,
        });
      });

      await router._core.handleOpen(ws as never);

      // Client sends events with manipulated timestamps - now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "EVENT",
          meta: { timestamp: 9999 }, // Fake old time
          payload: { action: "first" },
        }),
      );

      // Now handleMessage is public
      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "EVENT",
          meta: { timestamp: 1 }, // Fake ancient time
          payload: { action: "second" },
        }),
      );

      // Server ordering is correct (by receivedAt)
      expect(events[0]!.serverTime).toBeLessThanOrEqual(events[1]!.serverTime);
    });

    it("should use timestamp for UI lag display", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      router.onMessage(TestMsg, (ctx) => {
        // ✅ CORRECT: Use both for lag calculation
        if (ctx.meta.timestamp !== undefined) {
          const lag = ctx.receivedAt - ctx.meta.timestamp;

          // Display to user: "Message sent X ms ago"
          expect(typeof lag).toBe("number");
          // Lag could be negative (client clock ahead)
        }
      });

      await router._core.handleOpen(ws as never);

      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "TEST",
          meta: { timestamp: Date.now() - 100 }, // Sent 100ms ago
        }),
      );
    });

    it("should use receivedAt for TTL checks", async () => {
      const RequestMsg = message("REQUEST", { id: z.string() });
      const router = createRouter();
      const ws = new MockServerWebSocket({ clientId: "test-123" });

      const TTL_MS = 5000; // 5 seconds

      router.onMessage(RequestMsg, (ctx) => {
        // ✅ CORRECT: Check TTL against server time
        const age = Date.now() - ctx.receivedAt;

        if (age > TTL_MS) {
          // Request too old, ignore
          return;
        }

        // Process request...
        expect(age).toBeLessThanOrEqual(TTL_MS);
      });

      await router._core.handleOpen(ws as never);

      await router._core.handleMessage(
        ws as never,
        JSON.stringify({
          type: "REQUEST",
          meta: { timestamp: Date.now() - 10000 }, // Client says 10s ago
          payload: { id: "req-1" },
        }),
      );
    });
  });

  describe("Type Safety", () => {
    it("should require receivedAt to be number type", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();

      router.onMessage(TestMsg, (ctx) => {
        expectTypeOf(ctx.receivedAt).toBeNumber();
        expectTypeOf(ctx.receivedAt).not.toBeNullable();
      });
    });

    it("should make meta.timestamp optional number", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();

      router.onMessage(TestMsg, (ctx) => {
        expectTypeOf(ctx.meta.timestamp).toEqualTypeOf<number | undefined>();
      });
    });

    it("should distinguish between the two timestamps", async () => {
      const TestMsg = message("TEST");
      const router = createRouter();

      router.onMessage(TestMsg, (ctx) => {
        // Different types and semantics
        expectTypeOf(ctx.receivedAt).toBeNumber(); // Required
        expectTypeOf(ctx.meta.timestamp).toEqualTypeOf<number | undefined>(); // Optional

        // Runtime check required for meta.timestamp
        if (ctx.meta.timestamp !== undefined) {
          expectTypeOf(ctx.meta.timestamp).toBeNumber();
        }
      });
    });
  });
});
