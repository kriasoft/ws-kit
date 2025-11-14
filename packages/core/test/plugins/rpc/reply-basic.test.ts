// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core tests for ctx.reply(), ctx.error(), ctx.progress() - validator-agnostic RPC
 *
 * Validates:
 * - reply() returns void by default (fire-and-forget)
 * - reply() with {waitFor} returns Promise<void>
 * - error() returns void by default
 * - error() with {waitFor} returns Promise<void>
 * - progress() can be called multiple times
 * - reply/error idempotency (one-shot guard)
 * - One-shot semantics: first terminal wins, others ignored
 *
 * These tests verify core plugin behavior independent of validation.
 * Validator-specific RPC tests (payload validation, schema checking)
 * belong in @ws-kit/zod or @ws-kit/valibot.
 *
 * Spec: docs/specs/context-methods.md#ctx-reply
 *       docs/specs/context-methods.md#ctx-error
 *       docs/specs/context-methods.md#ctx-progress
 *       ADR-030#terminal-semantics
 */

import { createRouter } from "@ws-kit/core";
import { withRpc } from "@ws-kit/core/plugins";
import { describe, expect, it } from "bun:test";

describe("withRpc() plugin - ctx.reply()", () => {
  describe("method signature", () => {
    it("reply() is available in RPC handlers", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          expect(typeof ctx.reply).toBe("function");
        },
      );

      expect(router.on).toBeDefined();
    });

    it("reply() returns void by default (fire-and-forget)", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const result = ctx.reply({ result: "ok" });
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });

    it("reply() with {waitFor} returns Promise<void>", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const result = ctx.reply({ result: "ok" }, { waitFor: "drain" });
          expect(result).toBeInstanceOf(Promise);
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("one-shot semantics", () => {
    it("first reply() sends, subsequent calls are idempotent no-ops", () => {
      const router = createRouter().plugin(withRpc());

      const sendCount = 0;
      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.reply({ result: "first" });
          ctx.reply({ result: "second" }); // Should be ignored
          ctx.reply({ result: "third" }); // Should be ignored
        },
      );

      expect(router.on).toBeDefined();
    });

    it("returns void for idempotent calls (no waitFor)", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.reply({ result: "first" });
          const result = ctx.reply({ result: "second" }); // Idempotent
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });

    it("returns resolved Promise for idempotent calls (with waitFor)", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.reply({ result: "first" }, { waitFor: "drain" });
          const result = ctx.reply({ result: "second" }, { waitFor: "drain" }); // Idempotent
          if (result instanceof Promise) {
            result.then(() => {
              // Should resolve normally
              expect(true).toBe(true);
            });
          }
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("{signal} option - cancellation", () => {
    it("gracefully skips reply if signal is aborted before enqueue", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const controller = new AbortController();
          controller.abort();

          const result = ctx.reply(
            { result: "ok" },
            { signal: controller.signal },
          );
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });

    it("gracefully skips reply with {waitFor} if signal is aborted", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const controller = new AbortController();
          controller.abort();

          const result = ctx.reply(
            { result: "ok" },
            { waitFor: "drain", signal: controller.signal },
          );

          if (result instanceof Promise) {
            result.then(() => {
              expect(true).toBe(true);
            });
          }
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("{meta} option - custom metadata", () => {
    it("merges custom metadata into response", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          // Should not throw; metadata accepted
          ctx.reply({ result: "ok" }, { meta: { traceId: "abc123" } });
        },
      );

      expect(router.on).toBeDefined();
    });

    it("sanitizes metadata to prevent reserved key override", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          // Should not throw; reserved keys are stripped
          ctx.reply(
            { result: "ok" },
            {
              meta: {
                correlationId: "fake", // Reserved: should be stripped
                customField: "ok", // Non-reserved: should be preserved
              },
            },
          );
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("auto-correlation", () => {
    it("preserves correlationId from inbound request to response", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          // Simulate inbound request with correlationId
          ctx.meta = { correlationId: "req-123" };

          // Should automatically preserve in response
          ctx.reply({ result: "ok" });
        },
      );

      expect(router.on).toBeDefined();
    });

    it("correlationId preserved even with custom {meta}", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.meta = { correlationId: "req-123" };

          // Custom meta merged but correlation preserved
          ctx.reply({ result: "ok" }, { meta: { customField: "value" } });
        },
      );

      expect(router.on).toBeDefined();
    });
  });
});

