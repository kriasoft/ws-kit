// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { createRouter, message, z } from "@ws-kit/zod";

describe("addRoutes", () => {
  it("should merge routes from another router", async () => {
    // Create first router with a message handler
    const router1 = createRouter();
    const PingMessage = message("PING", { text: z.string().optional() });
    let pingHandlerCalled = false;
    router1.on(PingMessage, () => {
      pingHandlerCalled = true;
    });

    // Create second router with different handlers
    const router2 = createRouter();
    const PongMessage = message("PONG", { reply: z.string().optional() });
    let pongHandlerCalled = false;
    let openHandlerCalled = false;
    let closeHandlerCalled = false;

    router2.on(PongMessage, () => {
      pongHandlerCalled = true;
    });

    router2.onOpen(() => {
      openHandlerCalled = true;
    });

    router2.onClose(() => {
      closeHandlerCalled = true;
    });

    // Merge router2 into router1
    router1.addRoutes(router2);

    // Get the WebSocket handler
    const wsHandler = router1._core.websocket;

    // Create a mock WebSocket
    const mockWs = {
      data: { clientId: "test-123" },
      send: () => {},
      publish: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      close: () => {},
      readyState: 1,
    };

    // Test that router1 still handles its original messages
    await wsHandler.message?.(
      mockWs as any,
      JSON.stringify({ type: "PING", meta: {}, payload: { text: "hello" } }),
    );
    expect(pingHandlerCalled).toBe(true);

    // Test that router1 now also handles router2's messages
    await wsHandler.message?.(
      mockWs as any,
      JSON.stringify({ type: "PONG", meta: {}, payload: { reply: "world" } }),
    );
    expect(pongHandlerCalled).toBe(true);

    // Test that merged lifecycle handlers work
    await wsHandler.open?.(mockWs as any);
    expect(openHandlerCalled).toBe(true);

    await wsHandler.close?.(mockWs as any, 1000, "test");
    expect(closeHandlerCalled).toBe(true);
  });

  it("should handle multiple route merges", async () => {
    const mainRouter = createRouter();
    const router1 = createRouter();
    const router2 = createRouter();

    const Message1 = message("MSG1", { value: z.string().optional() });
    const Message2 = message("MSG2", { value: z.string().optional() });
    const Message3 = message("MSG3", { value: z.string().optional() });

    let msg1Called = false;
    let msg2Called = false;
    let msg3Called = false;

    mainRouter.on(Message1, () => {
      msg1Called = true;
    });

    router1.on(Message2, () => {
      msg2Called = true;
    });

    router2.on(Message3, () => {
      msg3Called = true;
    });

    // Chain multiple addRoutes calls
    mainRouter.addRoutes(router1).addRoutes(router2);

    const wsHandler = mainRouter._core.websocket;
    const mockWs = {
      data: { clientId: "test-123" },
      send: () => undefined,
      close: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      readyState: 1,
    };

    // Test all handlers work
    await wsHandler.message(
      mockWs as any,
      JSON.stringify({ type: "MSG1", meta: {}, payload: { value: "1" } }),
    );
    await wsHandler.message(
      mockWs as any,
      JSON.stringify({ type: "MSG2", meta: {}, payload: { value: "2" } }),
    );
    await wsHandler.message(
      mockWs as any,
      JSON.stringify({ type: "MSG3", meta: {}, payload: { value: "3" } }),
    );

    expect(msg1Called).toBe(true);
    expect(msg2Called).toBe(true);
    expect(msg3Called).toBe(true);
  });
});
