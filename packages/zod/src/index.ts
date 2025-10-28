// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/zod - Zod validator adapter
 *
 * Zod-based validator adapter providing:
 * - zodValidator() for setting up Zod validation
 * - createMessageSchema() factory for defining typed message schemas
 * - Type-safe message handlers with discriminated union support
 * - Full TypeScript inference from schema to handler context
 */

// Main exports
export { default as zodValidator } from "./validator";
export { createMessageSchema } from "./schema";

// Utility exports for advanced use cases
export { ZodValidatorAdapter } from "./adapter";

// Type exports
export type { AnyMessageSchema, MessageSchema } from "./schema";
export type {
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
