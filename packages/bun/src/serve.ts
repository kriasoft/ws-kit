// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/bun - Bun serve function
 *
 * High-level convenience wrapper for serving a router on Bun.
 */

import type { Router, ConnectionData } from "@ws-kit/core";
import type { BunHandlerOptions } from "./types.js";

/**
 * Options for the serve function.
 *
 * Extends BunHandlerOptions with Bun-specific server config.
 * Per ADR-035, only mechanical options (auth, lifecycle) are supported.
 * Behavioral concerns (context, observability) belong in plugins.
 */
export interface ServeOptions<TContext extends ConnectionData = ConnectionData>
  extends BunHandlerOptions<TContext> {
  /**
   * Port to listen on.
   * @default 3000
   */
  port?: number;
}

/**
 * Serve a router on Bun.
 *
 * High-level convenience function that creates a WebSocket handler and starts
 * a Bun HTTP server. For more control, use `createBunHandler()` directly.
 *
 * @param router - The WebSocket router to serve
 * @param options - Server options
 * @returns Promise that resolves when server is running (never completes)
 *
 * @example
 * ```typescript
 * import { serve } from "@ws-kit/bun";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 * serve(router, { port: 3000 });
 * ```
 */
export async function serve<TContext extends ConnectionData = ConnectionData>(
  router: Router<TContext>,
  options: ServeOptions<TContext> = {},
): Promise<void> {
  const { createBunHandler } = await import("./handler.js");
  const { BunPubSub } = await import("./pubsub.js");

  // Extract the core router if it's wrapped
  // (in case someone passes a typed wrapper)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreRouter = (router as any)[Symbol.for("ws-kit.core")] ?? router;

  // Per ADR-035: Pass only mechanical options (auth, lifecycle hooks) to createBunHandler.
  // Rationale: Adapter should not have behavioral concerns (context, observability).
  // Those belong in plugins on top of the router, not in the adapter itself.
  // This keeps the adapter lean and consistent with ADR-031 (plugin-adapter architecture).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlerOptions: any = {
    authenticate: options.authenticate as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    onError: options.onError,
    onUpgrade: options.onUpgrade,
    onOpen: options.onOpen,
    onClose: options.onClose,
  };
  if (options.clientIdHeader) {
    handlerOptions.clientIdHeader = options.clientIdHeader;
  }
  if (options.authRejection) {
    handlerOptions.authRejection = options.authRejection;
  }

  const { fetch, websocket } = createBunHandler(coreRouter, handlerOptions);

  // Return a promise that never resolves (server runs indefinitely)
  return new Promise(() => {
    const server = Bun.serve({
      port: options.port ?? 3000,
      fetch,
      websocket,
    });

    // Initialize BunPubSub for this server instance if not already configured
    // This enables router.publish() to broadcast to WebSocket connections
    // Respects any custom pub/sub backend already configured by the user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(coreRouter as any).pubsubInstance) {
      // We set the private pubsubInstance field directly since the property is readonly
      Object.defineProperty(coreRouter, "pubsubInstance", {
        value: new BunPubSub(server),
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }

    console.log(`WebSocket server running on ws://localhost:${server.port}`);
  });
}
