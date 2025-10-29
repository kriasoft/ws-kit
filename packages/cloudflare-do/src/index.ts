// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/cloudflare-do - Cloudflare Durable Objects adapter
 *
 * Cloudflare DO platform adapter providing:
 * - `createDurableObjectHandler()` factory for DO WebSocket integration
 * - `DurablePubSub` class implementing PubSub via BroadcastChannel
 * - `federate()` helpers for explicit multi-DO coordination
 * - Per-instance state management integration
 * - Cost optimization and lifecycle hooks
 *
 * @example
 * ```typescript
 * import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 *
 * const handler = createDurableObjectHandler({ router });
 *
 * export default {
 *   fetch(req: Request, state: DurableObjectState, env: Env) {
 *     return handler.fetch(req);
 *   },
 * };
 * ```
 */

export {
  createDurableObjectAdapter,
  toDurableObjectServerWebSocket,
  isDurableObjectServerWebSocket,
} from "./adapter.js";
export { DurablePubSub } from "./pubsub.js";
export { createDurableObjectHandler } from "./handler.js";
export {
  federate,
  federateWithErrors,
  federateWithFilter,
} from "./federate.js";
export { scopeToDoName, getShardedDoId, getShardedStub } from "./sharding.js";

// Export types
export type {
  DurableObjectWebSocketData,
  DurableObjectHandlerOptions,
  DurableObjectHandler,
  DurableObjectContext,
  DurableObjectStorage,
  DurableObjectAlarm,
  DurableObjectNamespace,
  DurableObjectStub,
  DurableObjectEnv,
} from "./types.js";
