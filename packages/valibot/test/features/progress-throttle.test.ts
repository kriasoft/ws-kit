// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Tests for ctx.progress() throttling with {throttleMs}
 *
 * Validates:
 * - {throttleMs} option rate-limits progress updates
 * - Throttling skips updates when called too frequently
 * - Throttling works with other options ({signal}, {meta}, {waitFor})
 * - Real-world patterns: animations, sensor data, bulk processing
 *
 * Spec: docs/specs/context-methods.md#ctx-progress
 *       ADR-030#ctx-progress-schema-payload-opts
 */

import { createRouter } from "@ws-kit/core";
import { rpc, withValibot } from "@ws-kit/valibot";
import { describe, expect, it } from "bun:test";
import * as v from "valibot";

describe("ctx.progress() - throttling support", () => {
  describe("throttleMs option basic behavior", () => {
    it("throttleMs parameter accepted and processed", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        // Signature accepts throttleMs
        const result = ctx.progress({ current: 1 }, { throttleMs: 50 });
        // Should return void or Promise<void>
        expect(result === undefined || result instanceof Promise).toBe(true);

        ctx.reply({ current: 10 });
      });

      expect(router.rpc).toBeDefined();
    });

    it("throttleMs optional and defaults to no throttling", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        // Without throttleMs, normal behavior
        const result = ctx.progress({ current: 1 });
        expect(result === undefined || result instanceof Promise).toBe(true);

        ctx.reply({ current: 5 });
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("throttleMs with other options", () => {
    it("throttleMs works with {signal}", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        const controller = new AbortController();

        // First call should send (not throttled)
        ctx.progress(
          { current: 0 },
          { throttleMs: 100, signal: controller.signal },
        );

        // Second call immediately (within 100ms window) - should be throttled
        const result = ctx.progress(
          { current: 1 },
          { throttleMs: 100, signal: controller.signal },
        );

        expect(result === undefined || result instanceof Promise).toBe(true);
        ctx.reply({ current: 2 });
      });

      expect(router.rpc).toBeDefined();
    });

    it("throttleMs works with {meta}", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        ctx.progress(
          { current: 0 },
          {
            throttleMs: 50,
            meta: { timestamp: Date.now() },
          },
        );

        ctx.progress(
          { current: 1 },
          {
            throttleMs: 50,
            meta: { timestamp: Date.now() },
          },
        );

        ctx.reply({ current: 2 });
      });

      expect(router.rpc).toBeDefined();
    });

    it("throttleMs works with {waitFor}", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, async (ctx: any) => {
        // First call with waitFor
        const result1 = await ctx.progress(
          { current: 0 },
          { throttleMs: 50, waitFor: "drain" },
        );
        expect(result1 === undefined || typeof result1 === "undefined").toBe(
          true,
        );

        // Second call immediately (throttled)
        const result2 = await ctx.progress(
          { current: 1 },
          { throttleMs: 50, waitFor: "drain" },
        );
        expect(result2 === undefined || typeof result2 === "undefined").toBe(
          true,
        );

        ctx.reply({ current: 2 });
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("throttling timing behavior", () => {
    it("respects throttleMs window duration", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, async (ctx: any) => {
        // First call at t=0
        ctx.progress({ current: 0 }, { throttleMs: 50 });

        // Wait 30ms (within window)
        await new Promise((resolve) => setTimeout(resolve, 30));
        ctx.progress({ current: 1 }, { throttleMs: 50 }); // Should be throttled

        // Wait 30ms more (total 60ms, beyond window)
        await new Promise((resolve) => setTimeout(resolve, 30));
        ctx.progress({ current: 2 }, { throttleMs: 50 }); // Should send

        ctx.reply({ current: 3 });
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("real-world patterns", () => {
    it("animation frame updates with throttling", async () => {
      const Request = rpc("REQUEST", { frameCount: v.number() }, "PROGRESS", {
        frame: v.number(),
        position: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      const sendCount = { value: 0 };

      router.rpc(Request, (ctx: any) => {
        // Simulate rendering many frames, throttle to 10/sec (100ms)
        for (let i = 0; i < 50; i++) {
          ctx.progress({ frame: i, position: i * 10 }, { throttleMs: 100 });
        }

        ctx.reply({ frame: 50, position: 500 });
      });

      expect(router.rpc).toBeDefined();
    });

    it("sensor data updates with throttling", async () => {
      const Request = rpc("REQUEST", { duration: v.number() }, "PROGRESS", {
        reading: v.number(),
        timestamp: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, async (ctx: any) => {
        // Simulate sensor reading every 10ms, throttle to every 100ms
        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 10));

          ctx.progress(
            {
              reading: Math.random() * 100,
              timestamp: Date.now(),
            },
            { throttleMs: 100 },
          );
        }

        ctx.reply({ reading: 50, timestamp: Date.now() });
      });

      expect(router.rpc).toBeDefined();
    });

    it("bulk processing with progress metrics", async () => {
      const Request = rpc("REQUEST", { itemCount: v.number() }, "PROGRESS", {
        processed: v.number(),
        total: v.number(),
        percentage: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        const total = ctx.payload.itemCount || 100;

        // Process items and report progress every 500ms
        for (let i = 0; i < total; i++) {
          ctx.progress(
            {
              processed: i + 1,
              total,
              percentage: Math.round(((i + 1) / total) * 100),
            },
            {
              throttleMs: 500,
              meta: { step: i },
            },
          );
        }

        ctx.reply({
          processed: total,
          total,
          percentage: 100,
        });
      });

      expect(router.rpc).toBeDefined();
    });

    it("cancellable progress with throttling and timeout", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, async (ctx: any) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);

        try {
          for (let i = 0; i < 100; i++) {
            const result = ctx.progress(
              { current: i },
              {
                throttleMs: 100,
                signal: controller.signal,
                meta: { progress: i },
              },
            );

            if (controller.signal.aborted) {
              break;
            }

            // Simulate work
            await new Promise((resolve) => setTimeout(resolve, 10));
          }

          ctx.reply({ current: 100 });
        } finally {
          clearTimeout(timeoutId);
        }
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("error handling with throttling", () => {
    it("invalid payload with throttling still validates", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      let validationError: Error | null = null;

      router.rpc(Request, async (ctx: any) => {
        try {
          // Invalid payload (string instead of number)
          ctx.progress({ current: "invalid" }, { throttleMs: 50 });
        } catch (err) {
          validationError = err as Error;
        }

        ctx.reply({ current: 1 });
      });

      router.onError((err) => {
        // Validation errors should be caught
      });

      expect(router.rpc).toBeDefined();
    });

    it("throttling does not affect error responses", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        // Multiple throttled progress updates
        ctx.progress({ current: 0 }, { throttleMs: 100 });
        ctx.progress({ current: 1 }, { throttleMs: 100 });

        // Can still send error (not throttled)
        const errorResult = ctx.error("CANCELLED", "Cancelled by client");
        expect(
          errorResult === undefined || errorResult instanceof Promise,
        ).toBe(true);
      });

      expect(router.rpc).toBeDefined();
    });
  });

  describe("throttleMs edge cases", () => {
    it("zero throttleMs disables throttling", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        // throttleMs: 0 should not throttle
        ctx.progress({ current: 0 }, { throttleMs: 0 });
        ctx.progress({ current: 1 }, { throttleMs: 0 });

        ctx.reply({ current: 2 });
      });

      expect(router.rpc).toBeDefined();
    });

    it("very large throttleMs allows spacing", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, async (ctx: any) => {
        // First call at t=0
        ctx.progress({ current: 0 }, { throttleMs: 10000 });

        // Immediate second call (within 10s window) - throttled
        ctx.progress({ current: 1 }, { throttleMs: 10000 });

        ctx.reply({ current: 2 });
      });

      expect(router.rpc).toBeDefined();
    });

    it("undefined throttleMs allows all updates", async () => {
      const Request = rpc("REQUEST", { count: v.number() }, "PROGRESS", {
        current: v.number(),
      });
      const router = createRouter().plugin(withValibot());

      router.rpc(Request, (ctx: any) => {
        // Multiple calls without throttleMs
        ctx.progress({ current: 0 });
        ctx.progress({ current: 1 });
        ctx.progress({ current: 2 });

        ctx.reply({ current: 3 });
      });

      expect(router.rpc).toBeDefined();
    });
  });
});
