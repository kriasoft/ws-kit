// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, expectTypeOf, it, mock } from "bun:test";
import { createBunHandler } from "../src/handler.js";
import type { BunHandler } from "../src/types.js";

describe("createBunHandler", () => {
  let mockRouter: any;
  let mockServer: any;
  let handleOpen: any;
  let handleClose: any;
  let handleMessage: any;

  beforeEach(() => {
    handleOpen = mock(async () => {});
    handleClose = mock(async () => {});
    handleMessage = mock(async () => {});

    mockRouter = {
      websocket: {
        open: handleOpen,
        close: handleClose,
        message: handleMessage,
      },
      // For backwards compatibility with tests checking these directly
      handleOpen,
      handleClose,
      handleMessage,
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

    // The handler converts Buffer to ArrayBuffer internally
    const callArgs = mockRouter.handleMessage.mock.calls[0];
    expect(mockRouter.handleMessage).toHaveBeenCalledTimes(1);
    expect(callArgs[0]).toBe(mockWs);
    expect(callArgs[1]).toBeInstanceOf(ArrayBuffer);
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

  describe("lifecycle hooks", () => {
    it("onOpen receives data and ws context", async () => {
      const onOpen = mock(({ data, ws }) => {
        expect(data.clientId).toBeDefined();
        expect(typeof ws.send).toBe("function");
        expect(typeof ws.close).toBe("function");
      });

      const handler = createBunHandler(mockRouter, { onOpen });
      const mockWs = {
        data: { clientId: "test-id-123", connectedAt: Date.now() },
        send: mock(() => {}),
        close: mock(() => {}),
        readyState: "OPEN",
      };

      await handler.websocket.open(mockWs);
      expect(onOpen).toHaveBeenCalledWith({
        ws: mockWs,
        data: mockWs.data,
      });
    });

    it("onClose receives data and ws context", async () => {
      const onClose = mock(({ data, ws }) => {
        expect(data.clientId).toBeDefined();
        expect(typeof ws.send).toBe("function");
        expect(typeof ws.close).toBe("function");
      });

      const handler = createBunHandler(mockRouter, { onClose });
      const mockWs = {
        data: { clientId: "test-id-456", connectedAt: Date.now() },
        send: mock(() => {}),
        close: mock(() => {}),
        readyState: "OPEN",
      };

      await handler.websocket.close(mockWs, 1000);
      expect(onClose).toHaveBeenCalledWith({
        ws: mockWs,
        data: mockWs.data,
      });
    });

    it("onOpen hook can access ws.readyState for advanced use", async () => {
      const onOpen = mock(({ ws }) => {
        // Advanced: check readyState if needed for Bun-specific logic
        const state = ws.readyState;
        expect(state).toBeDefined();
        expect(typeof state).toBe("string");
      });

      const handler = createBunHandler(mockRouter, { onOpen });
      const mockWs = {
        data: { clientId: "test-id", connectedAt: Date.now() },
        readyState: "OPEN",
      };

      await handler.websocket.open(mockWs);
      expect(onOpen).toHaveBeenCalled();
    });
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

    it("should return undefined on successful upgrade", async () => {
      const handler = createBunHandler(mockRouter);
      const req = new Request("ws://localhost/ws");

      const result = await handler.fetch(req, mockServer);

      // After successful upgrade, Bun has sent 101 response.
      // Return undefined to signal the request is handled.
      expect(result).toBeUndefined();
    });

    it("should return 400 response on upgrade failure", async () => {
      const handler = createBunHandler(mockRouter);
      mockServer.upgrade.mockImplementation(() => false);

      const req = new Request("ws://localhost/ws");
      const result = await handler.fetch(req, mockServer);

      // Upgrade failed (e.g., missing Upgrade header)
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(400);
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

    it("should reject authentication with 401 when authenticate returns undefined", async () => {
      const customAuth = mock(async (req: Request) => undefined);

      const handler = createBunHandler(mockRouter, {
        authenticate: customAuth,
      });
      const req = new Request("ws://localhost/ws");

      const result = await handler.fetch(req, mockServer);

      expect(customAuth).toHaveBeenCalledWith(req);
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(401);
      expect(await result.text()).toBe("Unauthorized");
      expect(mockServer.upgrade).not.toHaveBeenCalled();
    });

    it("should reject authentication with custom status and message", async () => {
      const customAuth = mock(async (req: Request) => undefined);

      const handler = createBunHandler(mockRouter, {
        authenticate: customAuth,
        authRejection: { status: 403, message: "Forbidden" },
      });
      const req = new Request("ws://localhost/ws");

      const result = await handler.fetch(req, mockServer);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(403);
      expect(await result.text()).toBe("Forbidden");
      expect(mockServer.upgrade).not.toHaveBeenCalled();
    });

    it("should accept authentication when empty object is returned", async () => {
      const customAuth = mock(async (req: Request) => ({}));

      const handler = createBunHandler(mockRouter, {
        authenticate: customAuth,
      });
      const req = new Request("ws://localhost/ws");

      await handler.fetch(req, mockServer);

      expect(customAuth).toHaveBeenCalledWith(req);
      expect(mockServer.upgrade).toHaveBeenCalled();
      const callArgs = mockServer.upgrade.mock.calls[0];
      expect(callArgs[1]?.data?.clientId).toBeDefined();
    });

    it("should call onError when upgrade fails", async () => {
      const onError = mock(() => {});
      const handler = createBunHandler(mockRouter, { onError });
      mockServer.upgrade.mockImplementation(() => false);

      const req = new Request("ws://localhost/ws");
      await handler.fetch(req, mockServer);

      expect(onError).toHaveBeenCalledTimes(1);
      const callArgs = onError.mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(Error);
      expect(callArgs[1]?.type).toBe("upgrade");
    });

    it("should call onError when fetch handler throws", async () => {
      const onError = mock(() => {});
      const handler = createBunHandler(mockRouter, { onError });
      mockServer.upgrade.mockImplementation(() => {
        throw new Error("Upgrade error");
      });

      const req = new Request("ws://localhost/ws");
      const result = await handler.fetch(req, mockServer);

      expect(onError).toHaveBeenCalled();
      expect(result.status).toBe(500);
      const callArgs = onError.mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(Error);
      expect(callArgs[1]?.type).toBe("upgrade");
    });
  });

  describe("error hooks", () => {
    it("should call onError when websocket.open throws", async () => {
      const onError = mock(() => {});
      const handler = createBunHandler(mockRouter, { onError });

      mockRouter.handleOpen.mockImplementation(() => {
        throw new Error("Open error");
      });

      const mockWs = {
        data: { clientId: "test-id" },
        close: mock(() => {}),
      };

      await handler.websocket.open(mockWs);

      expect(onError).toHaveBeenCalledTimes(1);
      const callArgs = onError.mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(Error);
      expect(callArgs[1]?.type).toBe("open");
      expect(callArgs[1]?.clientId).toBe("test-id");
      expect(callArgs[1]?.data).toBeDefined();
    });

    it("should call onError when websocket.message throws", async () => {
      const onError = mock(() => {});
      const handler = createBunHandler(mockRouter, { onError });

      mockRouter.handleMessage.mockImplementation(() => {
        throw new Error("Message error");
      });

      const mockWs = {
        data: { clientId: "test-id", userId: "user-1" },
      };

      await handler.websocket.message(mockWs, '{"type":"PING"}');

      expect(onError).toHaveBeenCalledTimes(1);
      const callArgs = onError.mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(Error);
      expect(callArgs[1]?.type).toBe("message");
      expect(callArgs[1]?.clientId).toBe("test-id");
      expect(callArgs[1]?.data?.userId).toBe("user-1");
    });

    it("should call onError when websocket.close throws", async () => {
      const onError = mock(() => {});
      const handler = createBunHandler(mockRouter, { onError });

      mockRouter.handleClose.mockImplementation(() => {
        throw new Error("Close error");
      });

      const mockWs = {
        data: { clientId: "test-id" },
      };

      await handler.websocket.close(mockWs, 1000, "Normal");

      expect(onError).toHaveBeenCalledTimes(1);
      const callArgs = onError.mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(Error);
      expect(callArgs[1]?.type).toBe("close");
      expect(callArgs[1]?.clientId).toBe("test-id");
    });
  });

  describe("typed router unwrapping", () => {
    it("should unwrap typed routers via Symbol", async () => {
      const coreRouterMock = {
        websocket: {
          open: mock(async () => {}),
          message: mock(async () => {}),
          close: mock(async () => {}),
        },
      };

      const typedRouter = {
        [Symbol.for("ws-kit.core")]: coreRouterMock,
      };

      const handler = createBunHandler(typedRouter as any);
      const mockWs = { data: { clientId: "test-id" } };

      await handler.websocket.open(mockWs);

      expect(coreRouterMock.websocket.open).toHaveBeenCalledWith(mockWs);
    });

    it("should fall back to router if no Symbol.for('ws-kit.core')", async () => {
      const handler = createBunHandler(mockRouter);
      const mockWs = { data: { clientId: "test-id" } };

      await handler.websocket.open(mockWs);

      expect(mockRouter.websocket.open).toHaveBeenCalledWith(mockWs);
    });
  });
});
