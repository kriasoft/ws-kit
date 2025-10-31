// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import * as uuid from "uuid";
const { v7: uuidv7 } = uuid;
import type {
  WebSocketRouter,
  ServerWebSocket,
  WebSocketData,
  ValidatorAdapter,
} from "@ws-kit/core";
import type {
  DurableObjectHandler,
  DurableObjectWebSocketData,
} from "./types.js";

/**
 * Create a Cloudflare Durable Object WebSocket handler.
 *
 * Returns a fetch handler compatible with Durable Object script's fetch method.
 * Accepts both typed routers and core routers.
 *
 * **Recommended Usage**:
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
 *
 * const router = createRouter<AppData>();
 *
 * const handler = createDurableObjectHandler(router, {
 *   authenticate: (req) => ({ userId: "123" }),
 *   maxConnections: 1000,
 * });
 *
 * export default {
 *   fetch(req: Request, state: DurableObjectState, env: Env) {
 *     return handler.fetch(req);
 *   },
 * };
 * ```
 *
 * **Connection Flow**:
 * 1. Client connects to a URL like `/ws?room=general`
 * 2. Handler extracts resourceId (room name) from URL
 * 3. Handler upgrades connection with platform adapter and initial data
 * 4. WebSocket lifecycle events (`open`, `message`, `close`) are routed to router
 *
 * @param options - Handler configuration
 * @returns DurableObjectHandler with fetch method
 */
export function createDurableObjectHandler<
  TData extends WebSocketData = WebSocketData,
>(
  router: WebSocketRouter<ValidatorAdapter, TData>,
  options?: {
    authenticate?: (
      req: Request,
    ) => Promise<TData | undefined> | TData | undefined;
    maxConnections?: number;
  },
): DurableObjectHandler {
  const { authenticate, maxConnections = 1000 } = options ?? {};
  // Extract core router if a typed router wrapper is passed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreRouter = (router as any)[Symbol.for("ws-kit.core")] ?? router;
  let connectionCount = 0;

  return {
    /**
     * Fetch handler for HTTP requests and WebSocket upgrades.
     *
     * Cloudflare DO calls this for every request. The handler:
     * 1. Extracts the resource ID from the URL
     * 2. Performs authentication if provided
     * 3. Upgrades valid requests to WebSocket
     * 4. Routes WebSocket events to the router
     */
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // Check if this is a WebSocket upgrade request
      const upgradeHeader = req.headers.get("upgrade");
      if (upgradeHeader?.toLowerCase() !== "websocket") {
        // Not a WebSocket request
        return new Response("Expected WebSocket", { status: 400 });
      }

      // Check connection limit
      if (connectionCount >= maxConnections) {
        return new Response("Maximum connections reached", { status: 503 });
      }

      // Extract resource ID from URL (e.g., ?room=general or path segment)
      const resourceId =
        url.searchParams.get("room") ||
        url.searchParams.get("id") ||
        url.pathname.split("/").pop() ||
        "default";

      // Authenticate if provided
      const customData: TData | undefined = authenticate
        ? await Promise.resolve(authenticate(req))
        : undefined;

      // Prepare connection data
      const clientId = uuidv7();
      const wsData: DurableObjectWebSocketData<TData> = {
        clientId,
        resourceId,
        connectedAt: Date.now(),
        ...(customData || {}),
      } as DurableObjectWebSocketData<TData>;

      try {
        // Create a WebSocketPair (available in Cloudflare Workers)
        // @ts-expect-error - WebSocketPair is a Cloudflare Workers API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const WebSocketPairClass = globalThis.WebSocketPair as any;
        if (!WebSocketPairClass) {
          return new Response("WebSocket not supported", { status: 400 });
        }

        const pair = new WebSocketPairClass();
        const client = pair[1];
        const server = pair[0];

        // Accept the WebSocket on server side
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).accept?.();

        // Attach our data to the server WebSocket
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serverWs = server as any as ServerWebSocket<TData>;
        serverWs.data = wsData;

        connectionCount++;

        // Set up handlers
        try {
          // Validate clientId was set during upgrade
          if (!serverWs.data?.clientId) {
            console.error("[ws] WebSocket missing clientId in data, closing");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (server as any).close(1008, "Missing client ID");
            return new Response("Missing client ID", { status: 400 });
          }
          await coreRouter.handleOpen(serverWs);
        } catch (error) {
          console.error(`[ws] Error in open handler:`, error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (server as any).close(1011, "Internal server error");
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).addEventListener("message", async (event: any) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await coreRouter.handleMessage(serverWs, (event as any).data);
          } catch (error) {
            console.error(`[ws] Error in message handler:`, error);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).addEventListener("close", async () => {
          connectionCount--;
          try {
            await coreRouter.handleClose(serverWs, 1006, "Connection closed");
          } catch (error) {
            console.error(`[ws] Error in close handler:`, error);
          }
        });

        // Return response with client WebSocket
        return new Response(null, {
          status: 101,
          webSocket: client,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      } catch (error) {
        console.error("[ws] Error during WebSocket upgrade:", error);
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
    },
  };
}