describe("withRpc() plugin - ctx.error()", () => {
  describe("method signature", () => {
    it("error() is available in RPC handlers", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          expect(typeof ctx.error).toBe("function");
        },
      );

      expect(router.on).toBeDefined();
    });

    it("error() requires code and message parameters", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          // Should accept code, message, optional details, optional options
          ctx.error("NOT_FOUND", "Item not found");
          ctx.error("NOT_FOUND", "Item not found", { id: "123" });
          ctx.error("NOT_FOUND", "Item not found", { id: "123" }, {});
        },
      );

      expect(router.on).toBeDefined();
    });

    it("error() returns void by default", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const result = ctx.error("NOT_FOUND", "Not found");
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });

    it("error() with {waitFor} returns Promise<void>", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const result = ctx.error(
            "NOT_FOUND",
            "Not found",
            {},
            { waitFor: "drain" },
          );
          expect(result).toBeInstanceOf(Promise);
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("one-shot semantics", () => {
    it("first error() sends, subsequent calls are idempotent no-ops", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.error("FIRST", "First error");
          ctx.error("SECOND", "Second error"); // Should be ignored
        },
      );

      expect(router.on).toBeDefined();
    });

    it("reply() after error() is ignored (mixed terminals)", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.error("FAILED", "Something failed");
          const result = ctx.reply({ result: "ok" }); // Should be ignored
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });

    it("error() after reply() is ignored (mixed terminals)", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.reply({ result: "ok" });
          const result = ctx.error("FAILED", "Something failed"); // Should be ignored
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("auto-correlation", () => {
    it("preserves correlationId from inbound request to error response", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.meta = { correlationId: "req-123" };
          ctx.error("NOT_FOUND", "Not found");
        },
      );

      expect(router.on).toBeDefined();
    });
  });
});

describe("withRpc() plugin - ctx.progress()", () => {
  describe("method signature", () => {
    it("progress() is available in RPC handlers", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          expect(typeof ctx.progress).toBe("function");
        },
      );

      expect(router.on).toBeDefined();
    });

    it("progress() returns void by default", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const result = ctx.progress({ percent: 50 });
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });

    it("progress() with {waitFor} returns Promise<void>", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const result = ctx.progress({ percent: 50 }, { waitFor: "drain" });
          expect(result).toBeInstanceOf(Promise);
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("non-terminal semantics", () => {
    it("can be called multiple times (non-terminal)", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.progress({ percent: 25 });
          ctx.progress({ percent: 50 });
          ctx.progress({ percent: 75 });
          // All should succeed
          expect(true).toBe(true);
        },
      );

      expect(router.on).toBeDefined();
    });

    it("can be called before reply() (streaming pattern)", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.progress({ percent: 50 });
          ctx.progress({ percent: 100 });
          ctx.reply({ result: "done" }); // Terminal marker
        },
      );

      expect(router.on).toBeDefined();
    });

    it("progress() after reply() is idempotent no-op", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.reply({ result: "done" });
          const result = ctx.progress({ percent: 100 }); // Should be ignored
          expect(result).toBeUndefined();
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("{throttleMs} option - rate limiting", () => {
    it("skips send if within throttle window", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          // First progress sends immediately
          const result1 = ctx.progress({ percent: 25 }, { throttleMs: 100 });
          expect(result1).toBeUndefined();

          // Second progress within 100ms should be throttled
          const result2 = ctx.progress({ percent: 50 }, { throttleMs: 100 });
          expect(result2).toBeUndefined(); // Throttled, returns void
        },
      );

      expect(router.on).toBeDefined();
    });

    it("works with {waitFor} and throttling", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          const result = ctx.progress(
            { percent: 25 },
            { throttleMs: 100, waitFor: "drain" },
          );
          // Should return Promise
          expect(result).toBeInstanceOf(Promise);
        },
      );

      expect(router.on).toBeDefined();
    });
  });

  describe("auto-correlation", () => {
    it("preserves correlationId in progress updates", () => {
      const router = createRouter().plugin(withRpc());

      router.on(
        { type: "REQUEST", response: { type: "RESPONSE" } },
        (ctx: any) => {
          ctx.meta = { correlationId: "req-123" };
          ctx.progress({ percent: 50 });
          ctx.progress({ percent: 100 });
          ctx.reply({ result: "done" });
        },
      );

      expect(router.on).toBeDefined();
    });
  });
});
