// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PlatformAdapter } from "@ws-kit/core";
import type { Server } from "bun";
import { BunPubSub } from "./pubsub.js";

/**
 * Create a Bun platform adapter for use with WebSocketRouter.
 *
 * The adapter provides Bun-specific implementations of core features:
 * - PubSub using Bun's native server.publish() for zero-copy broadcasting
 * - ServerWebSocket wrapping if needed (usually not required)
 * - No special initialization or cleanup needed
 *
 * **Usage**:
 * ```typescript
 * import { createBunAdapter } from "@ws-kit/bun";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter({
 *   platform: createBunAdapter(),
 * });
 * ```
 *
 * **Note**: The Bun Server instance is passed later to BunPubSub via the
 * handler factory. The adapter itself is server-agnostic.
 *
 * @returns A PlatformAdapter suitable for use with WebSocketRouter
 */
export function createBunAdapter(): PlatformAdapter {
  return {};
}

/**
 * Create a Bun platform adapter with a specific server instance.
 *
 * This variant is useful if you want to set up the PubSub immediately
 * with a known server instance. The adapter will use Bun's native pub/sub.
 *
 * **Usage**:
 * ```typescript
 * import { createBunAdapterWithServer } from "@ws-kit/bun";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const server = await Bun.serve({...});
 * const adapter = createBunAdapterWithServer(server);
 * const router = createRouter({ platform: adapter });
 * ```
 *
 * @param server - Bun Server instance for pub/sub
 * @returns A PlatformAdapter with BunPubSub configured
 */
export function createBunAdapterWithServer(
  server: Server<any>,
): PlatformAdapter {
  return {
    pubsub: new BunPubSub(server),
  };
}
