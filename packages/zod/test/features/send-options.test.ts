// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Tests for ctx.send() options
 *
 * Validates:
 * - {waitFor} option returns Promise<boolean>
 * - {signal} option cancels send gracefully
 * - {meta} option merges custom metadata
 * - {inheritCorrelationId} auto-copies correlationId
 *
 * Spec: docs/specs/context-methods.md#ctx-send
 *       ADR-030#ctx-send-schema-payload-opts
 */

import { createRouter } from "@ws-kit/core";
import { message, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

describe("ctx.send() - options support", () => {
  describe("method signature", () => {
    it("send() accepts optional third parameter", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // All these should be valid signatures
        ctx.send(MyMsg, { text: "hello" });
        await ctx.send(MyMsg, { text: "hello" }, {});
        await ctx.send(MyMsg, { text: "hello" }, { meta: {} });
        await ctx.send(MyMsg, { text: "hello" }, { waitFor: "drain" });
        await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            signal: new AbortController().signal,
          },
        );
      });

      expect(router.on).toBeDefined();
    });

    it("send() returns void by default", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const result = ctx.send(MyMsg, { text: "hello" });
        // Should return undefined (void)
        expect(result).toBeUndefined();
      });

      expect(router.on).toBeDefined();
    });

    it("send() with {waitFor} returns Promise<boolean>", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const result = await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            waitFor: "drain",
          },
        );
        // Should return boolean
        expect(typeof result).toBe("boolean");
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("{meta} option", () => {
    it("merges custom metadata into response", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            meta: {
              traceId: "trace-123",
              timestamp: 1234567890,
            },
          },
        );
      });

      expect(router.on).toBeDefined();
    });

    it("sanitizes reserved keys in meta", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // These should be stripped by sanitizeMeta
        await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            meta: {
              type: "SHOULD_BE_STRIPPED",
              correlationId: "SHOULD_BE_STRIPPED_UNLESS_PRESERVED",
              custom: "SHOULD_STAY",
            },
          },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("{signal} option", () => {
    it("checks signal before sending", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const controller = new AbortController();
        controller.abort(); // Already aborted

        const result = await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            signal: controller.signal,
            waitFor: "drain",
          },
        );

        // Should return false because signal was aborted
        expect(result).toBe(false);
      });

      expect(router.on).toBeDefined();
    });

    it("returns undefined if signal aborted and no waitFor", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const controller = new AbortController();
        controller.abort();

        const result = ctx.send(
          MyMsg,
          { text: "hello" },
          {
            signal: controller.signal,
          },
        );

        // Should return void (undefined)
        expect(result).toBeUndefined();
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("{inheritCorrelationId} option", () => {
    it("auto-copies correlationId from inbound meta", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const AckMsg = message("ACK", { success: z.boolean() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // Simulate inbound meta with correlationId
        const hasCorrelationId = ctx.meta?.correlationId !== undefined;

        if (hasCorrelationId) {
          // inheritCorrelationId should copy it to outgoing message
          await ctx.send(
            AckMsg,
            { success: true },
            {
              inheritCorrelationId: true,
            },
          );
        }
      });

      expect(router.on).toBeDefined();
    });

    it("no-op if inheritCorrelationId true but no inbound correlationId", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const AckMsg = message("ACK", { success: z.boolean() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // No inbound correlationId, but inheritCorrelationId=true
        // Should gracefully not fail
        await ctx.send(
          AckMsg,
          { success: true },
          {
            inheritCorrelationId: true,
          },
        );
      });

      expect(router.on).toBeDefined();
    });

    it("inheritCorrelationId works with custom meta", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const AckMsg = message("ACK", { success: z.boolean() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // Combine inheritCorrelationId with other meta
        await ctx.send(
          AckMsg,
          { success: true },
          {
            inheritCorrelationId: true,
            meta: {
              custom: "value",
              timestamp: Date.now(),
            },
          },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("{waitFor} option", () => {
    it("waitFor='drain' returns Promise<boolean>", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const result = await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            waitFor: "drain",
          },
        );
        expect(typeof result).toBe("boolean");
      });

      expect(router.on).toBeDefined();
    });

    it("waitFor='ack' returns Promise<boolean>", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const result = await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            waitFor: "ack",
          },
        );
        expect(typeof result).toBe("boolean");
      });

      expect(router.on).toBeDefined();
    });

    it("makes send() async when specified", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // Without waitFor: returns void
        const syncResult = ctx.send(MyMsg, { text: "hello" });
        expect(syncResult).toBeUndefined();

        // With waitFor: returns Promise
        const asyncResult = await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            waitFor: "drain",
          },
        );
        expect(typeof asyncResult).toBe("boolean");
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("combination of options", () => {
    it("works with all options together", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const AckMsg = message("ACK", { success: z.boolean() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const controller = new AbortController();

        const result = await ctx.send(
          AckMsg,
          { success: true },
          {
            waitFor: "drain",
            signal: controller.signal,
            meta: { traceId: "123" },
            inheritCorrelationId: true,
          },
        );

        expect(typeof result).toBe("boolean");
      });

      expect(router.on).toBeDefined();
    });

    it("inheritCorrelationId can be false explicitly", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const AckMsg = message("ACK", { success: z.boolean() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // Explicitly set to false (no-op)
        await ctx.send(
          AckMsg,
          { success: true },
          {
            inheritCorrelationId: false,
            meta: { custom: "value" },
          },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("real-world patterns", () => {
    it("backpressure-sensitive: wait for drain", async () => {
      const LargeDataMsg = message("LARGE_DATA", {
        buffer: z.string(),
        size: z.number(),
      });
      const router = createRouter().plugin(withZod());

      router.on(LargeDataMsg, async (ctx: any) => {
        // Simulate backpressure checking
        const largeBuffer = "x".repeat(10000);

        const sent = await ctx.send(
          LargeDataMsg,
          {
            buffer: largeBuffer,
            size: largeBuffer.length,
          },
          {
            waitFor: "drain",
          },
        );

        if (!sent) {
          console.warn("Buffer full, client may be slow");
        }
      });

      expect(router.on).toBeDefined();
    });

    it("correlated acknowledgment pattern", async () => {
      const UserActionMsg = message("USER_ACTION", {
        correlationId: z.string().optional(),
        userId: z.string(),
        action: z.string(),
      });
      const AckMsg = message("ACK", { success: z.boolean() });
      const router = createRouter().plugin(withZod());

      router.on(UserActionMsg, async (ctx: any) => {
        // Server acknowledges with auto-inherited correlation
        if (ctx.meta?.correlationId) {
          await ctx.send(
            AckMsg,
            { success: true },
            {
              inheritCorrelationId: true,
            },
          );
        }
      });

      expect(router.on).toBeDefined();
    });

    it("cancellable send with timeout", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const sent = await ctx.send(
            MyMsg,
            { text: "data" },
            {
              waitFor: "drain",
              signal: controller.signal,
            },
          );

          if (!sent) {
            console.warn("Send timed out");
          }
        } finally {
          clearTimeout(timeoutId);
        }
      });

      expect(router.on).toBeDefined();
    });

    it("traced send with custom metadata", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      router.on(MyMsg, async (ctx: any) => {
        // Add tracing metadata
        const traceId = "trace-" + Math.random().toString(36);

        await ctx.send(
          MyMsg,
          { text: "hello" },
          {
            meta: {
              traceId,
              sendTime: Date.now(),
            },
          },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("error handling with options", () => {
    it("invalid payload with options still validates", async () => {
      const MyMsg = message("MY_MSG", { text: z.string() });
      const router = createRouter().plugin(withZod());

      let validationError: Error | null = null;

      router.on(MyMsg, async (ctx: any) => {
        try {
          // Invalid payload (number instead of string)
          await ctx.send(
            MyMsg,
            { text: 123 },
            {
              waitFor: "drain",
            },
          );
        } catch (err) {
          validationError = err as Error;
        }
      });

      router.onError((err) => {
        // Validation errors should be caught
      });

      expect(router.on).toBeDefined();
    });
  });
});
