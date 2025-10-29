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
 * import { createZodRouter } from "@ws-kit/zod";
 *
 * const router = createZodRouter();
 *
 * const handler = createDurableObjectHandler({ router: router._core });
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
} from "./adapter";
export { DurablePubSub } from "./pubsub";
export {
  createDurableObjectHandler,
  createDurableObjectHandlerWithState,
} from "./handler";
export { federate, federateWithErrors, federateWithFilter } from "./federate";

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
} from "./types";
