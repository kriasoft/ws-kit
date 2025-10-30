// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/zod - Zod validator adapter
 *
 * Type-safe WebSocket router with Zod validation.
 *
 * Core exports (export-with-helpers pattern):
 * - z: Re-exported Zod instance (canonical import source)
 * - message(): Helper to create type-safe message schemas
 * - createRouter(): Create a type-safe router
 *
 * Additional exports:
 * - zodValidator(): Validator adapter for core router
 * - wsClient(): Type-safe WebSocket client
 *
 * @example Modern API (recommended)
 * ```typescript
 * import { z, message, createRouter } from "@ws-kit/zod";
 *
 * const LoginMessage = message("LOGIN", {
 *   username: z.string(),
 *   password: z.string(),
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

// Import Zod as canonical instance
import { z } from "zod";
import { createMessageSchema } from "./schema.js";

// Create message helper using canonical Zod instance
const {
  messageSchema: message,
  ErrorMessage,
  rpc,
  createMessage,
} = createMessageSchema(z);

// Main exports: export-with-helpers pattern
export { z, message, rpc, ErrorMessage, createMessage };
export { default as zodValidator } from "./validator.js";
export { createZodRouter as createRouter } from "./router.js";

// Utility exports for advanced use cases
export { ZodValidatorAdapter } from "./adapter.js";

// Type exports
export type { AnyMessageSchema, MessageSchema } from "./schema.js";
export type { TypedZodRouter } from "./router.js";
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
