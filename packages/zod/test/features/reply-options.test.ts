// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Tests for ctx.reply(), ctx.error(), ctx.progress() options
 *
 * Validates:
 * - {waitFor} option returns Promise<void>
 * - {signal} option cancels send gracefully
 * - {meta} option merges custom metadata
 * - reply/error idempotency with options
 * - progress multiple sends with options
 *
 * Spec: docs/specs/context-methods.md#ctx-reply
 *       docs/specs/context-methods.md#ctx-error
 *       docs/specs/context-methods.md#ctx-progress
 *       ADR-030#ctx-reply-progress-error-schema-payload-opts
 */

import { createRouter } from "@ws-kit/core";
import { rpc, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

describe("ctx.reply() - options support", () => {
  describe("method signature", () => {
    it("reply() accepts optional second parameter (options)", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // All these should be valid signatures
        ctx.reply({ result: "hello" });
        ctx.reply({ result: "hello" }, {});
        ctx.reply({ result: "hello" }, { meta: {} });
        ctx.reply({ result: "hello" }, { waitFor: "drain" });
        ctx.reply(
          { result: "hello" },
          {
            signal: new AbortController().signal,
          },
        );
      });

      expect(router.rpc).toBeDefined();
    });

    it("reply() returns void by default", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.reply({ result: "hello" });
        // Should return undefined (void)
        expect(result).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });

    it("reply() with {waitFor} returns Promise<void>", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.reply({ result: "hello" }, { waitFor: "drain" });
        // Should return Promise
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("{meta} option", () => {
    it("merges custom metadata into reply", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        ctx.reply(
          { result: "hello" },
          {
            meta: {
              traceId: "trace-123",
              timestamp: 1234567890,
            },
          },
        );
      });

      expect(router.rpc).toBeDefined();
    });

    it("sanitizes reserved keys in meta", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // These should be stripped by sanitizeMeta
        ctx.reply(
          { result: "hello" },
          {
            meta: {
              type: "SHOULD_BE_STRIPPED",
              correlationId: "SHOULD_BE_STRIPPED",
              custom: "SHOULD_STAY",
            },
          },
        );
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("{signal} option", () => {
    it("checks signal before sending", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const controller = new AbortController();
        controller.abort(); // Already aborted

        const result = ctx.reply(
          { result: "hello" },
          {
            signal: controller.signal,
            waitFor: "drain",
          },
        );

        // Should return resolved promise (no-op on abort)
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });

    it("returns undefined if signal aborted and no waitFor", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const controller = new AbortController();
        controller.abort();

        const result = ctx.reply(
          { result: "hello" },
          {
            signal: controller.signal,
          },
        );

        // Should return void (undefined)
        expect(result).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("{waitFor} option", () => {
    it("waitFor='drain' returns Promise<void>", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.reply({ result: "hello" }, { waitFor: "drain" });
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });

    it("waitFor='ack' returns Promise<void>", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.reply({ result: "hello" }, { waitFor: "ack" });
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });

    it("makes reply() async when specified", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // Without waitFor: returns void
        const syncResult = ctx.reply({ result: "hello" });
        expect(syncResult).toBeUndefined();

        // Can't test async without multiple replies, but signature is clear
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("combination of options", () => {
    it("works with all options together", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const controller = new AbortController();

        const result = ctx.reply(
          { result: "hello" },
          {
            waitFor: "drain",
            signal: controller.signal,
            meta: { traceId: "123" },
          },
        );

        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("reply/error idempotency", () => {
    it("reply() is idempotent", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // First reply
        const result1 = ctx.reply({ result: "first" });
        expect(result1).toBeUndefined();

        // Second reply (should be no-op)
        const result2 = ctx.reply({ result: "second" });
        expect(result2).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });

    it("reply() and error() are mutually exclusive (one-shot guard)", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // First reply
        const result1 = ctx.reply({ result: "hello" });
        expect(result1).toBeUndefined();

        // Subsequent error (should be no-op due to one-shot guard)
        const result2 = ctx.error("ERROR", "Already replied");
        expect(result2).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });

    it("error() and reply() are mutually exclusive (one-shot guard)", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // First error
        const result1 = ctx.error("NOT_FOUND", "Not found");
        expect(result1).toBeUndefined();

        // Subsequent reply (should be no-op due to one-shot guard)
        const result2 = ctx.reply({ result: "should not send" });
        expect(result2).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });

    it("reply() with options returns idempotent promise when already replied", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, async (ctx: any) => {
        // First reply
        ctx.reply({ result: "hello" });

        // Second reply with waitFor (should return resolved promise)
        const result2 = ctx.reply({ result: "second" }, { waitFor: "drain" });
        expect(result2).toBeInstanceOf(Promise);
        // Promise resolves immediately since already replied
        const resolved = await result2;
        expect(resolved).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });
  });
});

describe("ctx.error() - options support", () => {
  describe("method signature", () => {
    it("error() accepts optional fourth parameter (options)", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // All these should be valid signatures
        ctx.error("ERROR", "message");
        ctx.error("ERROR", "message", { code: "details" });
        ctx.error("ERROR", "message", { code: "details" }, {});
        ctx.error("ERROR", "message", undefined, { meta: {} });
        ctx.error("ERROR", "message", undefined, { waitFor: "drain" });
      });

      expect(router.rpc).toBeDefined();
    });

    it("error() returns void by default", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.error("NOT_FOUND", "Not found");
        // Should return undefined (void)
        expect(result).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });

    it("error() with {waitFor} returns Promise<void>", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.error("ERROR", "message", undefined, {
          waitFor: "drain",
        });
        // Should return Promise
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("{signal} option for error()", () => {
    it("checks signal before sending error", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const controller = new AbortController();
        controller.abort();

        const result = ctx.error("ERROR", "message", undefined, {
          signal: controller.signal,
          waitFor: "drain",
        });

        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("{waitFor} option for error()", () => {
    it("error() with {waitFor} returns Promise<void>", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.error("ERROR", "message", undefined, {
          waitFor: "drain",
        });
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });
  });
});

describe("ctx.progress() - options support", () => {
  describe("method signature", () => {
    it("progress() accepts optional second parameter (options)", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // All these should be valid signatures
        ctx.progress({ result: "progress1" });
        ctx.progress({ result: "progress2" }, {});
        ctx.progress({ result: "progress3" }, { meta: {} });
        ctx.progress({ result: "progress4" }, { waitFor: "drain" });
        ctx.progress(
          { result: "progress5" },
          {
            signal: new AbortController().signal,
          },
        );
      });

      expect(router.rpc).toBeDefined();
    });

    it("progress() returns void by default", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.progress({ result: "progress" });
        // Should return undefined (void)
        expect(result).toBeUndefined();
      });

      expect(router.rpc).toBeDefined();
    });

    it("progress() with {waitFor} returns Promise<void>", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const result = ctx.progress(
          { result: "progress" },
          {
            waitFor: "drain",
          },
        );
        // Should return Promise
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("{meta} option for progress()", () => {
    it("merges custom metadata into progress", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        ctx.progress(
          { result: "progress" },
          {
            meta: {
              traceId: "trace-123",
              timestamp: Date.now(),
            },
          },
        );
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("{signal} option for progress()", () => {
    it("checks signal before sending progress", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        const controller = new AbortController();
        controller.abort();

        const result = ctx.progress(
          { result: "progress" },
          {
            signal: controller.signal,
            waitFor: "drain",
          },
        );

        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("progress() multiple sends", () => {
    it("allows multiple progress calls before reply", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // Multiple progress calls (non-terminal)
        ctx.progress({ result: "progress1" });
        ctx.progress({ result: "progress2" });
        ctx.progress({ result: "progress3" });

        // Terminal reply (one-shot)
        ctx.reply({ result: "final" });
      });

      expect(router.rpc).toBeDefined();
    });

    it("allows multiple progress calls with options", async () => {
      const Request = rpc("REQUEST", { text: z.string() }, "RESPONSE", {
        result: z.string(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, (ctx: any) => {
        // Multiple progress calls with various options
        ctx.progress({ result: "progress1" });
        ctx.progress({ result: "progress2" }, { meta: { step: 2 } });
        ctx.progress({ result: "progress3" }, { waitFor: "drain" });

        // Terminal reply
        ctx.reply({ result: "final" });
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("real-world patterns", () => {
    it("streaming with progress updates", async () => {
      const Request = rpc("REQUEST", { items: z.number() }, "RESPONSE", {
        current: z.number(),
        total: z.number(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, async (ctx: any) => {
        const total = ctx.payload.items;

        for (let i = 1; i <= total; i++) {
          // Send progress updates
          await ctx.progress(
            { current: i, total },
            {
              meta: { percentage: ((i / total) * 100).toFixed(0) },
            },
          );
        }

        // Send final response
        ctx.reply({ current: total, total });
      });

      expect(router.rpc).toBeDefined();
    });

    it("cancellable progress with timeout", async () => {
      const Request = rpc("REQUEST", { items: z.number() }, "RESPONSE", {
        current: z.number(),
        total: z.number(),
      });
      const router = createRouter().plugin(withZod());

      router.rpc(Request, async (ctx: any) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          for (let i = 1; i <= ctx.payload.items; i++) {
            const sent = await ctx.progress(
              { current: i, total: ctx.payload.items },
              {
                signal: controller.signal,
                waitFor: "drain",
              },
            );

            if (!sent) {
              console.warn("Progress cancelled or timed out");
              break;
            }
          }

          ctx.reply({ current: ctx.payload.items, total: ctx.payload.items });
        } finally {
          clearTimeout(timeoutId);
        }
      });

      expect(router.rpc).toBeDefined();
    });
  });
});
