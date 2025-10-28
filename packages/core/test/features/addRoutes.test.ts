// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { WebSocketRouter } from "../../src/router";
import zodValidator from "../../../zod/src/validator";
import { createMessageSchema } from "../../../zod/src/schema";

const { messageSchema } = createMessageSchema(z);

describe("addRoutes", () => {
  it("should merge routes from another router", () => {
    // Create first router with a message handler
    const router1 = new WebSocketRouter({ validator: zodValidator() });
    const PingMessage = messageSchema("PING");
    let pingHandlerCalled = false;
    router1.onMessage(PingMessage, () => {
      pingHandlerCalled = true;
    });

    // Create second router with different handlers
    const router2 = new WebSocketRouter({ validator: zodValidator() });
    const PongMessage = messageSchema("PONG");
    let pongHandlerCalled = false;
    let openHandlerCalled = false;
    let closeHandlerCalled = false;

    router2.onMessage(PongMessage, () => {
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
    const wsHandler = router1.websocket;

    // Create a mock WebSocket
    const mockWs = {
      data: { clientId: "test-123" },
      send: () => {},
      publish: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
    };

    // Test that router1 still handles its original messages
    wsHandler.message?.(
      mockWs as any,
      JSON.stringify({ type: "PING", meta: {} }),
    );
    expect(pingHandlerCalled).toBe(true);

    // Test that router1 now also handles router2's messages
    wsHandler.message?.(
      mockWs as any,
      JSON.stringify({ type: "PONG", meta: {} }),
    );
    expect(pongHandlerCalled).toBe(true);

    // Test that merged lifecycle handlers work
    wsHandler.open?.(mockWs as any);
    expect(openHandlerCalled).toBe(true);

    wsHandler.close?.(mockWs as any, 1000, "test");
    expect(closeHandlerCalled).toBe(true);
  });

  it("should handle multiple route merges", () => {
    const mainRouter = new WebSocketRouter({ validator: zodValidator() });
    const router1 = new WebSocketRouter({ validator: zodValidator() });
    const router2 = new WebSocketRouter({ validator: zodValidator() });

    const Message1 = messageSchema("MSG1");
    const Message2 = messageSchema("MSG2");
    const Message3 = messageSchema("MSG3");

    let msg1Called = false;
    let msg2Called = false;
    let msg3Called = false;

    mainRouter.onMessage(Message1, () => {
      msg1Called = true;
    });

    router1.onMessage(Message2, () => {
      msg2Called = true;
    });

    router2.onMessage(Message3, () => {
      msg3Called = true;
    });

    // Chain multiple addRoutes calls
    mainRouter.addRoutes(router1).addRoutes(router2);

    const wsHandler = mainRouter.websocket;
    const mockWs = {
      data: { clientId: "test-123" },
      send: () => undefined,
    };

    // Test all handlers work
    wsHandler.message(
      mockWs as any,
      JSON.stringify({ type: "MSG1", meta: {} }),
    );
    wsHandler.message(
      mockWs as any,
      JSON.stringify({ type: "MSG2", meta: {} }),
    );
    wsHandler.message(
      mockWs as any,
      JSON.stringify({ type: "MSG3", meta: {} }),
    );

    expect(msg1Called).toBe(true);
    expect(msg2Called).toBe(true);
    expect(msg3Called).toBe(true);
  });
});
