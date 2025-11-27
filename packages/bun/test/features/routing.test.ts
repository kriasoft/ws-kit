// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Message Routing Tests
 *
 * Tests runtime message routing behavior: handler execution, message dispatch,
 * multiple handlers, and router composition/merging.
 */

import { memoryPubSub } from "@ws-kit/memory";
import { createRouter, message, withPubSub, z } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createBunHandler } from "../../src/index.js";

describe("Bun: Message Routing", () => {
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

  it("should execute handler when message is received", async () => {
    let handlerExecuted = false;
    let receivedPayload: any = null;

    const TestMsg = message("TEST_MSG", { text: z.string() });

    router.on(TestMsg, (ctx) => {
      handlerExecuted = true;
      receivedPayload = ctx.payload;
    });

    const { websocket } = createBunHandler(router);
    const ws = {
      data: { clientId: "msg-test", connectedAt: Date.now() },
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
          type: "TEST_MSG",
          meta: {},
          payload: { text: "hello" },
        }),
      );

      expect(handlerExecuted).toBe(true);
      expect(receivedPayload?.text).toBe("hello");
    } finally {
      await websocket.close!(ws as any, 1000, "Test complete");
      const idx = createdWebSockets.indexOf(ws);
      if (idx >= 0) createdWebSockets.splice(idx, 1);
    }
  });

  it("should register and dispatch to multiple handlers", async () => {
    const Msg1 = message("MSG1", { id: z.number() });
    const Msg2 = message("MSG2", { name: z.string() });

    const calls: string[] = [];

    router.on(Msg1, () => {
      calls.push("msg1");
    });
    router.on(Msg2, () => {
      calls.push("msg2");
    });

    const { websocket } = createBunHandler(router);
    const ws = {
      data: { clientId: "multi-handler-test", connectedAt: Date.now() },
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
          type: "MSG1",
          meta: {},
          payload: { id: 1 },
        }),
      );

      await websocket.message(
        ws as any,
        JSON.stringify({
          type: "MSG2",
          meta: {},
          payload: { name: "test" },
        }),
      );

      expect(calls).toEqual(["msg1", "msg2"]);
    } finally {
      await websocket.close!(ws as any, 1000, "Test complete");
      const idx = createdWebSockets.indexOf(ws);
      if (idx >= 0) createdWebSockets.splice(idx, 1);
    }
  });

  it("should support merging routers", async () => {
    const router2 = createRouter<{ userId?: string; connectedAt?: number }>();
    const Msg1 = message("MSG1", { id: z.number() });
    const Msg2 = message("MSG2", { name: z.string() });

    const calls: string[] = [];

    router.on(Msg1, () => {
      calls.push("msg1");
    });
    router2.on(Msg2, () => {
      calls.push("msg2");
    });

    router.merge(router2);

    const { websocket } = createBunHandler(router);
    const ws = {
      data: { clientId: "merge-test", connectedAt: Date.now() },
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
          type: "MSG1",
          meta: {},
          payload: { id: 1 },
        }),
      );

      await websocket.message(
        ws as any,
        JSON.stringify({
          type: "MSG2",
          meta: {},
          payload: { name: "test" },
        }),
      );

      expect(calls).toContain("msg1");
      expect(calls).toContain("msg2");
    } finally {
      await websocket.close!(ws as any, 1000, "Test complete");
      const idx = createdWebSockets.indexOf(ws);
      if (idx >= 0) createdWebSockets.splice(idx, 1);
    }
  });
});
