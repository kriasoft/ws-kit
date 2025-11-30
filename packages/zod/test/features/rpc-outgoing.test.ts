// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Integration tests for RPC outgoing messages (reply, progress, error)
 *
 * Tests that verify WebSocket transmission of reply/progress/error messages,
 * exercising the fire-and-forget and async paths in the RPC plugin.
 *
 * Spec: docs/specs/context-methods.md#ctx-reply
 *       docs/specs/context-methods.md#ctx-progress
 *       docs/specs/context-methods.md#ctx-error
 */

import { test } from "@ws-kit/core/testing";
import { createRouter, rpc, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

const GetUser = rpc("GET_USER", { id: z.string() }, "USER", {
  id: z.string(),
  name: z.string(),
});

// Internal message type for RPC progress updates
const RPC_PROGRESS = "$ws:rpc-progress";

// Helper to wait for setImmediate to execute (fire-and-forget uses setImmediate)
const waitForImmediate = () => new Promise((r) => setImmediate(r));

describe("RPC outgoing messages integration", () => {
  describe("ctx.reply() - fire-and-forget", () => {
    it("sends response to WebSocket", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.reply({ id: ctx.payload.id, name: "Alice" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "USER");
      expect(response).toBeDefined();
      expect(response!.payload).toEqual({ id: "u1", name: "Alice" });
      await tr.close();
    });

    it("sends empty object payload when schema is empty", async () => {
      const EmptyResponse = rpc("EMPTY_REQ", {}, "EMPTY_RES", {});

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(EmptyResponse, (ctx) => {
            ctx.reply({});
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("EMPTY_REQ", {});
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "EMPTY_RES");
      expect(response).toBeDefined();
      expect(response!.payload).toEqual({});
      await tr.close();
    });

    it("preserves correlationId from inbound request", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.reply({ id: ctx.payload.id, name: "Alice" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" }, { correlationId: "req-123" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "USER");
      expect(response).toBeDefined();
      expect(response!.meta?.correlationId).toBe("req-123");
      await tr.close();
    });

    it("merges custom metadata into response", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.reply(
              { id: ctx.payload.id, name: "Alice" },
              { meta: { traceId: "trace-456" } },
            );
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "USER");
      expect(response).toBeDefined();
      expect(response!.meta?.traceId).toBe("trace-456");
      await tr.close();
    });

    it("sanitizes reserved keys from meta", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.reply(
              { id: ctx.payload.id, name: "Alice" },
              {
                meta: {
                  type: "HACKED",
                  correlationId: "fake",
                  customField: "preserved",
                },
              },
            );
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" }, { correlationId: "req-original" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "USER");
      expect(response).toBeDefined();
      expect(response!.type).toBe("USER"); // Not overridden
      expect(response!.meta?.correlationId).toBe("req-original"); // Original preserved
      expect(response!.meta?.customField).toBe("preserved");
      await tr.close();
    });

    it("one-shot guard prevents multiple replies from sending", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.reply({ id: "first", name: "Alice" });
            ctx.reply({ id: "second", name: "Bob" }); // Should be ignored
            ctx.reply({ id: "third", name: "Charlie" }); // Should be ignored
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const responses = messages.filter((m) => m.type === "USER");
      expect(responses.length).toBe(1);
      expect(responses[0]!.payload).toEqual({ id: "first", name: "Alice" });
      await tr.close();
    });
  });

  // NOTE: {waitFor} is currently stubbed to resolve immediately.
  // When real drain/ack tracking is implemented, these tests should be updated to:
  // 1. Verify actual buffer drain behavior
  // 2. Test signal abort after enqueue (not just before)
  // 3. Test backpressure scenarios
  describe("ctx.reply() - with {waitFor}", () => {
    it("returns Promise that resolves after send", async () => {
      let replyResult;

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, async (ctx) => {
            replyResult = await ctx.reply(
              { id: ctx.payload.id, name: "Alice" },
              { waitFor: "drain" },
            );
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      expect(replyResult).toBeUndefined(); // Promise<void> resolves to void
      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "USER");
      expect(response).toBeDefined();
      await tr.close();
    });

    it("with {waitFor} preserves correlationId", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, async (ctx) => {
            await ctx.reply(
              { id: ctx.payload.id, name: "Alice" },
              { waitFor: "drain" },
            );
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" }, { correlationId: "req-789" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "USER");
      expect(response).toBeDefined();
      expect(response!.meta?.correlationId).toBe("req-789");
      await tr.close();
    });
  });

  describe("ctx.reply() - with {signal}", () => {
    it("gracefully skips if signal aborted before enqueue", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            const controller = new AbortController();
            controller.abort();
            // Note: withZod wraps reply() as async, so it always returns Promise
            ctx.reply(
              { id: ctx.payload.id, name: "Alice" },
              { signal: controller.signal },
            );
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      // Message should not be sent when signal is aborted
      const messages = conn.outgoing();
      const response = messages.find((m) => m.type === "USER");
      expect(response).toBeUndefined();
      await tr.close();
    });
  });

  describe("ctx.progress() - fire-and-forget", () => {
    it("sends progress update to WebSocket", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.progress({ id: ctx.payload.id, name: "Loading..." });
            ctx.reply({ id: ctx.payload.id, name: "Alice" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progress = messages.find((m) => m.type === RPC_PROGRESS);
      expect(progress).toBeDefined();
      expect(progress!.payload).toEqual({ id: "u1", name: "Loading..." });
      await tr.close();
    });

    it("allows multiple progress updates before reply", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.progress({ id: ctx.payload.id, name: "Step 1" });
            ctx.progress({ id: ctx.payload.id, name: "Step 2" });
            ctx.progress({ id: ctx.payload.id, name: "Step 3" });
            ctx.reply({ id: ctx.payload.id, name: "Complete" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progressMsgs = messages.filter((m) => m.type === RPC_PROGRESS);
      expect(progressMsgs.length).toBe(3);
      await tr.close();
    });

    it("preserves correlationId in progress updates", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.progress({ id: ctx.payload.id, name: "Loading..." });
            ctx.reply({ id: ctx.payload.id, name: "Alice" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" }, { correlationId: "req-progress" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progress = messages.find((m) => m.type === RPC_PROGRESS);
      expect(progress).toBeDefined();
      expect(progress!.meta?.correlationId).toBe("req-progress");
      await tr.close();
    });

    it("progress after reply is ignored (no-op)", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.reply({ id: ctx.payload.id, name: "Alice" });
            ctx.progress({ id: ctx.payload.id, name: "Too late" }); // Should be ignored
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progressMsgs = messages.filter((m) => m.type === RPC_PROGRESS);
      expect(progressMsgs.length).toBe(0);
      await tr.close();
    });
  });

  describe("ctx.progress() - with {throttleMs}", () => {
    it("throttles rapid progress updates", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            // Rapid progress calls within same tick
            ctx.progress({ id: "1", name: "P1" }, { throttleMs: 100 });
            ctx.progress({ id: "2", name: "P2" }, { throttleMs: 100 }); // Throttled
            ctx.progress({ id: "3", name: "P3" }, { throttleMs: 100 }); // Throttled
            ctx.reply({ id: ctx.payload.id, name: "Done" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progressMsgs = messages.filter((m) => m.type === RPC_PROGRESS);
      // Only first progress should send; others throttled
      expect(progressMsgs.length).toBe(1);
      expect(progressMsgs[0]!.payload).toEqual({ id: "1", name: "P1" });
      await tr.close();
    });
  });

  // NOTE: {waitFor} is currently stubbed to resolve immediately.
  // See ctx.reply() {waitFor} note above.
  describe("ctx.progress() - with {waitFor}", () => {
    it("returns Promise that resolves after send", async () => {
      let progressResult;

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, async (ctx) => {
            progressResult = await ctx.progress(
              { id: ctx.payload.id, name: "Loading..." },
              { waitFor: "drain" },
            );
            ctx.reply({ id: ctx.payload.id, name: "Alice" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      expect(progressResult).toBeUndefined(); // Promise<void> resolves to undefined
      const messages = conn.outgoing();
      const progress = messages.find((m) => m.type === RPC_PROGRESS);
      expect(progress).toBeDefined();
      await tr.close();
    });
  });

  describe("ctx.error() - terminal error response", () => {
    it("sends error response to WebSocket", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.error("NOT_FOUND", "User not found", { id: ctx.payload.id });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const errorMsg = messages.find((m) => m.type === "RPC_ERROR");
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.payload).toMatchObject({
        code: "NOT_FOUND",
        message: "User not found",
        details: { id: "u1" },
      });
      await tr.close();
    });

    it("preserves correlationId in error response", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.error("NOT_FOUND", "User not found");
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" }, { correlationId: "req-err-123" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const errorMsg = messages.find((m) => m.type === "RPC_ERROR");
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.meta?.correlationId).toBe("req-err-123");
      await tr.close();
    });

    it("merges custom metadata into error response", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.error(
              "NOT_FOUND",
              "User not found",
              { id: ctx.payload.id },
              {
                meta: { traceId: "trace-err-789" },
              },
            );
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const errorMsg = messages.find((m) => m.type === "RPC_ERROR");
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.meta?.traceId).toBe("trace-err-789");
      await tr.close();
    });

    it("one-shot guard prevents reply after error", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.error("NOT_FOUND", "User not found");
            ctx.reply({ id: "u1", name: "Should be ignored" }); // Should be ignored
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const errorMsgs = messages.filter((m) => m.type === "RPC_ERROR");
      const replyMsgs = messages.filter((m) => m.type === "USER");
      expect(errorMsgs.length).toBe(1);
      expect(replyMsgs.length).toBe(0);
      await tr.close();
    });

    it("one-shot guard prevents error after reply", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, async (ctx) => {
            await ctx.reply({ id: "u1", name: "Alice" });
            ctx.error("NOT_FOUND", "Should be ignored"); // Should be ignored
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const errorMsgs = messages.filter((m) => m.type === "RPC_ERROR");
      const replyMsgs = messages.filter((m) => m.type === "USER");
      expect(replyMsgs.length).toBe(1);
      expect(errorMsgs.length).toBe(0);
      await tr.close();
    });

    it("progress allowed before error (streaming with failure)", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, async (ctx) => {
            await ctx.progress({ id: ctx.payload.id, name: "Loading..." });
            await ctx.progress({ id: ctx.payload.id, name: "Processing..." });
            ctx.error("INTERNAL", "Processing failed");
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progressMsgs = messages.filter((m) => m.type === RPC_PROGRESS);
      const errorMsgs = messages.filter((m) => m.type === "RPC_ERROR");
      expect(progressMsgs.length).toBe(2);
      expect(errorMsgs.length).toBe(1);
      await tr.close();
    });

    it("progress after error is ignored", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            ctx.error("INTERNAL", "Failed early");
            ctx.progress({ id: ctx.payload.id, name: "Too late" }); // Should be ignored
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progressMsgs = messages.filter((m) => m.type === RPC_PROGRESS);
      expect(progressMsgs.length).toBe(0);
      await tr.close();
    });
  });

  describe("outgoing schema validation", () => {
    it("rejects invalid reply payload at runtime", async () => {
      const StrictUser = rpc(
        "GET_STRICT_USER",
        { id: z.string() },
        "STRICT_USER",
        { id: z.string(), name: z.string().min(1) },
      );

      let validationError: Error | undefined;

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(StrictUser, async (ctx) => {
            try {
              // Invalid: name is empty string (violates min(1))
              await ctx.reply({ id: ctx.payload.id, name: "" });
            } catch (err) {
              validationError = err as Error;
            }
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_STRICT_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      // Validation should reject the invalid payload
      expect(validationError).toBeDefined();
      expect(validationError!.message).toMatch(/validation|invalid|min/i);

      // Invalid message should not be sent to the wire
      const messages = conn.outgoing();
      expect(messages.filter((m) => m.type === "STRICT_USER").length).toBe(0);
      await tr.close();
    });

    it("rejects invalid progress payload at runtime", async () => {
      const StrictUser = rpc(
        "GET_STRICT_USER",
        { id: z.string() },
        "STRICT_USER",
        { id: z.string(), name: z.string().min(1) },
      );

      let validationError: Error | undefined;

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(StrictUser, async (ctx) => {
            try {
              // Invalid: name is empty string (violates min(1))
              await ctx.progress({ id: ctx.payload.id, name: "" });
            } catch (err) {
              validationError = err as Error;
            }
            // Send valid reply to complete RPC
            ctx.reply({ id: ctx.payload.id, name: "Alice" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_STRICT_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      // Validation should reject the invalid progress payload
      expect(validationError).toBeDefined();
      expect(validationError!.message).toMatch(/validation|invalid|min/i);

      // Invalid progress should not be sent to the wire
      const messages = conn.outgoing();
      expect(messages.filter((m) => m.type === RPC_PROGRESS).length).toBe(0);
      // But valid reply should still be sent
      expect(messages.filter((m) => m.type === "STRICT_USER").length).toBe(1);
      await tr.close();
    });
  });

  describe("ctx.progress() - throttling with immediate reply", () => {
    it("leading-edge throttle drops updates, no trailing flush on reply", async () => {
      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter().plugin(withZod());
          router.rpc(GetUser, (ctx) => {
            // First progress sends (leading edge)
            ctx.progress({ id: "1", name: "P1" }, { throttleMs: 1000 });
            // These are throttled (within 1000ms window)
            ctx.progress({ id: "2", name: "P2" }, { throttleMs: 1000 });
            ctx.progress({ id: "3", name: "P3" }, { throttleMs: 1000 });
            // Reply terminates - no trailing edge flush of throttled updates
            ctx.reply({ id: ctx.payload.id, name: "Done" });
          });
          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("GET_USER", { id: "u1" });
      await tr.flush();
      await waitForImmediate();

      const messages = conn.outgoing();
      const progressMsgs = messages.filter((m) => m.type === RPC_PROGRESS);
      const replyMsgs = messages.filter((m) => m.type === "USER");

      // Only first progress sent; throttled ones dropped (no trailing edge)
      expect(progressMsgs.length).toBe(1);
      expect(progressMsgs[0]!.payload).toEqual({ id: "1", name: "P1" });
      // Reply still sent
      expect(replyMsgs.length).toBe(1);
      await tr.close();
    });
  });
});
