// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core plugins for WS-Kit.
 *
 * Plugins are framework features that add capabilities to the router via composition.
 * Each plugin takes a router and returns it with new methods or context enhancements.
 *
 * Core plugins:
 * - withMessaging() - Fire-and-forget unicast messaging (ctx.send)
 * - withRpc() - Request-response with streaming (ctx.reply, ctx.error, ctx.progress)
 * - withPubSub() - Topic-based broadcasting (ctx.publish)
 * - withRateLimit() - Rate limiting per connection/user/type
 *
 * Validator plugins (in @ws-kit/zod, @ws-kit/valibot):
 * - withZod() / withValibot() - Schema validation (combines validation + messaging + RPC)
 *
 * See docs/specs/plugins.md and ADR-031 for architecture.
 */

export { withMessaging } from "./messaging/index";
export type { SendOptions, WithMessagingCapability } from "./messaging/types";

export { withRpc } from "./rpc/index";
export type {
  ProgressOptions,
  ReplyOptions,
  WithRpcCapability,
} from "./rpc/types";

export type {
  ValidationAPI,
  ValidationOptions,
  ValidatorAdapter,
} from "./validation/types";
