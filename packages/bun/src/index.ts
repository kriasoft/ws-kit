// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/bun - Bun WebSocket server adapter
 *
 * Bun-specific platform adapter providing:
 * - `createBunAdapter()` factory for PlatformAdapter integration
 * - `BunPubSub` class implementing native server.publish() broadcasting
 * - `createBunHandler()` factory for Bun.serve integration
 * - `serve()` high-level convenience function for starting a server
 * - Zero-copy message broadcasting and native backpressure handling
 *
 * @example High-level (quick start)
 * ```typescript
 * import { serve } from "@ws-kit/bun";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 * serve(router, { port: 3000 });
 * ```
 *
 * @example Low-level (advanced usage)
 * ```typescript
 * import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter({
 *   platform: createBunAdapter(),
 * });
 *
 * const { fetch, websocket } = createBunHandler(router);
 *
 * Bun.serve({
 *   fetch(req, server) {
 *     if (new URL(req.url).pathname === "/ws") {
 *       return fetch(req, server);
 *     }
 *     return new Response("Not Found", { status: 404 });
 *   },
 *   websocket,
 * });
 * ```
 */

export { createBunAdapter, createBunAdapterWithServer } from "./adapter.js";
export { BunPubSub } from "./pubsub.js";
export { createBunHandler, createDefaultBunFetch } from "./handler.js";
export { toBunServerWebSocket, isBunServerWebSocket } from "./websocket.js";
export { serve } from "./serve.js";

// Export types
export type {
  UpgradeOptions,
  BunHandlerOptions,
  BunWebSocketData,
  BunWebSocket,
  BunHandler,
} from "./types.js";
export type { ServeOptions } from "./serve.js";
