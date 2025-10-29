// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

// @ts-expect-error - uuid types not found by TypeScript, but they work at runtime
import * as uuid from "uuid";
const { v7: uuidv7 } = uuid;
import type {
  WebSocketRouter,
  ServerWebSocket,
  WebSocketData,
} from "@ws-kit/core";
import type { Server, WebSocketHandler } from "bun";
import type {
  BunHandler,
  BunHandlerOptions,
  BunWebSocketData,
} from "./types.js";

/**
 * Create Bun WebSocket handlers for use with Bun.serve.
 *
 * Returns a `{ fetch, websocket }` object that can be passed directly to Bun.serve.
 * Accepts both typed routers and core routers.
 *
 * **Usage**:
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { createBunHandler } from "@ws-kit/bun";
 *
 * const router = createRouter<AppData>();
 * const { fetch, websocket } = createBunHandler(router);
 *
 * Bun.serve({ fetch, websocket, port: 3000 });
 * ```
 *
 * **Connection Flow**:
 * 1. HTTP request arrives at Bun.serve fetch handler
 * 2. Your code calls `router.upgrade(req, { server })` or similar
 * 3. Bun upgrades the connection to WebSocket
 * 4. `websocket.open(ws)` → router handles the connection
 * 5. `websocket.message(ws, msg)` → router routes the message
 * 6. `websocket.close(ws, code, reason)` → router handles cleanup
 *
 * @param router - TypedRouter or WebSocketRouter instance
 * @param options - Optional handler configuration
 * @returns Object with `fetch` and `websocket` handlers for Bun.serve
 */
