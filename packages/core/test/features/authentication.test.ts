// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import {
  WebSocketRouter,
  type ServerWebSocket,
  type ValidatorAdapter,
  type WebSocketData,
} from "@ws-kit/core";
import { beforeEach, describe, expect, it } from "bun:test";

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

describe("Authentication Failure on First Message", () => {
  let router: WebSocketRouter<typeof mockValidator, WebSocketData>;

  beforeEach(() => {
    router = new WebSocketRouter({
      validator: mockValidator,
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
      },
    });
  });

  it("should reject unauthenticated connection on first message with code 1008", async () => {
    const authRouter = new WebSocketRouter({
      validator: mockValidator,
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
      },
    });

    // Register auth handler that rejects all connections
    authRouter.onAuth(() => false);

    const testWs = createMockWebSocket();

    await authRouter.handleOpen(testWs);

    // Send first message (triggers authentication check)
    await authRouter.handleMessage(
      testWs,
      JSON.stringify({ type: "TEST", meta: {} }),
    );

    // Verify connection is closed with RFC 6455 Policy Violation code (1008)
    const wsWithClose = testWs as unknown as {
      _isClosed(): boolean;
      _getCloseCode(): number | undefined;
      _getCloseReason(): string | undefined;
    };

    expect(wsWithClose._isClosed()).toBe(true);
    expect(wsWithClose._getCloseCode()).toBe(1008);
    expect(wsWithClose._getCloseReason()).toBe("PERMISSION_DENIED");
  });

  it("should use standard 1008 close code (not custom 4403)", async () => {
    const authRouter = new WebSocketRouter({
      validator: mockValidator,
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
      },
    });

    // Async auth handler that rejects
    authRouter.onAuth(async () => {
      return false;
    });

    const testWs = createMockWebSocket();
    await authRouter.handleOpen(testWs);

    await authRouter.handleMessage(
      testWs,
      JSON.stringify({ type: "PING", meta: {} }),
    );

    const wsWithClose = testWs as unknown as {
      _getCloseCode(): number | undefined;
    };

    // Verify that we're using RFC 6455 standard close codes
    const closeCode = wsWithClose._getCloseCode();
    expect(closeCode).toBe(1008); // RFC 6455 Policy Violation
    expect(closeCode).not.toBe(4403); // Not custom code
  });

  it("should use handler-supplied UNAUTHENTICATED reason on auth failure", async () => {
    const authRouter = new WebSocketRouter({
      validator: mockValidator,
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
      },
    });

    // Auth handler that returns UNAUTHENTICATED reason
    authRouter.onAuth(() => "UNAUTHENTICATED");

    const testWs = createMockWebSocket();
    await authRouter.handleOpen(testWs);

    await authRouter.handleMessage(
      testWs,
      JSON.stringify({ type: "TEST", meta: {} }),
    );

    const wsWithClose = testWs as unknown as {
      _isClosed(): boolean;
      _getCloseCode(): number | undefined;
      _getCloseReason(): string | undefined;
    };

    expect(wsWithClose._isClosed()).toBe(true);
    expect(wsWithClose._getCloseCode()).toBe(1008);
    expect(wsWithClose._getCloseReason()).toBe("UNAUTHENTICATED");
  });

  it("should use handler-supplied PERMISSION_DENIED reason on auth failure", async () => {
    const authRouter = new WebSocketRouter({
      validator: mockValidator,
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
      },
    });

    // Auth handler that explicitly returns PERMISSION_DENIED reason
    authRouter.onAuth(() => "PERMISSION_DENIED");

    const testWs = createMockWebSocket();
    await authRouter.handleOpen(testWs);

    await authRouter.handleMessage(
      testWs,
      JSON.stringify({ type: "TEST", meta: {} }),
    );

    const wsWithClose = testWs as unknown as {
      _isClosed(): boolean;
      _getCloseCode(): number | undefined;
      _getCloseReason(): string | undefined;
    };

    expect(wsWithClose._isClosed()).toBe(true);
    expect(wsWithClose._getCloseCode()).toBe(1008);
    expect(wsWithClose._getCloseReason()).toBe("PERMISSION_DENIED");
  });

  it("should support async auth handler returning reason", async () => {
    const authRouter = new WebSocketRouter({
      validator: mockValidator,
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
      },
    });

    // Async auth handler returning UNAUTHENTICATED
    authRouter.onAuth(async () => {
      // Simulate async operation (e.g., token validation)
      return "UNAUTHENTICATED";
    });

    const testWs = createMockWebSocket();
    await authRouter.handleOpen(testWs);

    await authRouter.handleMessage(
      testWs,
      JSON.stringify({ type: "TEST", meta: {} }),
    );

    const wsWithClose = testWs as unknown as {
      _getCloseReason(): string | undefined;
    };

    expect(wsWithClose._getCloseReason()).toBe("UNAUTHENTICATED");
  });
});
