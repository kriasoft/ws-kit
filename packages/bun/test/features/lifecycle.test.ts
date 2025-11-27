// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Lifecycle Hooks Tests
 *
 * Tests onOpen/onClose lifecycle execution with correct context.
 * Simulates Bun's lifecycle by manually calling websocket.open/close
 * after HTTP upgrade completes.
 */

import { memoryPubSub } from "@ws-kit/memory";
import { createRouter, withPubSub } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createBunHandler } from "../../src/index.js";

describe("Bun: Lifecycle Hooks", () => {
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    router = createRouter<{ userId?: string; connectedAt?: number }>().plugin(
      withPubSub({ adapter: memoryPubSub() }),
    );
  });

  afterEach(() => {
    router = undefined!;
  });

  it("should call onOpen handler when connection is upgraded", async () => {
    let openCalled = false;
    let clientIdInContext: string | undefined;

    const { fetch, websocket: webhookWs } = createBunHandler(router, {
      onOpen: ({ data }) => {
        openCalled = true;
        clientIdInContext = data.clientId as string;
      },
    });

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        const ws = {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };

        setImmediate(() => {
          webhookWs.open!(ws as any);
        });
        return ws;
      },
    };

    const req = new Request("ws://localhost/ws");
    await fetch(req, mockServer as any);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(openCalled).toBe(true);
    expect(clientIdInContext).toBeDefined();
  });

  it("should call onClose handler when connection closes", async () => {
    let closeCalled = false;
    let clientIdInClose: string | undefined;

    const { fetch, websocket: webhookWs } = createBunHandler(router, {
      onClose: ({ data }) => {
        closeCalled = true;
        clientIdInClose = data.clientId as string;
      },
    });

    const mockServer = {
      upgrade: (req: Request, options: any) => {
        const ws = {
          data: options.data,
          send: () => {},
          close: () => {},
          subscribe: () => {},
          unsubscribe: () => {},
        };

        setImmediate(() => {
          webhookWs.open!(ws as any);
          setTimeout(() => {
            webhookWs.close!(ws as any, 1000, "Normal closure");
          }, 5);
        });
        return ws;
      },
    };

    const req = new Request("ws://localhost/ws");
    await fetch(req, mockServer as any);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(closeCalled).toBe(true);
    expect(clientIdInClose).toBeDefined();
  });
});