export function createBunHandler<TData extends WebSocketData = WebSocketData>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router: WebSocketRouter<any, TData>,
  options?: BunHandlerOptions<TData>,
): BunHandler<TData> {
  // Extract core router if a typed router wrapper is passed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreRouter = (router as any)[Symbol.for("ws-kit.core")] ?? router;
  const clientIdHeader = options?.clientIdHeader ?? "x-client-id";

  return {
    /**
     * Fetch handler for HTTP upgrade requests.
     *
     * This handler is called for every HTTP request. Your application code should:
     * 1. Check if the request is a WebSocket upgrade (path, method, headers)
     * 2. Perform any async authentication
     * 3. Call server.upgrade(req, { data: { clientId, ...customData }, headers })
     * 4. Return the result
     *
     * For a simple example:
     * ```typescript
     * const { fetch, websocket } = createBunHandler(router);
     *
     * Bun.serve({
     *   fetch(req, server) {
     *     const url = new URL(req.url);
     *
     *     // Route WebSocket requests
     *     if (url.pathname === "/ws") {
     *       return defaultFetch(req, server);
     *     }
     *
     *     // Handle other HTTP requests
     *     return new Response("Not Found", { status: 404 });
     *   },
     *   websocket,
     * });
     * ```
     *
     * Or you can return the result of server.upgrade directly from this fetch handler.
     */
    fetch: async (req: Request, server: Server<any>): Promise<Response> => {
      try {
        // Call onUpgrade hook (before authentication)
        options?.onUpgrade?.(req);

        // Generate unique client ID (UUID v7 - time-ordered)
        const clientId = uuidv7();

        // Call user's authentication function if provided
        const customData: TData | undefined = options?.authenticate
          ? await Promise.resolve(options.authenticate(req))
          : undefined;

        // Prepare connection data with clientId
        const data: BunWebSocketData<TData> = {
          clientId,
          connectedAt: Date.now(),
          ...(customData || {}),
        } as BunWebSocketData<TData>;

        // Upgrade connection with initial data
        // Returns true if successful, false if not a valid WebSocket request
        const upgraded = server.upgrade(req, {
          data: data as any,
          headers: {
            [clientIdHeader]: clientId,
          },
        });

        // Note on PubSub initialization:
        // - If router was created with createBunAdapterWithServer(server), BunPubSub is already set
        // - If router uses MemoryPubSub (default), broadcasts are scoped to this instance only
        // - For multi-instance clusters, use RedisPubSub or pre-initialize with the server
        //
        // Example of pre-initialization:
        // ```typescript
        // const { fetch, websocket } = createBunHandler(router);
        // const server = Bun.serve({ fetch, websocket });
        // // Broadcasts now use the server-aware PubSub
        // ```

        if (upgraded) {
          // Upgrade successful, Bun has handled the response
          // Return 200 OK (WebSocket upgrade is handled by Bun automatically)
          return new Response(null, { status: 200 });
        }

        // Upgrade failed (likely not a valid WebSocket request)
        return new Response("Upgrade failed", { status: 500 });
      } catch (error) {
        console.error("[ws] Error in fetch handler:", error);
        return new Response("Internal server error", { status: 500 });
      }
    },

    /**
     * WebSocket handler for Bun.serve.
     *
     * Bun calls these methods as WebSocket lifecycle events occur.
     * This handler binds those events to the router's internal message processing.
     */
    websocket: {
      /**
       * Called when a WebSocket connection is successfully established.
       */
      async open(ws: ServerWebSocket<BunWebSocketData<TData>>): Promise<void> {
        try {
          // Ensure ws has the clientId from the data
          if (!ws.data?.clientId) {
            console.error("[ws] WebSocket missing clientId in data, closing");
            ws.close(1008, "Missing client ID");
            return;
          }

          // Call router's open handler
          await coreRouter.handleOpen(ws);

          // Call onOpen hook (after connection is established and authenticated)
          try {
            options?.onOpen?.({ ws });
          } catch (error) {
            console.error("[ws] Error in onOpen hook:", error);
          }
        } catch (error) {
          console.error("[ws] Error in open handler:", error);
          try {
            ws.close(1011, "Internal server error");
          } catch {
            // Already closed
          }
        }
      },

      /**
       * Called when a message is received from the client.
       */
      async message(
        ws: ServerWebSocket<BunWebSocketData<TData>>,
        message: string | Buffer,
      ): Promise<void> {
        try {
          // Call router's message handler
          await coreRouter.handleMessage(ws, message);
        } catch (error) {
          console.error("[ws] Error in message handler:", error);
          // Don't close the connection on message errors unless critical
        }
      },

      /**
       * Called when the WebSocket connection is closed.
       */
      async close(
        ws: ServerWebSocket<BunWebSocketData<TData>>,
        code: number,
        reason?: string,
      ): Promise<void> {
        try {
          // Call router's close handler
          await coreRouter.handleClose(ws, code, reason);

          // Call onClose hook (after cleanup)
          try {
            options?.onClose?.({ ws });
          } catch (error) {
            console.error("[ws] Error in onClose hook:", error);
          }
        } catch (error) {
          console.error("[ws] Error in close handler:", error);
        }
      },

      /**
       * Optional: Called when the socket's write buffer has drained.
       *
       * Used for backpressure handling. Not implemented here, but can be
       * extended if needed for custom write buffer management.
       */
      drain(ws: ServerWebSocket<BunWebSocketData<TData>>): void {
        // Backpressure handling (optional)
        // Called when ws.send() buffers are flushed
        // Can be used to resume message processing if it was paused
        void ws; // Mark parameter as intentionally unused
      },
    } as WebSocketHandler<BunWebSocketData<TData>>,
  };
}

/**
 * Create a simple default fetch handler for WebSocket upgrades.
 *
 * This is a convenience function for the common case where your app
 * only serves WebSocket connections (no HTTP routes).
 *
 * **Usage**:
 * ```typescript
 * const { defaultFetch, websocket } = createBunHandler(router);
 *
 * Bun.serve({
 *   fetch: defaultFetch,
 *   websocket,
 * });
 * ```
 *
 * This handler:
 * - Upgrades all requests as WebSocket connections
 * - Returns 400 Bad Request if the upgrade fails
 *
 * For routing to specific paths or methods, use the main fetch handler
 * and implement your own routing logic.
 */
export function createDefaultBunFetch<
  TData extends WebSocketData = WebSocketData,
>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router: WebSocketRouter<any, TData>,
  options?: BunHandlerOptions<TData>,
) {
  const { fetch } = createBunHandler(router, options);
  return fetch;
}
