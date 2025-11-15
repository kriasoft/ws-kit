// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Router, ServerWebSocket, ConnectionData } from "@ws-kit/core";
import { type AdapterWebSocket } from "@ws-kit/core";
import * as uuid from "uuid";
import type {
  DurableObjectHandler,
  DurableObjectWebSocketData,
} from "./types.js";
const { v7: uuidv7 } = uuid;

/**
 * Create a Cloudflare Durable Object WebSocket handler.
 *
 * Returns a fetch handler compatible with Durable Object script's fetch method.
 * Accepts both typed routers and core routers.
 *
 * **Recommended Usage**:
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { createDurableObjectHandler } from "@ws-kit/cloudflare";
 *
 * const router = createRouter<TContext>();
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
  TContext extends ConnectionData = ConnectionData,
>(
  router: Router<TContext>,
  options?: {
    authenticate?: (
      req: Request,
    ) => Promise<TContext | undefined> | TContext | undefined;
    maxConnections?: number;
  },
): DurableObjectHandler {
  const { authenticate, maxConnections = 1000 } = options ?? {};

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
      const customData: TContext | undefined = authenticate
        ? await Promise.resolve(authenticate(req))
        : undefined;

      // Prepare connection data
      const clientId = uuidv7();
      const wsData: DurableObjectWebSocketData<TContext> = {
        clientId,
        resourceId,
        connectedAt: Date.now(),
        ...(customData || {}),
      } as DurableObjectWebSocketData<TContext>;

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

        // Wrap server WebSocket to conform to core interface
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serverWs = server as any as ServerWebSocket;

        connectionCount++;

        // Set up handlers
        try {
          // Validate clientId was set
          if (!wsData?.clientId) {
            console.error("[ws] WebSocket missing clientId in data, closing");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (server as any).close(1008, "Missing client ID");
            return new Response("Missing client ID", { status: 400 });
          }

          // Seed router's context with Cloudflare data via initialData
          // (router will merge this into ctx.data during handleOpen)
          const adapterWs = serverWs as AdapterWebSocket;
          adapterWs.initialData = wsData;

          // Call router's open handler via the object to preserve 'this' binding.
          // This ensures routers with ordinary methods (not arrow functions) work correctly.
          await router.websocket.open(serverWs);
        } catch (error) {
          console.error(`[ws] Error in open handler:`, error);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (server as any).close(1011, "Internal server error");
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).addEventListener("message", async (event: any) => {
          try {
            // Call router's message handler via the object to preserve 'this' binding.
            // This ensures routers with ordinary methods (not arrow functions) work correctly.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await router.websocket.message(serverWs, (event as any).data);
          } catch (error) {
            console.error(`[ws] Error in message handler:`, error);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).addEventListener("close", async () => {
          connectionCount--;
          try {
            // Call router's close handler via the object to preserve 'this' binding.
            // This ensures routers with ordinary methods (not arrow functions) work correctly.
            await router.websocket.close(serverWs, 1006, "Connection closed");
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
