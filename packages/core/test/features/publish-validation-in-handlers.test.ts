// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Handler-Level Validation Tests for Publishing
 *
 * Validates that payload validation happens at the handler/middleware level,
 * NOT at the router.publish() level. Tests demonstrate:
 * - router.publish() accepts any payload without validation
 * - ctx.publish() in handlers can validate via middleware/validator plugins
 * - Validation is the validator plugin's responsibility, not pubsub's
 *
 * This separates concerns:
 * - PubSub plugin: delivery, capability reporting, subscription management
 * - Validator plugin: schema validation, type coercion
 * - Middleware: cross-cutting validation logic
 *
 * Spec: docs/specs/pubsub.md, docs/specs/validation.md
 * Related: ADR-022 (pub/sub API design), ADR-024 (plugin architecture)
 */

import { test } from "@ws-kit/core/testing";
import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { createRouter, message, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

const TestMessage = message("TEST", { text: z.string() });
const TypedMessage = message("TYPED", { count: z.number().int() });

describe("Handler-Level Validation in Publishing", () => {
  describe("router.publish() does not validate", () => {
    it("accepts invalid payload at router level", async () => {
      const router = createRouter()
        .plugin(withZod())
        .plugin(withPubSub({ adapter: memoryPubSub() }));

      // router.publish() accepts anything, regardless of schema
      const result = await router.publish("topic", TestMessage, {
        text: 123 as any, // Invalid: text should be string
      });

      // No validation failure; router succeeds
      expect(result.ok).toBe(true);
    });

    it("publishes invalid payloads without transforming them", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      // Publish invalid payload directly from router
      await tr.publish("topic", TypedMessage, {
        count: "not a number" as any,
      });

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      // Payload is published as-is, unvalidated
      expect((publishes[0]!.payload as any).count).toBe("not a number");

      await tr.close();
    });
  });

  describe("ctx.publish() validates payloads via validator plugin", () => {
    it("publishes validated payloads from handlers", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() }))
            .on(TestMessage, async (ctx: any) => {
              await ctx.publish("results", TypedMessage, { count: 42 });
            }),
      });

      const conn = await tr.connect();
      conn.send("TEST", { text: "incoming" });
      await tr.flush();

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect((publishes[0]!.payload as any).count).toBe(42);

      await tr.close();
    });

    it("rejects invalid payloads from handlers before publishing", async () => {
      const errors: any[] = [];

      const tr = test.createTestRouter({
        create: () => {
          const router = createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() }));

          router.onError((err) => {
            errors.push(err);
          });

          router.on(TestMessage, async (ctx: any) => {
            await ctx.publish("results", TypedMessage, {
              count: "not a number" as any,
            });
          });

          return router;
        },
      });

      const conn = await tr.connect();
      conn.send("TEST", { text: "incoming" });
      await tr.flush();

      expect(errors[0]?.code).toBe("OUTBOUND_VALIDATION_ERROR");
      expect(tr.capture.publishes()).toHaveLength(0);

      await tr.close();
    });
  });

  describe("Validation responsibility separation", () => {
    it("ctx.publish() inside handler bypasses middleware chain", async () => {
      const middlewareCalls: string[] = [];

      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() }))
            .use((ctx, next) => {
              // Track middleware execution
              middlewareCalls.push("middleware");
              return next();
            })
            .on(TestMessage, async (ctx: any) => {
              // Publish a message from handler
              await ctx.publish("results", TestMessage, { text: "reply" });
            }),
      });

      const conn = await tr.connect();
      conn.send("TEST", { text: "incoming" });
      await tr.flush();

      // Middleware ran ONCE for the incoming message
      // If ctx.publish() triggered middleware, we'd see it twice
      expect(middlewareCalls).toEqual(["middleware"]);
      expect(middlewareCalls).toHaveLength(1);

      await tr.close();
    });

    it("router.publish() is payload-blind without validator plugin", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );
      // No validator plugin attached

      // Even without validator, router.publish() works
      const result = await router.publish("topic", TestMessage, {
        text: null as any,
      });

      expect(result.ok).toBe(true);
    });

    it("middleware executes for incoming messages before handlers", async () => {
      const calls: string[] = [];

      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() }))
            .use((ctx, next) => {
              calls.push("middleware");
              return next();
            })
            .on(TestMessage, (ctx: any) => {
              calls.push("handler");
            }),
      });

      const conn = await tr.connect();
      conn.send("TEST", { text: "hi" });
      await tr.flush();

      expect(calls).toEqual(["middleware", "handler"]);

      await tr.close();
    });
  });

  describe("Validation pattern: custom middleware", () => {
    it("middleware can intercept incoming messages before handlers", async () => {
      const intercepted: any[] = [];

      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() }))
            .use((ctx: any, next) => {
              // Custom interceptor middleware
              if (ctx.type === "TEST" && ctx.payload?.text === "invalid") {
                intercepted.push("rejecting 'invalid' text");
              }
              return next();
            })
            .on(TestMessage, (ctx: any) => {
              // Handler receives context
            }),
      });

      const conn = await tr.connect();
      conn.send("TEST", { text: "invalid" });
      await tr.flush();

      expect(intercepted).toContain("rejecting 'invalid' text");

      await tr.close();
    });

    it("schema and payload are preserved through pubsub publication", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      // Publish message with typed schema
      const result = await tr.publish("results", TypedMessage, {
        count: 42,
      });

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes[0]!.schema?.type).toBe("TYPED");
      expect((publishes[0]!.payload as any).count).toBe(42);

      await tr.close();
    });
  });

  describe("Cross-layer consistency", () => {
    it("payload shape is preserved in published messages", async () => {
      const CustomMessage = message("CUSTOM", {
        id: z.string(),
        data: z.object({ nested: z.boolean() }),
      });

      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      await tr.publish("channel", CustomMessage, {
        id: "msg-123",
        data: { nested: true },
      });

      const publishes = tr.capture.publishes();
      expect(publishes[0]!.payload).toEqual({
        id: "msg-123",
        data: { nested: true },
      });

      await tr.close();
    });

    it("schema type is preserved in publish records for observability", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      await tr.publish("updates", TestMessage, {
        text: "updated",
      });

      const publishes = tr.capture.publishes();
      expect(publishes[0]!.schema?.type).toBe("TEST");

      await tr.close();
    });
  });
});
