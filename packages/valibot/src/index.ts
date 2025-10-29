// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/valibot - Valibot validator adapter
 *
 * Valibot-based validator adapter providing:
 * - valibotValidator() for setting up Valibot validation
 * - createMessageSchema() factory for defining typed message schemas
 * - Type-safe message handlers with discriminated union support
 * - Full TypeScript inference from schema to handler context
 */

// Main exports
export { default as valibotValidator } from "./validator";
export { createMessageSchema } from "./schema";
export { createValibotRouter } from "./router";

// Utility exports for advanced use cases
export { ValibotValidatorAdapter } from "./adapter";

// Type exports
export type { AnyMessageSchema, MessageSchema } from "./schema";
export type { TypedValibotRouter } from "./router";
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
