// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Server } from "bun";
import { BunPubSub } from "./pubsub.js";

/**
 * Create a Bun Pub/Sub adapter instance.
 *
 * Returns a PubSubAdapter that uses Bun's native server.publish() for
 * zero-copy broadcasting to all subscribed WebSocket connections in this
 * process instance.
 *
 * **Usage**:
 * ```typescript
 * import { createBunPubSub } from "@ws-kit/bun";
 * import { createRouter } from "@ws-kit/zod";
 * import { withPubSub } from "@ws-kit/pubsub";
 *
 * const server = await Bun.serve({...});
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter: createBunPubSub(server) }));
 *
 * const { fetch, websocket } = createBunHandler(router);
 * ```
 *
 * @param server - Bun Server instance for pub/sub
 * @returns A PubSubAdapter that broadcasts to this Bun instance only
 */
export function createBunPubSub(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: Server<any>,
) {
  return new BunPubSub(server);
}
