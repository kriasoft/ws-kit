// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Error Handling Tests
 *
 * Tests error handler registration, runtime error capture,
 * and multiple error handler support.
 */

import { memoryPubSub } from "@ws-kit/memory";
import { createRouter, message, withPubSub, z } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createBunHandler } from "../../src/index.js";

describe("Bun: Error Handling", () => {
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

  it("should call onError when handler throws", async () => {
    let errorCaught: Error | null = null;

    const TestMsg = message("THROW_MSG", { value: z.number() });

    router.on(TestMsg, () => {
      throw new Error("Handler intentionally failed");
    });

    router.onError((error) => {
      if (error instanceof Error) {
        errorCaught = error;
      }
    });

    const { websocket } = createBunHandler(router);
    const ws = {
      data: { clientId: "error-handler-test", connectedAt: Date.now() },
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
          type: "THROW_MSG",
          meta: {},
          payload: { value: 42 },
        }),
      );

      expect(errorCaught).not.toBeNull();
      expect(errorCaught!.message).toContain("intentionally failed");
      expect(errorCaught!.constructor).toBe(Error);
    } finally {
      await websocket.close!(ws as any, 1000, "Test complete");
      const idx = createdWebSockets.indexOf(ws);
      if (idx >= 0) createdWebSockets.splice(idx, 1);
    }
  });

  it("should call error handler when registered", async () => {
    const errorCalls: string[] = [];

    router.onError((error) => {
      if (error instanceof Error) {
        errorCalls.push(error.message);
      }
    });

    const TestMsg = message("ERROR_MSG", { value: z.number() });
    router.on(TestMsg, () => {
      throw new Error("Test error 1");
    });

    const { websocket } = createBunHandler(router);
    const ws = {
      data: { clientId: "error-config-test", connectedAt: Date.now() },
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
          type: "ERROR_MSG",
          meta: {},
          payload: { value: 1 },
        }),
      );

      expect(errorCalls).toContain("Test error 1");
    } finally {
      await websocket.close!(ws as any, 1000, "Test complete");
      const idx = createdWebSockets.indexOf(ws);
      if (idx >= 0) createdWebSockets.splice(idx, 1);
    }
  });

  it("should support multiple error handlers", async () => {
    const handler1Calls: string[] = [];
    const handler2Calls: string[] = [];

    router.onError((error) => {
      if (error instanceof Error) {
        handler1Calls.push(error.message);
      }
    });
    router.onError((error) => {
      if (error instanceof Error) {
        handler2Calls.push(error.message);
      }
    });

    const TestMsg = message("MULTI_ERROR", { value: z.number() });
    router.on(TestMsg, () => {
      throw new Error("Test error");
    });

    const { websocket } = createBunHandler(router);
    const ws = {
      data: { clientId: "multi-error-test", connectedAt: Date.now() },
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
          type: "MULTI_ERROR",
          meta: {},
          payload: { value: 1 },
        }),
      );

      expect(handler1Calls).toContain("Test error");
      expect(handler2Calls).toContain("Test error");
    } finally {
      await websocket.close!(ws as any, 1000, "Test complete");
      const idx = createdWebSockets.indexOf(ws);
      if (idx >= 0) createdWebSockets.splice(idx, 1);
    }
  });
});
