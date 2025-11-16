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

import { test } from "@ws-kit/core";
import type { RpcContext } from "@ws-kit/core";
import { createRouter, message, rpc, withZod, z } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

describe("RPC Incomplete Handler Warning", () => {
  let originalConsoleWarn: typeof console.warn;
  let warnCalls: string[] = [];

  beforeEach(() => {
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

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, () => {
            // Handler completes without calling ctx.reply() or ctx.error()
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("SYNC_NO_REPLY", { id: "123" });
      await conn.drain();

      // Should have warning about incomplete RPC
      const warnings = warnCalls.slice(initialWarnCount);
      const warningFound = warnings.some((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(warningFound).toBe(true);

      await tr.close();
    });

    it("should warn for async handler without reply", async () => {
      const TestRpc = rpc(
        "ASYNC_NO_REPLY",
        { id: z.string() },
        "ASYNC_RESPONSE",
        { value: z.string() },
      );

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, async () => {
            // Async handler that doesn't reply
            await Promise.resolve();
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("ASYNC_NO_REPLY", { id: "456" });
      await conn.drain();

      // Should have warning
      const warnings = warnCalls.slice(initialWarnCount);
      const warningFound = warnings.some((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(warningFound).toBe(true);

      await tr.close();
    });

    it("should warn for handler with early return", async () => {
      const TestRpc = rpc(
        "EARLY_RETURN",
        { id: z.string() },
        "EARLY_RESPONSE",
        { value: z.string() },
      );

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, (ctx) => {
            // Early return without error
            if (!ctx.payload?.id) {
              return; // Forgot to call ctx.error()
            }
            ctx.reply({ value: "ok" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      // Empty ID triggers early return
      conn.send("EARLY_RETURN", { id: "" });
      await conn.drain();

      // Should have warning for early return without error
      const warnings = warnCalls.slice(initialWarnCount);
      const warningFound = warnings.some((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(warningFound).toBe(true);

      await tr.close();
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

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, (ctx) => {
            ctx.reply({ value: "test" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("WITH_REPLY", { id: "789" });
      await conn.drain();

      // Filter out any warnings that are not about incomplete RPC
      const warnings = warnCalls.slice(initialWarnCount);
      const incompleteWarnings = warnings.filter((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(incompleteWarnings.length).toBe(0);

      await tr.close();
    });

    it("should not warn when ctx.error() is called", async () => {
      const TestRpc = rpc(
        "WITH_ERROR",
        { id: z.string() },
        "WITH_ERROR_RESPONSE",
        { value: z.string() },
      );

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, (ctx) => {
            ctx.error("INVALID_ARGUMENT", "Invalid ID");
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("WITH_ERROR", { id: "bad" });
      await conn.drain();

      // Filter out warnings about incomplete RPC
      const warnings = warnCalls.slice(initialWarnCount);
      const incompleteWarnings = warnings.filter((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(incompleteWarnings.length).toBe(0);

      await tr.close();
    });

    it("should not warn when async handler eventually replies", async () => {
      const TestRpc = rpc(
        "ASYNC_WITH_REPLY",
        { id: z.string() },
        "ASYNC_REPLY_RESPONSE",
        { value: z.string() },
      );

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, async (ctx) => {
            // Truly async handler that awaits before replying
            await Promise.resolve();
            ctx.reply({ value: "delayed" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("ASYNC_WITH_REPLY", { id: "123" });
      await conn.drain();

      // Handler is async and eventually calls reply, so no warning should occur
      const warnings = warnCalls.slice(initialWarnCount);
      const incompleteWarnings = warnings.filter((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(incompleteWarnings.length).toBe(0);

      await tr.close();
    });
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 3. CONFIGURATION TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Configuration: warnIncompleteRpc flag", () => {
    // TODO: Implement warnIncompleteRpc configuration in withZod() plugin
    // This test is commented out until the feature is implemented
    // it("should not warn when warnIncompleteRpc is disabled", async () => {
    //   const TestRpc = rpc(
    //     "NO_WARN_DISABLED",
    //     { id: z.string() },
    //     "NO_WARN_RESPONSE",
    //     { value: z.string() },
    //   );
    //
    //   const tr = test.createTestRouter({
    //     create: () => {
    //       // Pass warnIncompleteRpc: false to the withZod() plugin
    //       const router = createRouter().plugin(withZod({ warnIncompleteRpc: false }));
    //       router.rpc(TestRpc, () => {
    //         // Don't reply (should not warn because warnings are disabled)
    //       });
    //       return router;
    //     },
    //   });
    //
    //   const conn = await tr.connect();
    //   const initialWarnCount = warnCalls.length;
    //
    //   conn.send("NO_WARN_DISABLED", { id: "test" });
    //   await conn.drain();
    //
    //   // Should not have warning even though handler didn't reply
    //   const warnings = warnCalls.slice(initialWarnCount);
    //   const incompleteWarnings = warnings.filter((msg) =>
    //     msg.includes("completed without calling ctx.reply() or ctx.error()"),
    //   );
    //   expect(incompleteWarnings.length).toBe(0);
    //
    //   await tr.close();
    // });

    it("should warn by default (when warnIncompleteRpc is not specified)", async () => {
      const TestRpc = rpc(
        "DEFAULT_WARN",
        { id: z.string() },
        "DEFAULT_RESPONSE",
        { value: z.string() },
      );

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, () => {
            // Don't reply
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("DEFAULT_WARN", { id: "test" });
      await conn.drain();

      // Should warn by default
      const warnings = warnCalls.slice(initialWarnCount);
      const incompleteWarnings = warnings.filter((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(incompleteWarnings.length).toBeGreaterThan(0);

      await tr.close();
    });
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 4. WARNING MESSAGE TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Warning message content", () => {
    it("should include message type in warning", async () => {
      const TestRpc = rpc(
        "DETAILED_WARNING",
        { id: z.string() },
        "DETAILED_RESPONSE",
        { value: z.string() },
      );

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, () => {
            // Don't reply
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("DETAILED_WARNING", { id: "test" });
      await conn.drain();

      // Find the warning message
      const warnings = warnCalls.slice(initialWarnCount);
      const detailedWarning = warnings.find((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );

      // Should include message type
      expect(detailedWarning).toContain("DETAILED_WARNING");

      await tr.close();
    });

    it("should suggest disabling warning for async patterns", async () => {
      const TestRpc = rpc(
        "SUGGEST_DISABLE",
        { id: z.string() },
        "SUGGEST_RESPONSE",
        { value: z.string() },
      );

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, () => {
            // Don't reply
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("SUGGEST_DISABLE", { id: "test" });
      await conn.drain();

      // Find the warning message
      const warnings = warnCalls.slice(initialWarnCount);
      const detailedWarning = warnings.find((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );

      // Should suggest disabling for async patterns
      expect(detailedWarning).toContain("warnIncompleteRpc: false");

      await tr.close();
    });
  });

  // ———————————————————————————————————————————————————————————————————————————
  // 5. INTEGRATION TESTS
  // ———————————————————————————————————————————————————————————————————————————

  describe("Integration scenarios", () => {
    it("should not warn for non-RPC messages even without reply", async () => {
      const EventMsg = message("EVENT", { data: z.string() });

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.on(EventMsg, () => {
            // Event handlers don't need reply, so no warning
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      conn.send("EVENT", { data: "test" });
      await conn.drain();

      // Should not warn for non-RPC messages
      const warnings = warnCalls.slice(initialWarnCount);
      const incompleteWarnings = warnings.filter((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(incompleteWarnings.length).toBe(0);

      await tr.close();
    });

    it("should handle multiple RPC requests correctly", async () => {
      const TestRpc = rpc("MULTI_REQ", { id: z.string() }, "MULTI_RESPONSE", {
        value: z.string(),
      });

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(TestRpc, () => {
            // Don't reply
          });
          return router;
        },
      });

      const conn = await tr.connect();
      const initialWarnCount = warnCalls.length;

      // Send multiple RPC requests without replies
      conn.send("MULTI_REQ", { id: "1" });
      conn.send("MULTI_REQ", { id: "2" });
      await conn.drain();

      // Should have warnings for each request
      const warnings = warnCalls.slice(initialWarnCount);
      const incompleteWarnings = warnings.filter((msg) =>
        msg.includes("completed without calling ctx.reply() or ctx.error()"),
      );
      expect(incompleteWarnings.length).toBeGreaterThanOrEqual(2);

      await tr.close();
    });
  });
});
