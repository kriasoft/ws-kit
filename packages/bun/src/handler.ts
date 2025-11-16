// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Router, ServerWebSocket, ConnectionData } from "@ws-kit/core";
import { type AdapterWebSocket } from "@ws-kit/core";
import type { Server, WebSocketHandler } from "bun";
import * as uuid from "uuid";
import type {
  BunHandler,
  BunHandlerOptions,
  BunWebSocketData,
} from "./types.js";
const { v7: uuidv7 } = uuid;

/**
 * Internal helper to perform WebSocket upgrade with authentication and context wiring.
 *
 * Returns true if upgrade succeeded (Bun has sent 101 Switching Protocols),
 * false if the request cannot be upgraded (e.g., missing Upgrade header).
 *
 * @internal
 */
async function tryUpgrade<TContext extends ConnectionData = ConnectionData>(
  req: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: Server<any>,
  options: BunHandlerOptions<TContext> | undefined,
): Promise<boolean> {
  // Call onUpgrade hook (before authentication)
  options?.onUpgrade?.(req);

  const clientIdHeader = options?.clientIdHeader ?? "x-client-id";

  // Generate unique client ID (UUID v7 - time-ordered)
  const clientId = uuidv7();

  // Call user's authentication function if provided
  const customData: TContext | undefined = options?.authenticate
    ? await Promise.resolve(options.authenticate(req))
    : undefined;

  // Prepare connection data with clientId
  const data: BunWebSocketData<TContext> = {
    clientId,
    connectedAt: Date.now(),
    ...(customData ?? {}),
  };

  // Upgrade connection with initial data.
  // Returns true if successful, false if not a valid WebSocket request.
  return server.upgrade(req, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
    headers: {
      [clientIdHeader]: clientId,
    },
  });
}

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
 * const router = createRouter<TContext>();
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
export function createBunHandler<
  TContext extends ConnectionData = ConnectionData,
>(
  router: Router<TContext>,
  options?: BunHandlerOptions<TContext>,
): BunHandler<TContext> {
  return {
    /**
     * Fetch handler for HTTP upgrade requests.
     *
     * This handler is called for every HTTP request. Your application code should:
     * 1. Check if the request is a WebSocket upgrade (path, method, headers)
     * 2. Perform any async authentication (via options.authenticate)
     * 3. Call this fetch handler or delegate to it
     * 4. Return the result (undefined on successful upgrade, Response on failure/error)
     *
     * **Bun Semantics**: After server.upgrade() returns true, Bun has already sent the
     * "101 Switching Protocols" response. Returning undefined signals that the request
     * is fully handled. Returning a Response only on failure is the correct pattern.
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
     *       return fetch(req, server);
     *     }
     *
     *     // Handle other HTTP requests
     *     return new Response("Not Found", { status: 404 });
     *   },
     *   websocket,
     * });
     * ```
     *
     * Note on PubSub initialization:
     * - If router was created with createBunAdapterWithServer(server), BunPubSub is already set
     * - If router uses MemoryPubSub (default), broadcasts are scoped to this instance only
     * - For multi-instance clusters, use RedisPubSub or pre-initialize with the server
     */
    fetch: async (
      req: Request,
      server: Server<BunWebSocketData<TContext>>,
    ): Promise<Response | void> => {
      try {
        const upgraded = await tryUpgrade(req, server, options);

        if (upgraded) {
          // Upgrade successful — Bun has already sent 101 Switching Protocols.
          // Return undefined to signal that the request is handled.
          return;
        }

        // Upgrade failed (likely not a valid WebSocket request, e.g., missing Upgrade header)
        return new Response("Upgrade failed", { status: 400 });
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
      async open(
        bunWs: import("bun").ServerWebSocket<BunWebSocketData<TContext>>,
      ): Promise<void> {
        try {
          // Ensure ws has the clientId from the data
          if (!bunWs.data?.clientId) {
            console.error("[ws] WebSocket missing clientId in data, closing");
            bunWs.close(1008, "Missing client ID");
            return;
          }

          // Cast to AdapterWebSocket to access mutable initialData field
          // (following ADR-033 opaque transport pattern)
          const ws = bunWs as unknown as AdapterWebSocket;

          // Seed router's context with Bun data via initialData
          // (router will merge this into ctx.data during handleOpen)
          ws.initialData = bunWs.data;

          // Call router's open handler via the object to preserve 'this' binding.
          // This ensures routers with ordinary methods (not arrow functions) work correctly.
          await router.websocket.open(ws);

          // Call onOpen hook (after connection is established and authenticated)
          try {
            options?.onOpen?.({ ws: bunWs });
          } catch (error) {
            console.error("[ws] Error in onOpen hook:", error);
          }
        } catch (error) {
          console.error("[ws] Error in open handler:", error);
          try {
            bunWs.close(1011, "Internal server error");
          } catch {
            // Already closed
          }
        }
      },

      /**
       * Called when a message is received from the client.
       */
      async message(
        bunWs: import("bun").ServerWebSocket<BunWebSocketData<TContext>>,
        data: string | Buffer,
      ): Promise<void> {
        try {
          // Cast to ServerWebSocket for router
          const ws = bunWs as unknown as ServerWebSocket;

          // Convert Buffer to ArrayBuffer if needed
          const payload =
            data instanceof Buffer
              ? (new Uint8Array(data).buffer as ArrayBuffer)
              : (data as string | ArrayBuffer);

          // Call router's message handler via the object to preserve 'this' binding.
          // This ensures routers with ordinary methods (not arrow functions) work correctly.
          await router.websocket.message(ws, payload);
        } catch (error) {
          console.error("[ws] Error in message handler:", error);
          // Don't close the connection on message errors unless critical
        }
      },

      /**
       * Called when the WebSocket connection is closed.
       */
      async close(
        bunWs: import("bun").ServerWebSocket<BunWebSocketData<TContext>>,
        code: number,
        reason?: string,
      ): Promise<void> {
        try {
          // Cast to ServerWebSocket for router
          const ws = bunWs as unknown as ServerWebSocket;

          // Call router's close handler via the object to preserve 'this' binding.
          // This ensures routers with ordinary methods (not arrow functions) work correctly.
          await router.websocket.close(ws, code, reason);

          // Call onClose hook (after cleanup)
          try {
            options?.onClose?.({ ws: bunWs });
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
      drain(
        bunWs: import("bun").ServerWebSocket<BunWebSocketData<TContext>>,
      ): void {
        // Backpressure handling (optional)
        // Called when ws.send() buffers are flushed
        // Can be used to resume message processing if it was paused
        void bunWs; // Mark parameter as intentionally unused
      },
    } as WebSocketHandler<BunWebSocketData<TContext>>,
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
  TContext extends ConnectionData = ConnectionData,
>(router: Router<TContext>, options?: BunHandlerOptions<TContext>) {
  const { fetch } = createBunHandler(router, options);
  return fetch;
}
