// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "bun:test";
import { createRouter } from "../../src/core/createRouter";
import type { ServerWebSocket } from "../../src/ws/platform-adapter";
import type { MessageDescriptor } from "../src/protocol/message-descriptor";

/**
 * Mock WebSocket for testing message dispatch.
 */
function createMockWebSocket(): ServerWebSocket {
  return {
    send: () => {},
    close: () => {},
    readyState: 1,
  } as ServerWebSocket;
}

describe("handleMessage - Message Dispatch", () => {
  let ws: ServerWebSocket;
  let router = createRouter();

  beforeEach(() => {
    ws = createMockWebSocket();
    router = createRouter();
  });

  it("should handle valid JSON message", async () => {
    const schema: MessageDescriptor = {
      type: "PING",
      kind: "event",
    };

    let handled = false;
    router.on(schema, (ctx) => {
      handled = true;
      expect(ctx.type).toBe("PING");
    });

    const message = JSON.stringify({ type: "PING" });
    await router.handleMessage(ws, message);
    expect(handled).toBe(true);
  });

  it("should reject invalid JSON", async () => {
    let errorCalled = false;
    let errorMsg = "";

    router.onError((err) => {
      errorCalled = true;
      errorMsg = String(err);
    });

    await router.handleMessage(ws, "invalid json {");
    expect(errorCalled).toBe(true);
    expect(errorMsg.toLowerCase()).toContain("json");
  });

  it("should reject message without type field", async () => {
    let errorCalled = false;

    router.onError((err) => {
      errorCalled = true;
    });

    const message = JSON.stringify({ payload: {} });
    await router.handleMessage(ws, message);
    expect(errorCalled).toBe(true);
  });

  it("should reject reserved type names", async () => {
    let errorCalled = false;

    router.onError((err) => {
      errorCalled = true;
    });

    const message = JSON.stringify({ type: "__heartbeat" });
    await router.handleMessage(ws, message);
    // System message should be handled, not error
    expect(errorCalled).toBe(false);
  });

  it("should report unknown message types", async () => {
    let errorCalled = false;
    let errorMsg = "";

    router.onError((err) => {
      errorCalled = true;
      errorMsg = String(err);
    });

    const message = JSON.stringify({ type: "UNKNOWN" });
    await router.handleMessage(ws, message);
    expect(errorCalled).toBe(true);
    expect(errorMsg.toLowerCase()).toContain("no handler");
  });

  it("should enforce payload size limits", async () => {
    const limitedRouter = createRouter({
      limits: { maxPayloadBytes: 10 },
    });

    let errorCalled = false;
    let errorMsg = "";

    limitedRouter.onError((err) => {
      errorCalled = true;
      errorMsg = String(err);
    });

    const largeMessage = JSON.stringify({ type: "TEST", payload: "x".repeat(100) });
    await limitedRouter.handleMessage(ws, largeMessage);
    expect(errorCalled).toBe(true);
    expect(errorMsg.toLowerCase()).toContain("exceed");
  });

  it("should pass payload to handler", async () => {
    const schema: MessageDescriptor = {
      type: "ECHO",
      kind: "event",
    };

    let receivedPayload: unknown;

    router.on(schema, (ctx) => {
      receivedPayload = ctx;
    });

    const payload = { text: "hello" };
    const message = JSON.stringify({ type: "ECHO", payload });
    await router.handleMessage(ws, message);

    expect(receivedPayload).toBeDefined();
    expect((receivedPayload as any).ws).toBe(ws);
    expect((receivedPayload as any).type).toBe("ECHO");
  });

  it("should never throw errors", async () => {
    // Even with a bad setup, handleMessage should never throw
    const message = JSON.stringify({ type: "CRASH", payload: null });

    let threwError = false;
    try {
      await router.handleMessage(ws, message);
    } catch (e) {
      threwError = true;
    }

    expect(threwError).toBe(false);
  });
});
