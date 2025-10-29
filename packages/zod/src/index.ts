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
 * Legacy exports (deprecated, backwards compatible):
 * - createMessageSchema(): Old factory pattern (use message() instead)
 * - createZodRouter(): Old function name (use createRouter() instead)
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
import { createMessageSchema } from "./schema";

// Create message helper using canonical Zod instance
// (This creates the messageSchema function without requiring a factory)
const { messageSchema: message, ErrorMessage } = createMessageSchema(z);

// Main exports: export-with-helpers pattern
export { z, message, ErrorMessage };
export { default as zodValidator } from "./validator";
export { createZodRouter as createRouter } from "./router";

// Utility exports for advanced use cases
export { ZodValidatorAdapter } from "./adapter";

// Backwards compatibility: re-export old factory (deprecated)
/**
 * @deprecated Use `message()` helper instead.
 *
 * ```typescript
 * // ❌ Old way (factory pattern)
 * import { createMessageSchema } from "@ws-kit/zod";
 * const { messageSchema } = createMessageSchema(z);
 * const LoginSchema = messageSchema("LOGIN", { username: z.string() });
 *
 * // ✅ New way (export-with-helpers)
 * import { message } from "@ws-kit/zod";
 * const LoginSchema = message("LOGIN", { username: z.string() });
 * ```
 */
export { createMessageSchema } from "./schema";

// Type exports
export type { AnyMessageSchema, MessageSchema } from "./schema";
export type { TypedZodRouter } from "./router";
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
