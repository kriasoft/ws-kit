// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/plugins — Core plugins for WS-Kit routers
 *
 * Framework feature plugins that add capabilities to routers via composition.
 *
 * ## Available Plugins
 *
 * **Messaging**:
 * - `withMessaging()` - Fire-and-forget unicast messaging (ctx.send)
 *
 * **RPC**:
 * - `withRpc()` - Request-response with streaming (ctx.reply, ctx.error, ctx.progress)
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { withMessaging } from "@ws-kit/plugins";
 * import { withRpc } from "@ws-kit/plugins";
 *
 * const router = createRouter()
 *   .plugin(withMessaging())    // Messaging (fire-and-forget)
 *   .plugin(withRpc());         // RPC (request-response)
 * ```
 *
 * ## Pub/Sub Plugin
 *
 * Pub/Sub plugin and middleware are provided by **@ws-kit/pubsub**:
 * ```typescript
 * import { withPubSub, usePubSub } from "@ws-kit/pubsub";
 * import { redisPubSub } from "@ws-kit/redis";
 *
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter: redisPubSub(redis) }))
 *   .use(usePubSub({ hooks: { ... } }));
 * ```
 *
 * See [packages/pubsub](https://github.com/kriasoft/ws-kit/tree/dev/packages/pubsub)
 * for pub/sub documentation and policy enforcement middleware.
 *
 * ## Direct Imports
 *
 * For convenience, import plugins directly:
 * ```typescript
 * import { withMessaging, withRpc } from "@ws-kit/plugins";
 * ```
 *
 * Or import from subpaths:
 * ```typescript
 * import { withMessaging } from "@ws-kit/plugins/messaging";
 * import { withRpc } from "@ws-kit/plugins/rpc";
 * ```
 *
 * ## Architecture
 *
 * See [ADR-031: Plugin-Adapter Architecture](https://github.com/kriasoft/ws-kit/tree/dev/docs/adr/031-plugin-adapter-architecture.md)
 * for design rationale and adapter patterns.
 */

// Messaging plugin
export { withMessaging } from "./messaging/index.js";
export type {
  SendOptions,
  WithMessagingCapability,
} from "./messaging/types.js";

// RPC plugin
export { withRpc } from "./rpc/index.js";
export type {
  ProgressOptions,
  ReplyOptions,
  WithRpcCapability,
} from "./rpc/types.js";
