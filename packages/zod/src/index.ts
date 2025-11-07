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
export { createZodRouter as createRouter } from "./router.js";
export { default as zodValidator } from "./validator.js";
export { createMessage, ErrorMessage, message, rpc, z };

// Utility exports for advanced use cases
export { ZodValidatorAdapter } from "./adapter.js";

// Type exports
export type { TypedZodRouter } from "./router.js";
export type { AnyMessageSchema, MessageSchema } from "./schema.js";
export type {
  ErrorCode,
  InferMessage,
  InferMeta,
  InferPayload,
  MessageContext,
  MessageHandler,
  MessageHandlerEntry,
  MessageSchemaType,
  RpcErrorCode,
  SendFunction,
} from "./types.js";

// Re-export error utilities and types
export { ERROR_CODE_META } from "@ws-kit/core";
export type { ErrorCodeMetadata } from "@ws-kit/core";

// Re-export core types for convenience
export type {
  AuthFailurePolicy,
  CloseHandler,
  CloseHandlerContext,
  OpenHandler,
  OpenHandlerContext,
  WebSocketData,
  WebSocketRouterOptions,
} from "@ws-kit/core";
