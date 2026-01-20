// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * excludeSelf Option Tests
 *
 * **Behavioral tests are in local-delivery.test.ts** (excludeSelf filtering describe block)
 * which properly invokes handlers and verifies delivery/exclusion behavior, including:
 * - Sender exclusion when excludeSelf: true
 * - Correct matched count with/without excludeSelf
 *
 * This file tests edge cases not covered there (server-side publish semantics).
 *
 * Spec: docs/specs/pubsub.md#publish-options--result
 * Related: ADR-022 (pub/sub API design), ADR-019 (publish API convenience)
 */

import { createTestRouter } from "@ws-kit/core/testing";
import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { createRouter, message, withZod, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

describe("excludeSelf option", () => {
  describe("server-side publish (no sender)", () => {
    it("router.publish with excludeSelf:true is a no-op (no sender to exclude)", async () => {
      const TestMsg = message("TEST_MSG", { text: z.string() });
      const SubMsg = message("SUB", {});

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("test-topic");
      });

      const conn = await tr.connect();
      conn.send("SUB", {});
      await tr.flush();

      // Server-side publish with excludeSelf - should succeed because
      // there's no sender to exclude (senderClientId is undefined)
      const result = await tr.publish(
        "test-topic",
        TestMsg,
        { text: "from server" },
        { excludeSelf: true },
      );

      // Should succeed - excludeSelf is a no-op when there's no sender
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capability).toBe("exact");
        // matched should include all subscribers (no one excluded)
        expect(result.matched).toBe(1);
      }

      // Message should be delivered to subscriber (no one to exclude)
      await tr.flush();
      const received = conn.outgoing().filter((m) => m.type === "TEST_MSG");
      expect(received.length).toBe(1);
      expect(received[0]?.payload).toEqual({ text: "from server" });

      await tr.close();
    });
  });

  describe("meta sanitization", () => {
    it("should strip user-injected excludeClientId from meta", async () => {
      const TestMsg = message("TEST_MSG", { text: z.string() });
      const SubMsg = message("SUB", {});
      const PublishMsg = message("PUBLISH", {});

      const tr = createTestRouter({
        create: () =>
          createRouter()
            .plugin(withZod())
            .plugin(withPubSub({ adapter: memoryPubSub() })),
      });

      tr.on(SubMsg, async (ctx) => {
        await ctx.topics.subscribe("test-topic");
      });

      // Try to inject excludeClientId to exclude a specific client
      tr.on(PublishMsg, async (ctx) => {
        await ctx.publish(
          "test-topic",
          TestMsg,
          { text: "hello" },
          // Attempt to inject excludeClientId - should be stripped
          { meta: { excludeClientId: "victim-client-id", custom: "data" } },
        );
      });

      const sender = await tr.connect();
      const receiver = await tr.connect();

      // Both subscribe
      sender.send("SUB", {});
      receiver.send("SUB", {});
      await tr.flush();

      // Sender publishes with injected excludeClientId (should be ignored)
      sender.send("PUBLISH", {});
      await tr.flush();

      // Both should receive the message - injection was stripped
      const senderMsgs = sender.outgoing().filter((m) => m.type === "TEST_MSG");
      const receiverMsgs = receiver
        .outgoing()
        .filter((m) => m.type === "TEST_MSG");

      expect(senderMsgs.length).toBe(1);
      expect(receiverMsgs.length).toBe(1);

      // Custom meta should be preserved
      expect(senderMsgs[0]?.meta?.custom).toBe("data");
      // excludeClientId should NOT appear in wire message
      expect(senderMsgs[0]?.meta?.excludeClientId).toBeUndefined();

      await tr.close();
    });
  });
});
