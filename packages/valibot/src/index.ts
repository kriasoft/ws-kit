// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/valibot - Valibot validator adapter
 *
 * Type-safe WebSocket router with Valibot validation.
 *
 * Core exports (export-with-helpers pattern):
 * - v: Re-exported Valibot instance (canonical import source)
 * - message(): Helper to create type-safe message schemas
 * - createRouter(): Create a type-safe router
 *
 * Additional exports:
 * - valibotValidator(): Validator adapter for core router
 * - wsClient(): Type-safe WebSocket client
 *
 * @example Modern API (recommended)
 * ```typescript
 * import { v, message, createRouter } from "@ws-kit/valibot";
 *
 * const LoginMessage = message("LOGIN", {
 *   username: v.string(),
 *   password: v.string(),
 * });
 *
 * type AppData = { userId?: string };
 * const router = createRouter<AppData>();
 *
 * router.on(LoginMessage, (ctx) => {
 *   // ctx.payload.username is typed as string
 * });
 * ```
 */

// Import Valibot as canonical instance
import * as v from "valibot";
import { createMessageSchema } from "./schema.js";

// Create message helper using canonical Valibot instance
const {
  messageSchema: message,
  ErrorMessage,
  rpc,
  createMessage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} = createMessageSchema(v as any);

// Main exports: export-with-helpers pattern
export { v, message, rpc, ErrorMessage, createMessage };
export { default as valibotValidator } from "./validator.js";
export { createValibotRouter as createRouter } from "./router.js";

// Utility exports for advanced use cases
export { ValibotValidatorAdapter } from "./adapter.js";

// Type exports
export type { AnyMessageSchema, MessageSchema } from "./schema.js";
export type { TypedValibotRouter } from "./router.js";
export type {
  ErrorCode,
  RpcErrorCode,
  InferMeta,
  InferMessage,
  InferPayload,
  MessageContext,
  MessageHandler,
  MessageHandlerEntry,
  MessageSchemaType,
  SendFunction,
} from "./types.js";

// Re-export core types for convenience
export type {
  CloseHandler,
  CloseHandlerContext,
  OpenHandler,
  OpenHandlerContext,
  WebSocketData,
  WebSocketRouterOptions,
} from "@ws-kit/core";
