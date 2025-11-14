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
 * **Pub/Sub**:
 * - `withPubSub(options)` - Topic-based broadcasting (ctx.publish)
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { withPubSub } from "@ws-kit/plugins";
 * import { redisPubSub } from "@ws-kit/redis";
 *
 * const router = createRouter()
 *   .plugin(withZod())        // Validation (from validator)
 *   .plugin(withMessaging())    // Messaging (fire-and-forget)
 *   .plugin(withRpc())          // RPC (request-response)
 *   .plugin(withPubSub({
 *     adapter: redisPubSub(redis),  // Use Redis for distributed pub/sub
 *   }));
 * ```
 *
 * ## Direct Imports
 *
 * For convenience, import plugins directly:
 * ```typescript
 * import { withMessaging, withRpc, withPubSub } from "@ws-kit/plugins";
 * ```
 *
 * Or import from subpaths:
 * ```typescript
 * import { withMessaging } from "@ws-kit/plugins/messaging";
 * import { withRpc } from "@ws-kit/plugins/rpc";
 * import { withPubSub } from "@ws-kit/plugins/pubsub";
 * ```
 *
 * ## Architecture
 *
 * See [ADR-031: Plugin-Adapter Architecture](https://github.com/kriasoft/ws-kit/tree/dev/docs/adr/031-plugin-adapter-architecture.md)
 * for design rationale and adapter patterns.
 */

// Messaging plugin
export { withMessaging } from "./messaging/index";
export type { SendOptions, WithMessagingCapability } from "./messaging/types";

// RPC plugin
export { withRpc } from "./rpc/index";
export type { ProgressOptions, ReplyOptions, WithRpcCapability } from "./rpc/types";

// Pub/Sub plugin
export { withPubSub } from "./pubsub/index";
export type {
  PubSubObserver,
  WithPubSubCapability,
  WithPubSubOptions,
} from "./pubsub/types";
