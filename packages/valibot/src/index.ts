// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/valibot - Valibot validator adapter for WS-Kit
 *
 * Canonical import source for Valibot-based WebSocket routing.
 *
 * @example
 * ```typescript
 * import { v, message, rpc, withValibot, createRouter } from "@ws-kit/valibot";
 *
 * const Join = message("JOIN", { roomId: v.string() });
 * const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
 *   id: v.string(),
 *   name: v.string(),
 * });
 *
 * const router = createRouter<{ userId?: string }>()
 *   .plugin(withValibot())
 *   .on(Join, (ctx) => {
 *     // ctx.payload: { roomId: string } (inferred + validated)
 *   })
 *   .rpc(GetUser, async (ctx) => {
 *     // ctx.reply({ id: "u1", name: "Alice" });
 *   });
 * ```
 */

// Canonical Valibot instance (single import source)
export * as v from "valibot";

// Message and RPC schema builders
export { message, rpc } from "./runtime.js";

// Validation plugin (capability gating)
export { withValibot } from "./plugin.js";
export type { WithValibotOptions } from "./plugin.js";

// Type inference utilities (type-level only)
export type {
  AnySchema,
  InferMessage,
  InferMeta,
  InferPayload,
  InferResponse,
  InferType,
  MessageSchema,
  RpcSchema,
} from "./types.js";

// === Convenience Re-exports (ADR-032) ===
// These are optional; canonical imports shown below for reference.

// Core plugins (canonical: @ws-kit/plugins)
export { withMessaging, withRpc } from "@ws-kit/plugins";
export type {
  ProgressOptions,
  ReplyOptions,
  SendOptions,
  WithMessagingCapability,
  WithRpcCapability,
} from "@ws-kit/plugins";

// Feature plugins (canonical: feature-specific packages)
export { withPubSub } from "@ws-kit/pubsub";
export type { WithPubSubCapability } from "@ws-kit/pubsub";

// Core router factory (canonical: @ws-kit/core)
export { createRouter } from "@ws-kit/core";
export type {
  EventContext as MessageContext,
  Router,
  RpcContext,
} from "@ws-kit/core";
