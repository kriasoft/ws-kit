// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from "bun:test";
import {
  WebSocketRouter,
  type ServerWebSocket,
  type ValidatorAdapter,
  type WebSocketData,
} from "../../src/index.js";

// ============================================================================
// Mock Implementations
// ============================================================================

const mockValidator: ValidatorAdapter = {
  getMessageType(schema: unknown): string {
    return (schema as { type: string }).type;
  },
  safeParse(schema: unknown, data: unknown) {
    return { success: true, data };
  },
  infer<T>(schema: T): unknown {
    return schema;
  },
};

function createMockWebSocket(
  clientId = "test-client",
): ServerWebSocket<WebSocketData> & { _isClosed(): boolean } {
  let isClosed = false;
  let closeCode: number | undefined;
  let closeReason: string | undefined;

  return {
    data: { clientId },
    send() {
      /* no-op */
    },
    close(code?: number, reason?: string) {
      isClosed = true;
      closeCode = code;
      closeReason = reason;
    },
    subscribe() {
      /* no-op */
    },
    unsubscribe() {
      /* no-op */
    },
    readyState: isClosed ? 3 : 1,
    _isClosed() {
      return isClosed;
    },
    _getCloseCode() {
      return closeCode;
    },
    _getCloseReason() {
      return closeReason;
    },
  } as unknown as ServerWebSocket<WebSocketData> & {
    _isClosed(): boolean;
    _getCloseCode(): number | undefined;
    _getCloseReason(): string | undefined;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Heartbeat Management", () => {
  let router: WebSocketRouter<typeof mockValidator, WebSocketData>;
  let ws: ServerWebSocket<WebSocketData>;

  beforeEach(() => {
    router = new WebSocketRouter({
      validator: mockValidator,
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
      },
    });
    ws = createMockWebSocket();
  });

  afterEach(() => {
    // Clean up router to release heartbeat timers and resources
    (router as any)?.dispose?.();
  });

  describe("Heartbeat Initialization", () => {
    it("should initialize heartbeat on connection open", async () => {
      await router.handleOpen(ws);

      // Connection should be open and actively monitored
      const mockWs = ws as any;
      expect(mockWs._isClosed()).toBe(false);
    });

    it("should use custom heartbeat config", () => {
      const customRouter = new WebSocketRouter({
        validator: mockValidator,
        heartbeat: {
          intervalMs: 60000,
          timeoutMs: 10000,
        },
      });

      onTestFinished(() => {
        (customRouter as any)?.dispose?.();
      });

      expect(customRouter).toBeDefined();
    });

    it("should use default heartbeat config if not provided", () => {
      const defaultRouter = new WebSocketRouter({
        validator: mockValidator,
      });

      onTestFinished(() => {
        (defaultRouter as any)?.dispose?.();
      });

      expect(defaultRouter).toBeDefined();
    });

    it("should support disabling heartbeat", async () => {
      const noHeartbeatRouter = new WebSocketRouter({
        validator: mockValidator,
        heartbeat: false as any,
      });

      onTestFinished(() => {
        (noHeartbeatRouter as any)?.dispose?.();
      });

      const testWs = createMockWebSocket();
      await noHeartbeatRouter.handleOpen(testWs);

      // Should remain open even after timeout period (heartbeat disabled)
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect((testWs as any)._isClosed()).toBe(false);
    });
  });

  describe("Pong Handling", () => {
    it("should reset pong timeout on pong signal", async () => {
      await router.handleOpen(ws);

      // Wait part way through the timeout window
      await new Promise((resolve) => setTimeout(resolve, 40));

      // Send pong to reset timeout
      router.handlePong(ws.data.clientId);

      // Wait a moderate amount more (not enough to trigger new timeout from pong)
      await new Promise((resolve) => setTimeout(resolve, 40));

      const mockWs = ws as any;
      expect(mockWs._isClosed()).toBe(false);
    });

    it("should accept multiple pong signals", async () => {
      await router.handleOpen(ws);

      // Send multiple pongs at regular intervals to keep connection alive
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        router.handlePong(ws.data.clientId);
      }

      // Connection should still be open after multiple pongs
      const mockWs = ws as any;
      expect(mockWs._isClosed()).toBe(false);
    });
  });

  describe("Heartbeat with Messages", () => {
    it("should reset pong timeout when message is received", async () => {
      await router.handleOpen(ws);

      // Wait part way through the timeout window
      await new Promise((resolve) => setTimeout(resolve, 40));

      // Send a message (resets pong timeout)
      await router.handleMessage(
        ws,
        JSON.stringify({ type: "TEST", meta: {} }),
      );

      // Wait a bit more (not enough to trigger timeout from the reset)
      await new Promise((resolve) => setTimeout(resolve, 40));

      const mockWs = ws as any;
      expect(mockWs._isClosed()).toBe(false);
    });

    it("should reset pong timeout for each message", async () => {
      await router.handleOpen(ws);

      // Send multiple messages at regular intervals to keep connection alive
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        await router.handleMessage(
          ws,
          JSON.stringify({ type: "TEST", meta: {} }),
        );
      }

      // Connection should still be open after multiple messages
      const mockWs = ws as any;
      expect(mockWs._isClosed()).toBe(false);
    });
  });

  describe("Heartbeat Cleanup", () => {
    it("should clean up heartbeat on close", async () => {
      await router.handleOpen(ws);
      const mockWs = ws as any;

      // Verify connection is open
      expect(mockWs._isClosed()).toBe(false);

      // Close the connection - should complete without error
      await expect(router.handleClose(ws, 1000)).resolves.toBeUndefined();
    });

    it("should clear timers on close", async () => {
      await router.handleOpen(ws);

      // Close the connection - should complete without error
      await expect(router.handleClose(ws, 1000)).resolves.toBeUndefined();

      // Wait past the timeout period to ensure no lingering timers fire
      const initialCode = (ws as any)._getCloseCode?.();
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Verify state hasn't changed (no lingering timers tried to re-close)
      const finalCode = (ws as any)._getCloseCode?.();
      expect(finalCode).toBe(initialCode);
    });
  });

  describe("Multiple Connections", () => {
    it("should manage heartbeats for multiple connections independently", async () => {
      const ws1 = createMockWebSocket("client-1");
      const ws2 = createMockWebSocket("client-2");
      const ws3 = createMockWebSocket("client-3");

      await router.handleOpen(ws1);
      await router.handleOpen(ws2);
      await router.handleOpen(ws3);

      // Let all approach timeout (wait 40ms into the timeout window)
      await new Promise((resolve) => setTimeout(resolve, 40));

      // Only pong ws1 and ws3, let ws2 timeout
      router.handlePong("client-1");
      router.handlePong("client-3");

      // Wait longer to ensure ws2 times out and others don't
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect((ws1 as any)._isClosed()).toBe(false);
      expect((ws2 as any)._isClosed()).toBe(true);
      expect((ws3 as any)._isClosed()).toBe(false);
    });

    it("should handle pong for correct connection only", async () => {
      const ws1 = createMockWebSocket("client-1");
      const ws2 = createMockWebSocket("client-2");

      await router.handleOpen(ws1);
      await router.handleOpen(ws2);

      // Wait part way into timeout window
      await new Promise((resolve) => setTimeout(resolve, 40));

      // Pong only for ws1
      router.handlePong("client-1");

      // Wait longer to ensure ws2 times out, ws1 survives
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect((ws1 as any)._isClosed()).toBe(false);
      expect((ws2 as any)._isClosed()).toBe(true);
    });
  });

  describe("Heartbeat Timeout", () => {
    it("should close connection on heartbeat timeout", async () => {
      const shortTimeoutRouter = new WebSocketRouter({
        validator: mockValidator,
        heartbeat: {
          intervalMs: 100,
          timeoutMs: 50,
        },
      });

      onTestFinished(() => {
        (shortTimeoutRouter as any)?.dispose?.();
      });

      const testWs = createMockWebSocket();
      await shortTimeoutRouter.handleOpen(testWs);

      // Wait for pong timeout to trigger: intervalMs + timeoutMs + buffer
      // Bun doesn't yet support mock timers, so we use real timers with sufficient delay
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Verify connection was closed with heartbeat timeout code
      const mockWs = testWs as unknown as {
        _isClosed(): boolean;
        _getCloseCode(): number | undefined;
        _getCloseReason(): string | undefined;
      };

      expect(mockWs._isClosed?.()).toBe(true);
      expect(mockWs._getCloseCode?.()).toBe(4000);
      expect(mockWs._getCloseReason?.()).toBe("HEARTBEAT_TIMEOUT");
    });
  });

  describe("Edge Cases", () => {
    it("should handle pong for non-existent connection gracefully", () => {
      // Should not throw
      expect(() => router.handlePong("non-existent")).not.toThrow();
    });

    it("should handle close for non-existent connection gracefully", async () => {
      const fakeWs = createMockWebSocket("fake");

      // Should not throw
      await expect(router.handleClose(fakeWs, 1000)).resolves.toBeUndefined();
    });

    it("should handle multiple closes for same connection", async () => {
      await router.handleOpen(ws);

      // Both close calls should complete without error
      // Tests idempotent cleanup: closing an already-closed connection is safe
      await expect(router.handleClose(ws, 1000)).resolves.toBeUndefined();
      await expect(router.handleClose(ws, 1000)).resolves.toBeUndefined();
    });
  });
});
