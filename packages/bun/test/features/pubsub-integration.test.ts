// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Pub/Sub Integration Tests
 *
 * Tests publishing, subscription mechanisms, handler publish capability,
 * and BunPubSub adapter integration with mock Bun server.
 */

import { memoryPubSub } from "@ws-kit/memory";
import { createRouter, message, withPubSub, z } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createBunHandler } from "../../src/index.js";

describe("Bun: Pub/Sub Integration", () => {
  let router: ReturnType<typeof createRouter>;
  let createdWebSockets: { close: () => void }[];

  beforeEach(() => {
    router = createRouter<{ userId?: string; connectedAt?: number }>().plugin(
      withPubSub({ adapter: memoryPubSub() }),
    );
    createdWebSockets = [];
  });

  afterEach(() => {
    const leakedCount = createdWebSockets.length;
    const keysToClose = createdWebSockets.slice();

    for (const ws of keysToClose) {
      ws.close?.();
    }
    createdWebSockets = [];

    if (leakedCount > 0) {
      throw new Error(
        `Test leaked ${leakedCount} websocket connection(s). ` +
          `Each test must call websocket.close() before completing.`,
      );
    }

    router = undefined!;
  });

  it("should publish messages via router.publish()", async () => {
    const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });

    const result = await (router as any).publish("room:123", RoomMsg, {
      text: "Hello room",
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("ok");
    expect(typeof result.ok).toBe("boolean");
  });

  it("should return publish result with metadata", async () => {
    const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });

    const publishPromise = (router as any).publish("room:456", RoomMsg, {
      text: "Test message",
    });

    expect(publishPromise).toBeInstanceOf(Promise);
    const result = await publishPromise;
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("ok");
  });

  it("should allow handlers to publish to topics", async () => {
    const RoomMsg = message("ROOM_MESSAGE", { text: z.string() });
    let handlerExecuted = false;

    router.on(RoomMsg, async (ctx) => {
      handlerExecuted = true;
      if (typeof ctx.publish === "function") {
        await ctx.publish("notifications", RoomMsg, {
          text: `Message from ${ctx.data.clientId}: ${ctx.payload.text}`,
        });
      }
    });

    const { websocket } = createBunHandler(router);
    const ws = {
      data: { clientId: "pub-test", connectedAt: Date.now() },
      send: () => {},
      close: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
    };

    createdWebSockets.push(ws);
    await websocket.open!(ws as any);

    try {
      await websocket.message(
        ws as any,
        JSON.stringify({
          type: "ROOM_MESSAGE",
          meta: {},
          payload: { text: "broadcast test" },
        }),
      );

      expect(handlerExecuted).toBe(true);
    } finally {
      await websocket.close!(ws as any, 1000, "Test complete");
      const idx = createdWebSockets.indexOf(ws);
      if (idx >= 0) createdWebSockets.splice(idx, 1);
    }
  });
});

describe("Bun: BunPubSub Adapter", () => {
  it("should accept BunPubSub adapter in router configuration", async () => {
    const { bunPubSub } = await import("../../src/adapter.js");

    const mockBunServer = {
      publish: () => {},
    };

    const bunRouter = createRouter<{
      userId?: string;
      connectedAt?: number;
    }>().plugin(withPubSub({ adapter: bunPubSub(mockBunServer as any) }));

    expect(bunRouter).toBeDefined();
  });

  it("should verify BunPubSub adapter exports correct interface", async () => {
    const { bunPubSub } = await import("../../src/adapter.js");

    const publishCalls: [string, string | ArrayBuffer | Uint8Array][] = [];
    const mockBunServer = {
      publish: (topic: string, data: string | ArrayBuffer | Uint8Array) => {
        publishCalls.push([topic, data]);
        return true;
      },
    };

    const adapter = bunPubSub(mockBunServer as any);

    expect(typeof adapter.publish).toBe("function");
    expect(typeof adapter.subscribe).toBe("function");
    expect(typeof adapter.unsubscribe).toBe("function");
    expect(typeof adapter.getSubscribers).toBe("function");

    const result = await adapter.publish({
      topic: "test-topic",
      payload: { message: "test" },
      type: "TEST",
      meta: { customField: "value" },
    });

    expect(result.ok).toBe(true);
    expect(publishCalls).toHaveLength(1);
    const call = publishCalls[0];
    expect(call).toBeDefined();
    if (call) {
      const [topic, data] = call;
      expect(topic).toBe("test-topic");
      // Empty meta is stripped from wire, custom fields are preserved
      expect(data).toBe(
        JSON.stringify({
          payload: { message: "test" },
          type: "TEST",
          meta: { customField: "value" },
        }),
      );
    }
  });

  it("should handle BunPubSub publish errors via adapter", async () => {
    const { bunPubSub } = await import("../../src/adapter.js");

    const errorServer = {
      publish: () => {
        throw new Error("Server publish failed");
      },
    };

    const adapter = bunPubSub(errorServer as any);

    const result = await adapter.publish({
      topic: "error-topic",
      payload: { value: 42 },
      type: "ERROR_TEST",
      meta: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ADAPTER_ERROR");
      expect(result.retryable).toBe(true);
    }
  });
});
