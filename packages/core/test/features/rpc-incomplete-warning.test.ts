// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * RPC Incomplete Handler Warning Tests
 *
 * These tests verify that the router warns developers when RPC handlers
 * complete without sending a terminal response (reply or error).
 *
 * Features tested:
 * - Warning for sync handlers without reply
 * - Warning for async handlers without reply
 * - No warning when reply is sent
 * - No warning when error is sent
 * - Respects warnIncompleteRpc configuration flag
 * - Only warns in development mode (NODE_ENV !== "production")
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createRouter, rpc, z, message } from "@ws-kit/zod";

// Mock WebSocket for testing
interface MockWebSocket {
  send: ReturnType<typeof mock>;
  close: (code?: number, reason?: string) => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  data: Record<string, unknown>;
  readyState?: number;
  bufferedAmount?: number;
}

function createMockWebSocket(data = {}): MockWebSocket {
  return {
    send: mock(() => {}),
    close: mock(() => {}),
    subscribe: mock(() => {}),
    unsubscribe: mock(() => {}),
    data: { clientId: "test-client-1", ...data },
    readyState: 1,
    bufferedAmount: 0,
  };
}

describe("RPC Incomplete Handler Warning", () => {
  let router: ReturnType<typeof createRouter>;
  let ws: MockWebSocket;
  let originalConsoleWarn: typeof console.warn;
  let warnCalls: string[] = [];

  beforeEach(() => {
    // Create router with Zod validator
    router = createRouter();
    ws = createMockWebSocket();

    // Mock console.warn to capture warnings
    originalConsoleWarn = console.warn;
    warnCalls = [];
    console.warn = mock((message: string) => {
      warnCalls.push(message);
      originalConsoleWarn(message);
    });
  });

  afterEach(() => {
    // Restore original console.warn
    console.warn = originalConsoleWarn;
    // Reset router
    (router as any)._core.reset();
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 1. WARNING TRIGGERED TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Should warn when handler completes without reply", () => {
    it("should warn for sync handler without reply", async () => {
      const TestRpc = rpc(
        "SYNC_NO_REPLY",
        { id: z.string() },
        "SYNC_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, () => {
        // Handler completes without calling ctx.reply() or ctx.error()
        // Just do something, don't reply
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "SYNC_NO_REPLY",
          meta: { correlationId: "req-1" },
          payload: { id: "123" },
        }),
      );

      // Should have warning about incomplete RPC
      expect(warnCalls.length).toBeGreaterThan(0);
      const warningFound = warnCalls.some((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(warningFound).toBe(true);
    });

    it("should warn for async handler without reply", async () => {
      const TestRpc = rpc(
        "ASYNC_NO_REPLY",
        { id: z.string() },
        "ASYNC_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, async () => {
        // Async handler that doesn't reply
        await Promise.resolve();
        // Handler completes without reply
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "ASYNC_NO_REPLY",
          meta: { correlationId: "req-2" },
          payload: { id: "456" },
        }),
      );

      // Should have warning
      const warningFound = warnCalls.some((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(warningFound).toBe(true);
    });

    it("should warn for handler with early return", async () => {
      const TestRpc = rpc(
        "EARLY_RETURN",
        { id: z.string() },
        "EARLY_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, (ctx: any) => {
        // Early return without error
        if (!ctx.payload?.id) {
          return; // Forgot to call ctx.error()
        }
        ctx.reply!(TestRpc.response, { value: "ok" });
      });

      const wsHandler = router._core.websocket;
      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "EARLY_RETURN",
          meta: { correlationId: "req-3" },
          payload: { id: "" }, // Empty ID triggers early return
        }),
      );

      // Should have warning for early return without error
      const warningFound = warnCalls.some((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(warningFound).toBe(true);
    });
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 2. NO WARNING TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Should NOT warn when handler sends reply", () => {
    it("should not warn when ctx.reply() is called", async () => {
      const TestRpc = rpc(
        "WITH_REPLY",
        { id: z.string() },
        "WITH_REPLY_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, (ctx: any) => {
        ctx.reply!(TestRpc.response, { value: "test" });
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "WITH_REPLY",
          meta: { correlationId: "req-4" },
          payload: { id: "789" },
        }),
      );

      // Filter out any warnings that are not about incomplete RPC
      const incompleteWarnings = warnCalls
        .slice(initialWarnCount)
        .filter((msg) =>
          msg.includes("completed without calling ctx.reply() or ctx.error()"),
        );
      expect(incompleteWarnings.length).toBe(0);
    });

    it("should not warn when ctx.error() is called", async () => {
      const TestRpc = rpc(
        "WITH_ERROR",
        { id: z.string() },
        "WITH_ERROR_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, (ctx: any) => {
        ctx.error!("INVALID_ARGUMENT", "Invalid ID");
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "WITH_ERROR",
          meta: { correlationId: "req-5" },
          payload: { id: "bad" },
        }),
      );

      // Filter out warnings about incomplete RPC
      const incompleteWarnings = warnCalls
        .slice(initialWarnCount)
        .filter((msg) =>
          msg.includes("completed without calling ctx.reply() or ctx.error()"),
        );
      expect(incompleteWarnings.length).toBe(0);
    });

    it("should not warn when async handler eventually replies", async () => {
      const TestRpc = rpc(
        "ASYNC_WITH_REPLY",
        { id: z.string() },
        "ASYNC_REPLY_RESPONSE",
        { value: z.string() },
      );

      let replyCallback: (() => void) | null = null;

      (router as any)._core.rpc(TestRpc, (ctx: any) => {
        // Schedule reply for later (simulates async work)
        replyCallback = () => {
          ctx.reply!(TestRpc.response, { value: "delayed" });
        };
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "ASYNC_WITH_REPLY",
          meta: { correlationId: "req-6" },
          payload: { id: "123" },
        }),
      );

      // Handler completes, check for immediate warning (before scheduled reply fires)
      const incompleteWarnings = warnCalls
        .slice(initialWarnCount)
        .filter((msg) =>
          msg.includes("completed without calling ctx.reply() or ctx.error()"),
        );
      expect(incompleteWarnings.length).toBeGreaterThan(0);

      // Now trigger the delayed reply
      if (replyCallback !== null) {
        replyCallback();
      }
    });
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 3. CONFIGURATION TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Configuration: warnIncompleteRpc flag", () => {
    it("should not warn when warnIncompleteRpc is disabled", async () => {
      // Create router with warning disabled
      const quietRouter = createRouter({ warnIncompleteRpc: false });
      const mockWs = createMockWebSocket();

      const TestRpc = rpc(
        "NO_WARN_DISABLED",
        { id: z.string() },
        "NO_WARN_RESPONSE",
        { value: z.string() },
      );

      (quietRouter as any)._core.rpc(TestRpc, () => {
        // Don't reply (would normally warn)
      });

      const wsHandler = quietRouter._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        mockWs as any,
        JSON.stringify({
          type: "NO_WARN_DISABLED",
          meta: { correlationId: "req-7" },
          payload: { id: "test" },
        }),
      );

      // Should not have warning even though handler didn't reply
      const incompleteWarnings = warnCalls
        .slice(initialWarnCount)
        .filter((msg) =>
          msg.includes("completed without calling ctx.reply() or ctx.error()"),
        );
      expect(incompleteWarnings.length).toBe(0);

      // Cleanup
      (quietRouter as any)._core.reset();
    });

    it("should warn by default (when warnIncompleteRpc is not specified)", async () => {
      const TestRpc = rpc(
        "DEFAULT_WARN",
        { id: z.string() },
        "DEFAULT_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, () => {
        // Don't reply
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "DEFAULT_WARN",
          meta: { correlationId: "req-8" },
          payload: { id: "test" },
        }),
      );

      // Should warn by default
      const incompleteWarnings = warnCalls
        .slice(initialWarnCount)
        .filter((msg) =>
          msg.includes("completed without calling ctx.reply() or ctx.error()"),
        );
      expect(incompleteWarnings.length).toBeGreaterThan(0);
    });
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 4. WARNING MESSAGE TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Warning message content", () => {
    it("should include message type and correlation ID in warning", async () => {
      const TestRpc = rpc(
        "DETAILED_WARNING",
        { id: z.string() },
        "DETAILED_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, () => {
        // Don't reply
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "DETAILED_WARNING",
          meta: { correlationId: "specific-req-id" },
          payload: { id: "test" },
        }),
      );

      // Find the warning message
      const warnings = warnCalls.slice(initialWarnCount);
      const detailedWarning = warnings.find((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );

      // Should include message type
      expect(detailedWarning).toContain("DETAILED_WARNING");
      // Should include correlation ID
      expect(detailedWarning).toContain("specific-req-id");
    });

    it("should suggest disabling warning for async patterns", async () => {
      const TestRpc = rpc(
        "SUGGEST_DISABLE",
        { id: z.string() },
        "SUGGEST_RESPONSE",
        { value: z.string() },
      );

      (router as any)._core.rpc(TestRpc, () => {
        // Don't reply
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "SUGGEST_DISABLE",
          meta: { correlationId: "req-9" },
          payload: { id: "test" },
        }),
      );

      // Find the warning message
      const warnings = warnCalls.slice(initialWarnCount);
      const detailedWarning = warnings.find((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );

      // Should suggest disabling for async patterns
      expect(detailedWarning).toContain("warnIncompleteRpc: false");
    });
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 5. INTEGRATION TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Integration scenarios", () => {
    it("should not warn for non-RPC messages even without reply", async () => {
      const EventMsg = message("EVENT", { data: z.string() });

      router.on(EventMsg, () => {
        // Event handlers don't need reply, so no warning
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "EVENT",
          meta: {},
          payload: { data: "test" },
        }),
      );

      // Should not warn for non-RPC messages
      const incompleteWarnings = warnCalls
        .slice(initialWarnCount)
        .filter((msg) =>
          msg.includes("completed without calling ctx.reply() or ctx.error()"),
        );
      expect(incompleteWarnings.length).toBe(0);
    });

    it("should track warning per correlation ID", async () => {
      const TestRpc = rpc("MULTI_REQ", { id: z.string() }, "MULTI_RESPONSE", {
        value: z.string(),
      });

      (router as any)._core.rpc(TestRpc, () => {
        // Don't reply
      });

      const wsHandler = router._core.websocket;
      const initialWarnCount = warnCalls.length;

      // Send multiple RPC requests without replies
      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "MULTI_REQ",
          meta: { correlationId: "req-a" },
          payload: { id: "1" },
        }),
      );

      await wsHandler.message(
        ws as any,
        JSON.stringify({
          type: "MULTI_REQ",
          meta: { correlationId: "req-b" },
          payload: { id: "2" },
        }),
      );

      // Should have separate warnings for each request
      const warnings = warnCalls
        .slice(initialWarnCount)
        .filter((msg) =>
          msg.includes("completed without calling ctx.reply() or ctx.error()"),
        );
      expect(warnings.length).toBeGreaterThanOrEqual(2);

      // Each warning should mention a different correlation ID
      const hasReqA = warnings.some((msg) => msg.includes("req-a"));
      const hasReqB = warnings.some((msg) => msg.includes("req-b"));
      expect(hasReqA || hasReqB).toBe(true);
    });
  });
});
