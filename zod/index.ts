// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

// Main exports
export { default as zodValidator } from "../packages/zod/src/validator";
export { createMessageSchema } from "../packages/zod/src/schema";

// Utility exports for advanced use cases
export { ZodValidatorAdapter } from "../packages/zod/src/adapter";

// Type exports
export type {
  AnyMessageSchema,
  MessageSchema,
} from "../packages/zod/src/schema";
export type {
  InferMeta,
  InferMessage,
  InferPayload,
  MessageContext,
  MessageHandler,
  MessageHandlerEntry,
  MessageSchemaType,
  SendFunction,
} from "../packages/zod/src/types";

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
