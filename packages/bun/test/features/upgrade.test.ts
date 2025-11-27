// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * HTTP Upgrade Pipeline Tests
 *
 * Tests the critical path: HTTP request → authenticate → upgrade → WebSocket creation.
 * Verifies fetch handler correctly prepares upgrade options (clientId, headers, auth).
 */

import { memoryPubSub } from "@ws-kit/memory";
import { createRouter, withPubSub } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createBunHandler } from "../../src/index.js";

describe("Bun: HTTP Upgrade Pipeline", () => {
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    router = createRouter<{ userId?: string; connectedAt?: number }>().plugin(
      withPubSub({ adapter: memoryPubSub() }),
    );
  });

  afterEach(() => {
    router = undefined!;
  });

  it("should process HTTP upgrade request via fetch handler", async () => {
    const { fetch } = createBunHandler(router);
    let capturedWs: any = null;

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        expect(req.url).toContain("ws://");
        expect(options.data).toBeDefined();
        expect(options.data.clientId).toBeDefined();
        expect(typeof options.data.clientId).toBe("string");

        const ws = {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };

        capturedWs = ws;
        return ws;
      },
    };

    const req = new Request("ws://localhost/ws");
    await fetch(req, mockServer as any);

    expect(capturedWs).toBeDefined();
    expect(capturedWs.data.clientId).toBeDefined();
  });

  it("should inject x-client-id header during upgrade", async () => {
    const { fetch } = createBunHandler(router);
    let capturedHeaders: any = null;

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        capturedHeaders = options.headers;
        return {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };
      },
    };

    const req = new Request("ws://localhost/ws");
    await fetch(req, mockServer as any);

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders["x-client-id"]).toBeDefined();
    expect(typeof capturedHeaders["x-client-id"]).toBe("string");
    expect(capturedHeaders["x-client-id"].length).toBe(36); // UUID format
  });

  it("should support custom client ID header name", async () => {
    const { fetch } = createBunHandler(router, {
      clientIdHeader: "x-session-id",
    });
    let capturedHeaders: any = null;

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        capturedHeaders = options.headers;
        return {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };
      },
    };

    const req = new Request("ws://localhost/ws");
    await fetch(req, mockServer as any);

    expect(capturedHeaders["x-session-id"]).toBeDefined();
    expect(capturedHeaders["x-client-id"]).toBeUndefined();
  });

  it("should call authenticate function during upgrade", async () => {
    let authCalled = false;

    const { fetch } = createBunHandler(router, {
      authenticate: () => {
        authCalled = true;
        return { userId: "test-user" };
      },
    });

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        return {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };
      },
    };

    const req = new Request("ws://localhost/ws");
    await fetch(req, mockServer as any);

    expect(authCalled).toBe(true);
  });

  it("should support async authenticate function", async () => {
    let asyncAuthCalled = false;

    const { fetch } = createBunHandler(router, {
      authenticate: async () => {
        asyncAuthCalled = true;
        await Promise.resolve();
        return { userId: "async-user" };
      },
    });

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        return {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };
      },
    };

    const req = new Request("ws://localhost/ws");
    await fetch(req, mockServer as any);

    expect(asyncAuthCalled).toBe(true);
  });

  it("should return 400 when upgrade fails", async () => {
    const { fetch } = createBunHandler(router);

    const mockServer = {
      upgrade: () => false,
    };

    const req = new Request("ws://localhost/ws");
    const response = await fetch(req, mockServer as any);

    expect(response instanceof Response && response.status).toBe(400);
  });

  it("should handle multiple concurrent HTTP upgrades", async () => {
    const { fetch } = createBunHandler(router);
    const upgradedConnections: any[] = [];

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        const ws = {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };
        upgradedConnections.push(ws);
        return ws;
      },
    };

    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(fetch(new Request("ws://localhost/ws"), mockServer as any));
    }

    await Promise.all(requests);

    expect(upgradedConnections.length).toBe(5);

    // Each connection should have a unique clientId
    const clientIds = upgradedConnections.map((ws) => ws.data.clientId);
    const uniqueClientIds = new Set(clientIds);
    expect(uniqueClientIds.size).toBe(5);
  });
});
