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
import { createMessageSchema } from "./schema";

// Create message helper using canonical Valibot instance
// (This creates the messageSchema function without requiring a factory)
const {
  messageSchema: message,
  ErrorMessage,
  rpc,
} = createMessageSchema(v as any);

// Main exports: export-with-helpers pattern
export { v, message, rpc, ErrorMessage };
export { default as valibotValidator } from "./validator";
export { createValibotRouter as createRouter } from "./router";

// Utility exports for advanced use cases
export { ValibotValidatorAdapter } from "./adapter";

// Backwards compatibility: re-export old factory (deprecated)
/**
 * @deprecated Use `message()` helper instead.
 *
 * ```typescript
 * // ❌ Old way (factory pattern)
 * import { createMessageSchema } from "@ws-kit/valibot";
 * const { messageSchema } = createMessageSchema(v);
 * const LoginSchema = messageSchema("LOGIN", { username: v.string() });
 *
 * // ✅ New way (export-with-helpers)
 * import { message } from "@ws-kit/valibot";
 * const LoginSchema = message("LOGIN", { username: v.string() });
 * ```
 */
export { createMessageSchema } from "./schema";

// Type exports
export type { AnyMessageSchema, MessageSchema } from "./schema";
export type { TypedValibotRouter } from "./router";
export type {
  ErrorCode,
  InferMeta,
  InferMessage,
  InferPayload,
  MessageContext,
  MessageHandler,
  MessageHandlerEntry,
  MessageSchemaType,
  SendFunction,
} from "./types";

// Re-export core types for convenience
export type {
  CloseHandler,
  CloseHandlerContext,
  OpenHandler,
  OpenHandlerContext,
  WebSocketData,
  WebSocketRouterOptions,
} from "@ws-kit/core";
