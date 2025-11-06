// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Publish excludeSelf Error Tests
 *
 * Validates that excludeSelf option is properly rejected with clear error message.
 * This is a breaking change: excludeSelf is not yet supported pending pubsub layer changes.
 *
 * Spec: docs/specs/broadcasting.md#excludeSelf-Option
 * Related: ADR-019 (publish API design)
 */

import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";
import type { ServerWebSocket, WebSocketData } from "../../src/index.js";

// Mock WebSocket implementation
class MockWebSocket<TData extends WebSocketData = WebSocketData>
  implements ServerWebSocket<TData>
{
  data: TData;
  readyState = 1; // OPEN
  messages: string[] = [];

  constructor(data: TData) {
    this.data = data;
  }

  send(message: string | Uint8Array): void {
    this.messages.push(
      typeof message === "string" ? message : new TextDecoder().decode(message),
    );
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }

  subscribe(): void {
    /* mock */
  }
  unsubscribe(): void {
    /* mock */
  }
}

// Test message schema
const TestMessage = message("TEST_MSG", {
  text: z.string(),
});

// Message schema with custom meta fields
const TestMessageWithMeta = message(
  "TEST_MSG_META",
  { text: z.string() },
  { custom: z.string().optional() },
);

describe("publish() excludeSelf Error Handling", () => {
  describe("router.publish() with excludeSelf", () => {
    it("should return error result when excludeSelf: true", async () => {
      const router = createRouter();

      const result = await router.publish(
        "test-channel",
        TestMessage,
        { text: "hello" },
        { excludeSelf: true },
      );

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.reason).toBe("adapter_error");
        expect(result.error).toBeDefined();
      }
    });

    it("should include helpful message in error", async () => {
      const router = createRouter();

      const result = await router.publish(
        "channel",
        TestMessage,
        { text: "test" },
        { excludeSelf: true },
      );

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        const errorMsg =
          result.error instanceof Error
            ? result.error.message
            : String(result.error);
        expect(errorMsg).toContain("excludeSelf");
        expect(errorMsg).toContain("not yet supported");
      }
    });

    it("should not throw when excludeSelf is false", async () => {
      const router = createRouter();

      let errorThrown = false;

      try {
        const result = await router.publish(
          "test-channel",
          TestMessage,
          { text: "hello" },
          { excludeSelf: false },
        );
        expect(result.ok).toBe(true);
      } catch (error) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(false);
    });

    it("should not throw when excludeSelf is omitted", async () => {
      const router = createRouter();

      let errorThrown = false;

      try {
        const result = await router.publish(
          "test-channel",
          TestMessage,
          { text: "hello" },
          {},
        );
        expect(result.ok).toBe(true);
      } catch (error) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(false);
    });

    it("should return error before publishing to pubsub", async () => {
      const router = createRouter();
      let publishCalled = false;

      // Override pubsub to track if publish is called
      (router as any)._core.pubsub.publish = async () => {
        publishCalled = true;
        return undefined;
      };

      const result = await router.publish(
        "channel",
        TestMessage,
        { text: "test" },
        { excludeSelf: true },
      );

      expect(result.ok).toBe(false);
      expect(publishCalled).toBe(false);
    });
  });

  describe("ctx.publish() with excludeSelf", () => {
    it("should return error result when ctx.publish() called with excludeSelf: true", async () => {
      const router = createRouter();
      let publishResult: any = null;

      // Register handler that calls ctx.publish()
      router.on(TestMessage, async (ctx) => {
        publishResult = await ctx.publish(
          "channel",
          TestMessage,
          { text: "reply" },
          { excludeSelf: true },
        );
      });

      // Send trigger message to invoke handler
      const ws = new MockWebSocket({ clientId: "client-1" });
      await router._core.websocket.open(ws as any);
      await router._core.websocket.message(
        ws as any,
        JSON.stringify({
          type: "TEST_MSG",
          meta: {},
          payload: { text: "trigger" },
        }),
      );

      // Verify ctx.publish returned error
      expect(publishResult).toBeDefined();
      expect(publishResult.ok).toBe(false);
    });

    it("should work with ctx.publish() when excludeSelf is false or omitted", async () => {
      const router = createRouter();
      const publishResults: any[] = [];

      // Register handler that calls ctx.publish()
      router.on(TestMessage, async (ctx) => {
        // Test without excludeSelf
        const result1 = await ctx.publish("channel", TestMessage, {
          text: "reply1",
        });
        publishResults.push(result1);

        // Test with excludeSelf: false
        const result2 = await ctx.publish(
          "channel",
          TestMessage,
          { text: "reply2" },
          { excludeSelf: false },
        );
        publishResults.push(result2);
      });

      // Send trigger message
      const ws = new MockWebSocket({ clientId: "client-1" });
      await router._core.websocket.open(ws as any);
      await router._core.websocket.message(
        ws as any,
        JSON.stringify({
          type: "TEST_MSG",
          meta: {},
          payload: { text: "trigger" },
        }),
      );

      // Both should succeed
      expect(publishResults.length).toBe(2);
      expect(publishResults[0].ok).toBe(true);
      expect(publishResults[1].ok).toBe(true);
    });
  });

  describe("Backward compatibility", () => {
    it("should not affect other PublishOptions", async () => {
      const router = createRouter();

      const result = await router.publish(
        "channel",
        TestMessageWithMeta,
        { text: "test" },
        {
          partitionKey: "user:123",
          meta: { custom: "value" },
        },
      );

      expect(result.ok).toBe(true);
    });

    it("should work with no options", async () => {
      const router = createRouter();

      const result = await router.publish("channel", TestMessage, {
        text: "test",
      });

      expect(result.ok).toBe(true);
    });
  });
});
