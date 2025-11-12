// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, mock } from "bun:test";
import { CoreRouter } from "../../src/core/router";
import type { ServerWebSocket } from "../../src/ws/platform-adapter";

/**
 * Unit tests for the router.websocket bridge.
 *
 * Tests the platform-agnostic WebSocket handler interface that adapters
 * (Bun, Cloudflare, Node.js) depend on to integrate with the router.
 *
 * This is a low-level API test that ensures:
 * 1. The bridge exists and is properly typed
 * 2. The bridge correctly delegates to handleOpen/Message/Close
 * 3. The bridge object is memoized (same reference on multiple accesses)
 * 4. The bridge works with mock ServerWebSocket instances
 */
// Helper: Create a proper mock WebSocket that works with WeakMap
class MockWebSocket implements ServerWebSocket {
  data: { clientId: string };
  constructor(clientId: string) {
    this.data = { clientId };
  }
  send() {}
  close() {}
  subscribe() {}
  unsubscribe() {}
}

function createMockWebSocket(clientId: string): ServerWebSocket {
  return new MockWebSocket(clientId);
}

describe("CoreRouter.websocket Bridge", () => {
  it("should expose websocket property with open, message, close methods", () => {
    const router = new CoreRouter();

    // Verify property exists
    expect(router.websocket).toBeDefined();

    // Verify structure
    expect(typeof router.websocket.open).toBe("function");
    expect(typeof router.websocket.message).toBe("function");
    expect(typeof router.websocket.close).toBe("function");
  });

  it("should memoize websocket bridge (same reference on multiple accesses)", () => {
    const router = new CoreRouter();

    // Access multiple times
    const bridge1 = router.websocket;
    const bridge2 = router.websocket;
    const bridge3 = router.websocket;

    // Should be the exact same object (not recreated)
    expect(bridge1).toBe(bridge2);
    expect(bridge2).toBe(bridge3);
  });

  it("should delegate websocket.open() to handleOpen()", async () => {
    const router = new CoreRouter();
    let openCalled = false;

    // Spy on handleOpen
    const originalHandleOpen = (router as any).handleOpen.bind(router);
    (router as any).handleOpen = async () => {
      openCalled = true;
      // Don't call original to avoid WeakMap issues in test environment
    };

    // Create mock WebSocket
    const mockWs = createMockWebSocket("test-123");

    // Call via bridge
    await router.websocket.open(mockWs);

    // Verify handleOpen was called
    expect(openCalled).toBe(true);
  });

  it("should delegate websocket.message() to handleMessage()", async () => {
    const router = new CoreRouter();
    let messageCalled = false;
    let capturedData: string | ArrayBuffer | null = null;

    // Spy on handleMessage
    (router as any).handleMessage = async (ws: any, data: any) => {
      messageCalled = true;
      capturedData = data;
    };

    // Create mock WebSocket
    const mockWs = createMockWebSocket("test-123");

    const messageData = JSON.stringify({ type: "TEST", payload: {} });

    // Call via bridge
    await router.websocket.message(mockWs, messageData);

    // Verify handleMessage was called with correct data
    expect(messageCalled).toBe(true);
    expect(capturedData).toBe(messageData);
  });

  it("should delegate websocket.close() to handleClose()", async () => {
    const router = new CoreRouter();
    let closeCalled = false;
    let capturedCode: number | undefined;
    let capturedReason: string | undefined;

    // Spy on handleClose
    (router as any).handleClose = async (
      ws: any,
      code?: number,
      reason?: string,
    ) => {
      closeCalled = true;
      capturedCode = code;
      capturedReason = reason;
    };

    // Create mock WebSocket
    const mockWs = createMockWebSocket("test-123");

    // Call via bridge
    await router.websocket.close(mockWs, 1000, "Normal closure");

    // Verify handleClose was called with correct parameters
    expect(closeCalled).toBe(true);
    expect(capturedCode).toBe(1000);
    expect(capturedReason).toBe("Normal closure");
  });

  it("should support close() without code and reason", async () => {
    const router = new CoreRouter();
    let capturedCode: number | undefined;
    let capturedReason: string | undefined;

    // Spy on handleClose
    (router as any).handleClose = async (
      ws: any,
      code?: number,
      reason?: string,
    ) => {
      capturedCode = code;
      capturedReason = reason;
    };

    // Create mock WebSocket
    const mockWs = createMockWebSocket("test-123");

    // Call via bridge without optional params
    await router.websocket.close(mockWs);

    // Verify parameters were undefined
    expect(capturedCode).toBeUndefined();
    expect(capturedReason).toBeUndefined();
  });

  it("should be compatible with adapter expectations (Bun pattern)", async () => {
    // Simulate Bun adapter usage pattern
    const router = new CoreRouter();

    // Mock the handler methods to avoid WeakMap issues
    const calls = { open: 0, message: 0, close: 0 };
    (router as any).handleOpen = async () => {
      calls.open++;
    };
    (router as any).handleMessage = async () => {
      calls.message++;
    };
    (router as any).handleClose = async () => {
      calls.close++;
    };

    const mockWs = createMockWebSocket("adapter-test");

    // This is the pattern adapters use
    const adapterHandler = {
      async open(ws: ServerWebSocket) {
        await router.websocket.open(ws);
      },
      async message(ws: ServerWebSocket, data: string | Buffer) {
        await router.websocket.message(ws, data);
      },
      async close(ws: ServerWebSocket, code: number, reason?: string) {
        await router.websocket.close(ws, code, reason);
      },
    };

    // Execute adapter pattern
    await adapterHandler.open(mockWs);
    await adapterHandler.message(mockWs, '{"type":"TEST","payload":{}}');
    await adapterHandler.close(mockWs, 1000, "Test");

    // Verify all handler methods were called
    expect(calls.open).toBe(1);
    expect(calls.message).toBe(1);
    expect(calls.close).toBe(1);
  });
});
