/**
 * @ws-kit/serve/bun - Bun platform entrypoint
 *
 * Zero-runtime-detection serve function for Bun.
 * Use this when you know your app only runs on Bun, or for explicit control.
 *
 * @example
 * ```typescript
 * import { serve } from "@ws-kit/serve/bun";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 * // ... register handlers ...
 *
 * serve(router, { port: 3000 });
 * ```
 */

import type { Router } from "@ws-kit/core";
import type { ServeOptions } from "./types.js";

export type { ServeOptions } from "./types.js";

/**
 * Serve a router on Bun.
 *
 * This entrypoint bypasses runtime detection entirely—use it when you know
 * you're running on Bun or when you want explicit control without detection overhead.
 *
 * @param router - The WebSocket router to serve
 * @param options - Bun-specific options
 * @returns Promise that resolves when server is running
 *
 * @throws Error if Bun is not available
 */
export async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> = {},
): Promise<void> {
  const { createBunHandler } = await import("@ws-kit/bun");

  // Extract the core router if it's wrapped
  // (in case someone passes a typed wrapper)
  const coreRouter = (router as any)[Symbol.for("ws-kit.core")] ?? router;

  const { fetch, websocket } = createBunHandler(coreRouter, {
    authenticate: options.authenticate as any,
    onError: options.onError,
    onBroadcast: options.onBroadcast,
    onUpgrade: options.onUpgrade,
    onOpen: options.onOpen,
    onClose: options.onClose,
  });

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
