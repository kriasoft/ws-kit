// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-Safe Publish Tests
 *
 * Validates ctx.publish() behavior:
 * - Message publishing to topics with payload typing
 * - Return value (capability and recipient count)
 * - PublishOptions (partitionKey, meta, excludeSelf)
 * - Integration with handler context
 *
 * Router-level publish validation is covered in publish-failure-modes.test.ts.
 * Handler-level validation semantics are in publish-validation-in-handlers.test.ts.
 *
 * Spec: docs/specs/pubsub.md
 * Related: ADR-022, ADR-024
 */

import { test } from "@ws-kit/core/testing";
import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { createRouter, message, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

// Test message schemas
const UserUpdated = message("USER_UPDATED", {
  userId: z.string(),
  name: z.string(),
});

const MessageWithMeta = message(
  "MESSAGE_WITH_META",
  { text: z.string() },
  { origin: z.string().optional(), timestamp: z.number().optional() },
);

describe("Type-Safe Publishing", () => {
  describe("router.publish() type-safety", () => {
    it("should pass PublishOptions including meta", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter<{ userId?: string }>()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
        capturePubSub: true,
      });

      const timestamp = Date.now();
      const result = await tr.publish(
        "messages",
        MessageWithMeta,
        { text: "Hello with metadata" },
        { meta: { origin: "system", timestamp } },
      );

      expect(result.ok).toBe(true);

      const publishes = tr.capture.publishes();
      expect(publishes).toHaveLength(1);
      expect(publishes[0]!.meta?.origin).toBe("system");

      await tr.close();
    });
  });

  describe("router.publish() API", () => {
    it("router.publish() method exists and is callable", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      expect(typeof tr.publish).toBe("function");

      await tr.close();
    });

    it("router.publish() returns Promise<PublishResult>", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      const result = tr.publish("test-topic", UserUpdated, {
        userId: "123",
        name: "Test",
      });

      expect(result instanceof Promise).toBe(true);

      const publishResult = await result;
      expect(publishResult.ok).toBeDefined();
      expect(
        publishResult.ok === true && publishResult.capability,
      ).toBeDefined();

      await tr.close();
    });

    it("should report exact capability for MemoryPubSub", async () => {
      const tr = test.createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      const result = await tr.publish("test-channel", UserUpdated, {
        userId: "123",
        name: "Test",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capability).toBe("exact");
        expect(typeof result.matched).toBe("number");
      }

      await tr.close();
    });
  });
});
