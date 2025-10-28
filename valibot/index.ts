// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

// Main exports
export { default as valibotValidator } from "../packages/valibot/src/validator";
export { createMessageSchema } from "../packages/valibot/src/schema";

// Utility exports for advanced use cases
export { ValibotValidatorAdapter } from "../packages/valibot/src/adapter";

// Type exports
export type {
  AnyMessageSchema,
  MessageSchema,
} from "../packages/valibot/src/schema";
export type {
  InferMeta,
  InferMessage,
  InferPayload,
  MessageContext,
  MessageHandler,
  MessageHandlerEntry,
  MessageSchemaType,
  SendFunction,
} from "../packages/valibot/src/types";

// Re-export core types for convenience
export type {
  CloseHandler,
  CloseHandlerContext,
  OpenHandler,
  OpenHandlerContext,
  WebSocketData,
  WebSocketRouterOptions,
} from "@ws-kit/core";

// Legacy exports
export { publish } from "./publish";
export { WebSocketRouter } from "./router";
export { formatValidationError, getErrorContext } from "./utils";
