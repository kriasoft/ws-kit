// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { WebSocketRouter } from "../../zod/router";
import { createMessageSchema } from "../../packages/zod/src/schema";

const { messageSchema } = createMessageSchema(z);

// Mock console methods to prevent noise during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = mock(() => {
    /* Mock implementation */
  });
  console.warn = mock(() => {
    /* Mock implementation */
  });
  console.error = mock(() => {
    /* Mock implementation */
  });
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

describe("Lifecycle Handlers", () => {
  describe("onOpen - Multiple Handlers", () => {
    it("should execute all registered onOpen handlers in order", () => {
      const router = new WebSocketRouter();
      const executionOrder: number[] = [];

      // Register multiple handlers
      router.onOpen(() => {
        executionOrder.push(1);
      });

      router.onOpen(() => {
        executionOrder.push(2);
      });

      router.onOpen(() => {
        executionOrder.push(3);
      });

      // Get the WebSocket handler
      const wsHandler = router.websocket;

      // Create a mock WebSocket
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
        publish: mock(() => {}),
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      // Trigger the open handler
      wsHandler.open?.(mockWs as any);

      // Verify all handlers were called in order
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should isolate errors in onOpen handlers", () => {
      const router = new WebSocketRouter();
      const handler1Called = mock(() => {});
      const handler2Called = mock(() => {});
      const handler3Called = mock(() => {});

      // Register handlers where second one throws
      router.onOpen(() => {
        handler1Called();
      });

      router.onOpen(() => {
        handler2Called();
        throw new Error("Handler 2 error");
      });

      router.onOpen(() => {
        handler3Called();
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      // Trigger the open handler
      wsHandler.open?.(mockWs as any);

      // Verify all handlers were attempted despite error in handler 2
      expect(handler1Called).toHaveBeenCalledTimes(1);
      expect(handler2Called).toHaveBeenCalledTimes(1);
      expect(handler3Called).toHaveBeenCalledTimes(1);
    });

    it("should handle async onOpen handlers", async () => {
      const router = new WebSocketRouter();
      const executionOrder: number[] = [];

      router.onOpen(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        executionOrder.push(1);
      });

      router.onOpen(() => {
        executionOrder.push(2);
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      wsHandler.open?.(mockWs as any);

      // Handler 2 executes immediately (fire-and-forget for async)
      expect(executionOrder).toEqual([2]);

      // Wait for async handler to complete
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(executionOrder).toEqual([2, 1]);
    });

    it("should provide send function in onOpen context", () => {
      const router = new WebSocketRouter();
      let sendFunctionProvided = false;

      const WelcomeMessage = messageSchema("WELCOME", {
        text: z.string(),
      });

      router.onOpen((ctx) => {
        sendFunctionProvided = typeof ctx.send === "function";
        // Test that send can be called
        ctx.send(WelcomeMessage, { text: "Welcome!" });
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      wsHandler.open?.(mockWs as any);

      expect(sendFunctionProvided).toBe(true);
      expect(mockWs.send).toHaveBeenCalled();
    });
  });

  describe("onClose - Multiple Handlers", () => {
    it("should execute all registered onClose handlers in order", () => {
      const router = new WebSocketRouter();
      const executionOrder: number[] = [];

      // Register multiple handlers
      router.onClose(() => {
        executionOrder.push(1);
      });

      router.onClose(() => {
        executionOrder.push(2);
      });

      router.onClose(() => {
        executionOrder.push(3);
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      // Trigger the close handler
      wsHandler.close?.(mockWs as any, 1000, "Normal closure");

      // Verify all handlers were called in order
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should isolate errors in onClose handlers", () => {
      const router = new WebSocketRouter();
      const handler1Called = mock(() => {});
      const handler2Called = mock(() => {});
      const handler3Called = mock(() => {});

      router.onClose(() => {
        handler1Called();
      });

      router.onClose(() => {
        handler2Called();
        throw new Error("Handler 2 error");
      });

      router.onClose(() => {
        handler3Called();
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      wsHandler.close?.(mockWs as any, 1000, "Normal closure");

      // Verify all handlers were attempted despite error in handler 2
      expect(handler1Called).toHaveBeenCalledTimes(1);
      expect(handler2Called).toHaveBeenCalledTimes(1);
      expect(handler3Called).toHaveBeenCalledTimes(1);
    });

    it("should handle async onClose handlers", async () => {
      const router = new WebSocketRouter();
      const executionOrder: number[] = [];

      router.onClose(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        executionOrder.push(1);
      });

      router.onClose(() => {
        executionOrder.push(2);
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      wsHandler.close?.(mockWs as any, 1000, "Normal closure");

      // Handler 2 executes immediately (fire-and-forget for async)
      expect(executionOrder).toEqual([2]);

      // Wait for async handler to complete
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(executionOrder).toEqual([2, 1]);
    });

    it("should provide all context fields in onClose", () => {
      const router = new WebSocketRouter();
      let contextFields: {
        hasWs: boolean;
        hasCode: boolean;
        hasReason: boolean;
        hasSend: boolean;
        code?: number;
        reason?: string;
      } = {
        hasWs: false,
        hasCode: false,
        hasReason: false,
        hasSend: false,
      };

      router.onClose((ctx) => {
        contextFields = {
          hasWs: !!ctx.ws,
          hasCode: typeof ctx.code === "number",
          hasReason: typeof ctx.reason === "string",
          hasSend: typeof ctx.send === "function",
          code: ctx.code,
          reason: ctx.reason,
        };
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      wsHandler.close?.(mockWs as any, 1000, "Normal closure");

      expect(contextFields.hasWs).toBe(true);
      expect(contextFields.hasCode).toBe(true);
      expect(contextFields.hasReason).toBe(true);
      expect(contextFields.hasSend).toBe(true);
      expect(contextFields.code).toBe(1000);
      expect(contextFields.reason).toBe("Normal closure");
    });

    it("should provide send function for broadcasting in onClose", () => {
      const router = new WebSocketRouter();
      let canUseSend = false;

      const DisconnectMessage = messageSchema("USER_DISCONNECTED", {
        clientId: z.string(),
      });

      router.onClose((ctx) => {
        // Send function should be available for broadcasting
        // (even though you can't send to the closed connection itself)
        canUseSend = typeof ctx.send === "function";
        ctx.send(DisconnectMessage, { clientId: ctx.ws.data.clientId });
      });

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      wsHandler.close?.(mockWs as any, 1000, "Normal closure");

      expect(canUseSend).toBe(true);
    });
  });

  describe("Combined onOpen and onClose", () => {
    it("should maintain separate handler arrays for open and close", () => {
      const router = new WebSocketRouter();
      const openCalled = mock(() => {});
      const closeCalled = mock(() => {});

      router.onOpen(() => openCalled());
      router.onClose(() => closeCalled());

      const wsHandler = router.websocket;
      const mockWs = {
        data: { clientId: "test-123" },
        send: mock(() => {}),
      };

      // Trigger open
      wsHandler.open?.(mockWs as any);
      expect(openCalled).toHaveBeenCalledTimes(1);
      expect(closeCalled).toHaveBeenCalledTimes(0);

      // Trigger close
      wsHandler.close?.(mockWs as any, 1000, "Normal closure");
      expect(openCalled).toHaveBeenCalledTimes(1);
      expect(closeCalled).toHaveBeenCalledTimes(1);
    });
  });
});
