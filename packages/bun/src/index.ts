// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/bun - Bun WebSocket server adapter
 *
 * Bun-specific platform adapter providing:
 * - `createBunAdapter()` factory for PlatformAdapter integration
 * - `BunPubSub` class implementing native server.publish() broadcasting
 * - `createBunHandler()` factory for Bun.serve integration
 * - Zero-copy message broadcasting and native backpressure handling
 *
 * @example
 * ```typescript
 * import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
 * import { WebSocketRouter } from "@ws-kit/core";
 * import { zodValidator } from "@ws-kit/zod";
 *
 * const router = new WebSocketRouter({
 *   platform: createBunAdapter(),
 *   validator: zodValidator(),
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

export { createBunAdapter, createBunAdapterWithServer } from "./adapter";
export { BunPubSub } from "./pubsub";
export { createBunHandler, createDefaultBunFetch } from "./handler";
export { toBunServerWebSocket, isBunServerWebSocket } from "./websocket";

// Export types
export type {
  UpgradeOptions,
  BunHandlerOptions,
  BunWebSocketData,
  BunWebSocket,
  BunHandler,
} from "./types";
