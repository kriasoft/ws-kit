// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/bun - Bun WebSocket server adapter
 *
 * Bun-specific adapter providing:
 * - `createBunPubSub()` factory for Bun Pub/Sub integration via plugins
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
 * @example With Pub/Sub plugin
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { withPubSub } from "@ws-kit/pubsub";
 * import { createBunPubSub, createBunHandler } from "@ws-kit/bun";
 *
 * const server = Bun.serve({...});
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter: createBunPubSub(server) }));
 *
 * const { fetch, websocket } = createBunHandler(router);
 * ```
 */

export { createBunPubSub } from "./adapter.js";
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
