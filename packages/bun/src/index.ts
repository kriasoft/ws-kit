// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/bun - Bun WebSocket server adapter
 *
 * Bun-specific adapter providing:
 * - `bunPubSub()` factory for Bun Pub/Sub integration via plugins
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
 * import { bunPubSub, createBunHandler } from "@ws-kit/bun";
 *
 * const server = Bun.serve({...});
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter: bunPubSub(server) }));
 *
 * const { fetch, websocket } = createBunHandler(router);
 * ```
 */

export { bunPubSub } from "./adapter.js";
export { createBunHandler } from "./handler.js";
export { serve } from "./serve.js";
export { adaptBunWebSocket, isBunWebSocket } from "./websocket.js";

// Export types
export type { BunServeOptions } from "./serve.js";
export type {
  AuthRejection,
  BunConnectionContext,
  BunConnectionData,
  BunErrorEvent,
  BunHandlerOptions,
  BunServerHandlers,
} from "./types.js";
