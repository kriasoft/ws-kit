// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ConnectionData, Router, ServerWebSocket } from "@ws-kit/core";
import { type AdapterWebSocket } from "@ws-kit/core";
import type { Server, WebSocketHandler } from "bun";
import type {
  BunConnectionData,
  BunErrorEvent,
  BunHandlerOptions,
  BunServerHandlers,
} from "./types.js";

/**
 * Internal helper to perform WebSocket upgrade with precomputed connection data.
 *
 * Per ADR-035: Separated from auth to isolate concerns.
 * Auth happens in fetch() → data passed here → upgradeConnection() only wires Bun.
 *
 * Returns true if upgrade succeeded (Bun sent 101), false otherwise.
 *
 * @internal
 */
function upgradeConnection<TContext extends ConnectionData = ConnectionData>(
  req: Request,
  server: Server<any>,
  clientId: string,
  initialData: TContext | undefined,
  clientIdHeader: string,
): boolean {
  // Merge auth data with automatic fields (clientId, connectedAt).
  // Rationale: Opaque transport pattern (ADR-033) — ws.data is immutable,
  // so we construct it once here with all context.
  const data: BunConnectionData<TContext> = {
    clientId,
    connectedAt: Date.now(),
    ...(initialData ?? {}),
  } as unknown as BunConnectionData<TContext>;

  return server.upgrade(req, {
    data: data as any,
    headers: { [clientIdHeader]: clientId },
  });
}

/**
 * Create Bun WebSocket handlers for use with Bun.serve.
 *
 * Returns a `{ fetch, websocket }` object that can be passed directly to Bun.serve.
 * Accepts both typed routers and core routers. Per ADR-035, this adapter is a mechanical
 * bridge between Bun's WebSocket API and the router's internal protocol.
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
 * 3. Authentication is performed (if configured)
 * 4. Bun upgrades the connection to WebSocket
 * 5. `websocket.open(ws)` → router handles the connection
 * 6. `websocket.message(ws, msg)` → router routes the message
 * 7. `websocket.close(ws, code, reason)` → router handles cleanup
 *
 * @param router - TypedRouter or WebSocketRouter instance
 * @param options - Optional handler configuration
 * @returns Object with `fetch` and `websocket` handlers for Bun.serve
 */
