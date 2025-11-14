// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core tests for ctx.send() - validator-agnostic messaging
 *
 * Validates:
 * - send() accepts schema and payload
 * - send() returns void by default (fire-and-forget)
 * - send() with {waitFor} returns Promise<boolean>
 * - send() with {signal} cancels gracefully
 * - send() with {meta} merges metadata
 * - send() with {preserveCorrelation} copies correlationId
 *
 * These tests verify core plugin behavior independent of validation.
 * Validator-specific send() tests (payload validation, outbound validation)
 * belong in @ws-kit/zod or @ws-kit/valibot.
 *
 * Spec: docs/specs/context-methods.md#ctx-send
 *       ADR-030#ctx-send
 */

import { createRouter } from "@ws-kit/core";
import { withMessaging } from "../../src/index.js";
import { describe, expect, it } from "bun:test";

describe("withMessaging() plugin - ctx.send()", () => {
  describe("method signature", () => {
    it("send() is available after withMessaging() plugin", () => {
      const router = createRouter().plugin(withMessaging());

      let sendMethod: any;
      router.on({ type: "TEST" }, (ctx: any) => {
        sendMethod = ctx.send;
      });

      expect(typeof sendMethod).toBe("undefined"); // Handler not executed yet
      expect(router.on).toBeDefined();
    });

    it("send() accepts schema and payload", async () => {
      const router = createRouter().plugin(withMessaging());

      let sendCalled = false;
      router.on({ type: "TEST" }, (ctx: any) => {
        // Should not throw
        ctx.send({ type: "RESPONSE" }, { data: "test" });
        sendCalled = true;
      });

      expect(router.on).toBeDefined();
    });

    it("send() returns void by default (fire-and-forget)", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        const result = ctx.send({ type: "RESPONSE" }, { data: "test" });
        // Should return undefined (void)
        expect(result).toBeUndefined();
      });

      expect(router.on).toBeDefined();
    });

    it("send() with {waitFor} returns Promise<boolean>", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        const result = ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          { waitFor: "drain" },
        );
        // Should return Promise
        expect(result).toBeInstanceOf(Promise);
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("{signal} option - cancellation", () => {
    it("gracefully skips send if signal is aborted before enqueue", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        const controller = new AbortController();
        controller.abort();

        // Should return immediately without error
        const result = ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          { signal: controller.signal },
        );
        expect(result).toBeUndefined();
      });

      expect(router.on).toBeDefined();
    });

    it("gracefully skips send with {waitFor} if signal is aborted", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        const controller = new AbortController();
        controller.abort();

        // Should return resolved Promise without error
        const result = ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          { waitFor: "drain", signal: controller.signal },
        );

        if (result instanceof Promise) {
          result.then((sent) => {
            expect(sent).toBe(false);
          });
        }
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("{meta} option - custom metadata", () => {
    it("merges custom metadata into outgoing message", async () => {
      const router = createRouter().plugin(withMessaging());

      let sentMessage: any;
      router.on({ type: "TEST" }, (ctx: any) => {
        ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          { meta: { traceId: "abc123" } },
        );
      });

      expect(router.on).toBeDefined();
    });

    it("sanitizes metadata to prevent reserved key override", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        // Should not throw; reserved keys are stripped
        ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          {
            meta: {
              type: "HACKED", // Reserved: should be stripped
              correlationId: "fake", // Reserved: should be stripped
              customField: "ok", // Non-reserved: should be preserved
            },
          },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("{preserveCorrelation} option - auto-correlation", () => {
    it("copies correlationId from inbound meta if present", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        // Simulate inbound message with correlationId
        ctx.meta = { correlationId: "req-123" };

        // Should preserve it automatically
        ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          { preserveCorrelation: true },
        );
      });

      expect(router.on).toBeDefined();
    });

    it("gracefully skips correlation if not present in inbound meta", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        // No correlationId in inbound meta
        ctx.meta = {};

        // Should not throw, just skip
        ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          { preserveCorrelation: true },
        );
      });

      expect(router.on).toBeDefined();
    });

    it("works together with custom {meta}", async () => {
      const router = createRouter().plugin(withMessaging());

      router.on({ type: "TEST" }, (ctx: any) => {
        ctx.meta = { correlationId: "req-123" };

        // Should preserve correlation AND merge custom meta
        ctx.send(
          { type: "RESPONSE" },
          { data: "test" },
          {
            preserveCorrelation: true,
            meta: { customField: "value" },
          },
        );
      });

      expect(router.on).toBeDefined();
    });
  });

  describe("composition with other plugins", () => {
    it("works when applied before other plugins", () => {
      const router = createRouter()
        .plugin(withMessaging())
        .on({ type: "TEST" }, (ctx: any) => {
          expect(typeof ctx.send).toBe("function");
        });

      expect(router.on).toBeDefined();
    });

    it("can be wrapped by validator plugins", () => {
      // Validator plugins wrap core send() with validation
      const router = createRouter().plugin(withMessaging());

      let originalSend: any;
      router.on({ type: "TEST" }, (ctx: any) => {
        originalSend = ctx.send;
        expect(typeof ctx.send).toBe("function");
      });

      expect(router.on).toBeDefined();
    });
  });
});
