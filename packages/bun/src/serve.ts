// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/bun - Bun serve function
 *
 * High-level convenience wrapper for serving a router on Bun.
 */

import type { WebSocketRouter } from "@ws-kit/core";
import type { BunHandlerOptions } from "./types.js";

/**
 * Options for the serve function.
 *
 * Extends BunHandlerOptions with Bun-specific server config.
 */
export interface ServeOptions<TData = any> extends BunHandlerOptions<TData> {
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
export async function serve<TData extends { clientId: string }>(
  router: WebSocketRouter<any, TData>,
  options: ServeOptions<TData> = {},
): Promise<void> {
  const { createBunHandler } = await import("./handler.js");

  // Extract the core router if it's wrapped
  // (in case someone passes a typed wrapper)
  const coreRouter = (router as any)[Symbol.for("ws-kit.core")] ?? router;

  const handlerOptions: any = {
    authenticate: options.authenticate as any,
    onError: options.onError,
    onBroadcast: options.onBroadcast,
    onUpgrade: options.onUpgrade,
    onOpen: options.onOpen,
    onClose: options.onClose,
    context: options.context,
  };
  if (options.clientIdHeader) {
    handlerOptions.clientIdHeader = options.clientIdHeader;
  }

  const { fetch, websocket } = createBunHandler(coreRouter, handlerOptions);

  // Return a promise that never resolves (server runs indefinitely)
  return new Promise(() => {
    const server = Bun.serve({
      port: options.port ?? 3000,
      fetch,
      websocket,
    });

    console.log(`WebSocket server running on ws://localhost:${server.port}`);
  });
}
