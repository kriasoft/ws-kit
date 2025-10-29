// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { expectTypeOf } from "bun:test";
import type { WebSocketRouter } from "@ws-kit/core";
import { createBunHandler } from "../src/handler.js";
import type { BunHandler } from "../src/types.js";

describe("createBunHandler", () => {
  let mockRouter: any;
  let mockServer: any;

  beforeEach(() => {
    mockRouter = {
      handleOpen: mock(async () => {}),
      handleClose: mock(async () => {}),
      handleMessage: mock(async () => {}),
    };

    mockServer = {
      upgrade: mock((req: any, options: any) => {
        return { ok: true, ...options };
      }),
    };
  });

  it("should return BunHandler with fetch and websocket", () => {
    const handler = createBunHandler(mockRouter);

    expect(handler).toBeDefined();
    expect(handler.fetch).toBeDefined();
    expect(handler.websocket).toBeDefined();
  });

  it("should return object with correct types", () => {
    const handler = createBunHandler(mockRouter);

    expectTypeOf(handler).toMatchTypeOf<BunHandler>();
    expect(typeof handler.fetch).toBe("function");
    expect(typeof handler.websocket).toBe("object");
  });

  it("should have websocket handler with lifecycle methods", () => {
    const handler = createBunHandler(mockRouter);

    expect(handler.websocket.open).toBeDefined();
    expect(handler.websocket.message).toBeDefined();
    expect(handler.websocket.close).toBeDefined();
    expect(typeof handler.websocket.open).toBe("function");
    expect(typeof handler.websocket.message).toBe("function");
    expect(typeof handler.websocket.close).toBe("function");
  });

  it("should call router.handleOpen when ws.open is called", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = { data: { clientId: "test-id" } };

    await handler.websocket.open(mockWs);

    expect(mockRouter.handleOpen).toHaveBeenCalledWith(mockWs);
    expect(mockRouter.handleOpen).toHaveBeenCalledTimes(1);
  });

  it("should call router.handleMessage when ws.message is called", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = { data: { clientId: "test-id" } };
    const message = '{"type":"PING"}';

    await handler.websocket.message(mockWs, message);

    expect(mockRouter.handleMessage).toHaveBeenCalledWith(mockWs, message);
    expect(mockRouter.handleMessage).toHaveBeenCalledTimes(1);
  });

  it("should call router.handleClose when ws.close is called", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = { data: { clientId: "test-id" } };

    await handler.websocket.close(mockWs, 1000, "Normal closure");

    expect(mockRouter.handleClose).toHaveBeenCalledWith(
      mockWs,
      1000,
      "Normal closure",
    );
  });

  it("should handle WebSocket with Buffer message", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = { data: { clientId: "test-id" } };
    const message = Buffer.from('{"type":"PING"}');

    await handler.websocket.message(mockWs, message);

    expect(mockRouter.handleMessage).toHaveBeenCalledWith(mockWs, message);
  });

  it("should close WebSocket if open fails", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = {
      data: null, // Missing clientId
      close: mock(() => {}),
    };

    await handler.websocket.open(mockWs);

    expect(mockWs.close).toHaveBeenCalledWith(1008, "Missing client ID");
  });

  it("should handle errors in open handler gracefully", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = {
      data: { clientId: "test-id" },
      close: mock(() => {}),
    };

    // Make handleOpen throw an error
    mockRouter.handleOpen.mockImplementation(() => {
      throw new Error("Test error");
    });

    // Should not throw, should close the connection
    await handler.websocket.open(mockWs);
    expect(mockWs.close).toHaveBeenCalledWith(1011, "Internal server error");
  });

  it("should handle errors in message handler gracefully", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = { data: { clientId: "test-id" } };

    // Make handleMessage throw an error
    mockRouter.handleMessage.mockImplementation(() => {
      throw new Error("Test error");
    });

    // Should not throw
    await handler.websocket.message(mockWs, '{"type":"PING"}');
    expect(mockRouter.handleMessage).toHaveBeenCalled();
  });

  it("should handle errors in close handler gracefully", async () => {
    const handler = createBunHandler(mockRouter);
    const mockWs = { data: { clientId: "test-id" } };

    // Make handleClose throw an error
    mockRouter.handleClose.mockImplementation(() => {
      throw new Error("Test error");
    });

    // Should not throw
    await handler.websocket.close(mockWs, 1000);
    expect(mockRouter.handleClose).toHaveBeenCalled();
  });

  describe("fetch handler", () => {
    it("should call server.upgrade on fetch", async () => {
      const handler = createBunHandler(mockRouter);
      const req = new Request("ws://localhost/ws", {
        headers: { Upgrade: "websocket" },
      });

      await handler.fetch(req, mockServer);

      expect(mockServer.upgrade).toHaveBeenCalled();
    });

    it("should pass clientId in upgrade data", async () => {
      const handler = createBunHandler(mockRouter);
      const req = new Request("ws://localhost/ws");

      const result = await handler.fetch(req, mockServer);

      expect(mockServer.upgrade).toHaveBeenCalledTimes(1);
      const callArgs = mockServer.upgrade.mock.calls[0];
      expect(callArgs[1]?.data?.clientId).toBeDefined();
      // clientId should be a valid UUID v7
      expect(typeof callArgs[1]?.data?.clientId).toBe("string");
      expect(callArgs[1]?.data?.clientId?.length).toBe(36); // UUID length
    });

    it("should set x-client-id header in upgrade response", async () => {
      const handler = createBunHandler(mockRouter);
      const req = new Request("ws://localhost/ws");

      await handler.fetch(req, mockServer);

      const callArgs = mockServer.upgrade.mock.calls[0];
      expect(callArgs[1]?.headers?.["x-client-id"]).toBeDefined();
    });

    it("should return upgrade result on success", async () => {
      const handler = createBunHandler(mockRouter);
      const req = new Request("ws://localhost/ws");

      const result = await handler.fetch(req, mockServer);

      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
    });

    it("should return 500 response on upgrade failure", async () => {
      const handler = createBunHandler(mockRouter);
      mockServer.upgrade.mockImplementation(() => null);

      const req = new Request("ws://localhost/ws");
      const result = await handler.fetch(req, mockServer);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(500);
    });

    it("should support custom authentication", async () => {
      const customAuth = mock(async (req: Request) => ({
        userId: "test-user",
      }));

      const handler = createBunHandler(mockRouter, {
        authenticate: customAuth,
      });
      const req = new Request("ws://localhost/ws");

      await handler.fetch(req, mockServer);

      expect(customAuth).toHaveBeenCalledWith(req);

      // Verify auth data is in upgrade data
      const callArgs = mockServer.upgrade.mock.calls[0];
      expect(callArgs[1]?.data?.userId).toBe("test-user");
    });

    it("should use custom client ID header", async () => {
      const handler = createBunHandler(mockRouter, {
        clientIdHeader: "x-session-id",
      });
      const req = new Request("ws://localhost/ws");

      await handler.fetch(req, mockServer);

      const callArgs = mockServer.upgrade.mock.calls[0];
      expect(callArgs[1]?.headers?.["x-session-id"]).toBeDefined();
      expect(callArgs[1]?.headers?.["x-client-id"]).toBeUndefined();
    });

    it("should include connectedAt timestamp in data", async () => {
      const handler = createBunHandler(mockRouter);
      const req = new Request("ws://localhost/ws");
      const beforeFetch = Date.now();

      await handler.fetch(req, mockServer);

      const callArgs = mockServer.upgrade.mock.calls[0];
      const connectedAt = callArgs[1]?.data?.connectedAt;
      const afterFetch = Date.now();

      expect(connectedAt).toBeGreaterThanOrEqual(beforeFetch);
      expect(connectedAt).toBeLessThanOrEqual(afterFetch);
    });
  });
});