export function createBunHandler<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = any,
>(
  router: Router<TContext, TExtensions>,
  options?: BunHandlerOptions<TContext>,
): BunServerHandlers<TContext> {
  // Per ADR-035: Unwrap typed routers (e.g., from @ws-kit/zod) to access core.
  // Rationale: Ensures low-level API behaves identically to high-level serve().
  // Mirrors serve.ts logic for consistency. Fallback for direct core routers.
  const coreRouter = (router as any)[Symbol.for("ws-kit.core")] ?? router;

  return {
    /**
     * Fetch handler for HTTP upgrade requests.
     *
     * This handler is called for every HTTP request. Your application code should:
     * 1. Check if the request is a WebSocket upgrade (path, method, headers)
     * 2. Call this fetch handler or delegate to it
     * 3. Return the result (undefined on successful upgrade, Response on failure/error)
     *
     * **Bun Semantics**: After server.upgrade() returns true, Bun has already sent the
     * "101 Switching Protocols" response. Returning undefined signals that the request
     * is fully handled. Returning a Response only on failure is the correct pattern.
     *
     * **Authentication**: If `authenticate` is configured and returns `undefined`,
     * the connection is rejected with a 401 (or configured status). To accept a
     * connection with minimal data, return an empty object `{}` instead.
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
     * **Pub/Sub Note**: If the router is passed to `serve()`, Pub/Sub is auto-initialized
     * with BunPubSub. For custom Pub/Sub backends, use the `withPubSub()` plugin before
     * creating the handler.
     */
    fetch: async (
      req: Request,
      server: Server<any>,
    ): Promise<Response | void> => {
      try {
        const clientIdHeader = options?.clientIdHeader ?? "x-client-id";
        // Per ADR-035: Use native crypto.randomUUID() — no external deps.
        // Rationale: Bun has built-in crypto; removes uuid package.
        const clientId = crypto.randomUUID();

        // Per ADR-035: Auth happens here, before upgrade, as a gatekeeper.
        // Rationale: Single call, predictable semantics, security-critical.
        const customData = options?.authenticate
          ? await Promise.resolve(options.authenticate(req))
          : undefined;

        // Per ADR-035: undefined = reject with configured status (default 401).
        // Rationale: Aligns implementation with documented behavior.
        // Return {} or object to accept with minimal or custom data.
        if (options?.authenticate && customData === undefined) {
          const rejection = options.authRejection ?? {
            status: 401,
            message: "Unauthorized",
          };
          const status = rejection.status ?? 401;
          return new Response(rejection.message, { status });
        }

        // Per ADR-034: Upgrade with precomputed data; don't return Response after success.
        // Rationale: After server.upgrade() returns true, Bun sent 101.
        // Returning undefined signals Bun that request is fully handled.
        const upgraded = upgradeConnection(
          req,
          server,
          clientId,
          customData,
          clientIdHeader,
        );

        if (upgraded) return; // Success: no Response needed

        // Upgrade failed (not a WebSocket request, missing headers, etc.).
        // Call onError for observability before returning 400.
        options?.onError?.(new Error("WebSocket upgrade failed"), {
          type: "upgrade",
          req,
        } as BunErrorEvent);
        return new Response("Upgrade failed", { status: 400 });
      } catch (error) {
        // Unexpected error in fetch handler (auth threw, server.upgrade threw, etc.).
        // Log and notify onError hook, then return 500.
        console.error("[ws] Error in fetch handler:", error);
        const errorObj =
          error instanceof Error ? error : new Error(String(error));
        options?.onError?.(errorObj, {
          type: "upgrade",
          req,
        } as BunErrorEvent);
        return new Response("Internal server error", { status: 500 });
      }
    },

    /**
     * WebSocket handler for Bun.serve.
     *
     * Bun calls these methods as WebSocket lifecycle events occur.
     * This handler binds those events to the core router's internal message processing.
     */
    websocket: {
      /**
       * Called when a WebSocket connection is successfully established.
       */
      async open(
        bunWs: import("bun").ServerWebSocket<BunConnectionData<TContext>>,
      ): Promise<void> {
        const wsData = bunWs.data;

        // Sanity check: clientId must be set by fetch/upgradeConnection.
        // Type cast needed because ConnectionData is Record<string, unknown>
        const clientId = wsData?.clientId as string | undefined;
        if (!clientId) {
          console.error("[ws] WebSocket missing clientId in data, closing");
          bunWs.close(1008, "Missing client ID");
          return;
        }
        let routerError: Error | undefined;

        try {
          // Per ADR-033 (opaque transport): Set initialData so router can merge into ctx.data.
          const ws = bunWs as unknown as AdapterWebSocket;
          ws.initialData = wsData;

          // Call core router's handler.
          await coreRouter.websocket.open(ws);
        } catch (error) {
          console.error("[ws] Error in open handler:", error);
          routerError =
            error instanceof Error ? error : new Error(String(error));
        }

        // Per proposal 093: Adapter hooks ALWAYS fire for observability,
        // even if router lifecycle throws. This ensures connection tracking.
        try {
          options?.onOpen?.({ ws: bunWs, data: wsData });
        } catch (error) {
          console.error("[ws] Error in onOpen hook:", error);
        }

        // If router threw, call onError and close connection
        if (routerError) {
          options?.onError?.(routerError, {
            type: "open",
            clientId,
            data: wsData,
          } as BunErrorEvent);
          try {
            bunWs.close(1011, "Internal server error");
          } catch {
            // Already closed — safe to ignore
          }
        }
      },

      /**
       * Called when a message is received from the client.
       */
      async message(
        bunWs: import("bun").ServerWebSocket<BunConnectionData<TContext>>,
        data: string | Buffer,
      ): Promise<void> {
        try {
          const ws = bunWs as unknown as ServerWebSocket;

          // Convert Buffer to ArrayBuffer for router compatibility.
          // Rationale: Router expects string | ArrayBuffer; Bun may send Buffer.
          // Preserve zero-copy semantics by converting only when needed.
          const payload =
            data instanceof Buffer
              ? (new Uint8Array(data).buffer as ArrayBuffer)
              : (data as string | ArrayBuffer);

          // Per ADR-035: Call coreRouter to delegate to router message handling.
          // Rationale: Router is responsible for validation, routing, etc.
          // Adapter just bridges Bun events to router interface.
          await coreRouter.websocket.message(ws, payload);
        } catch (error) {
          // Per ADR-035: Log error and call onError hook; don't close connection.
          // Rationale: Single message error shouldn't kill the connection.
          // User's error handler decides if closure is needed.
          console.error("[ws] Error in message handler:", error);
          const errorObj =
            error instanceof Error ? error : new Error(String(error));
          options?.onError?.(errorObj, {
            type: "message",
            clientId: bunWs.data?.clientId,
            data: bunWs.data,
          } as BunErrorEvent);
        }
      },

      /**
       * Called when the WebSocket connection is closed.
       */
      async close(
        bunWs: import("bun").ServerWebSocket<BunConnectionData<TContext>>,
        code: number,
        reason?: string,
      ): Promise<void> {
        let routerError: Error | undefined;

        try {
          const ws = bunWs as unknown as ServerWebSocket;

          // Per ADR-035: Call coreRouter.websocket.close for cleanup.
          await coreRouter.websocket.close(ws, code, reason);
        } catch (error) {
          console.error("[ws] Error in close handler:", error);
          routerError =
            error instanceof Error ? error : new Error(String(error));
        }

        // Per proposal 093: Adapter hooks ALWAYS fire for observability,
        // even if router lifecycle throws. This ensures connection tracking.
        try {
          options?.onClose?.({ ws: bunWs, data: bunWs.data });
        } catch (error) {
          console.error("[ws] Error in onClose hook:", error);
        }

        // If router threw, also call onError for error tracking
        if (routerError) {
          options?.onError?.(routerError, {
            type: "close",
            clientId: bunWs.data?.clientId,
            data: bunWs.data,
          } as BunErrorEvent);
        }
      },

      /**
       * Optional: Called when the socket's write buffer has drained.
       *
       * Per ADR-035: Not implemented; router manages backpressure internally.
       * Rationale: Adapter is mechanical. Backpressure (flow control) is
       * router responsibility, not adapter responsibility.
       * Can be extended by users if needed for advanced scenarios.
       */
      drain(
        bunWs: import("bun").ServerWebSocket<BunConnectionData<TContext>>,
      ): void {
        void bunWs; // Unused; reserved for future backpressure handling
      },
    } as WebSocketHandler<BunConnectionData<TContext>>,
  };
}
