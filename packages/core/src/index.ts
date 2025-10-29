// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/core - Platform-agnostic WebSocket router and types
 *
 * This is the foundation package providing:
 * - Platform-agnostic WebSocket abstractions
 * - Abstract adapter interfaces (ValidatorAdapter, PlatformAdapter, PubSub)
 * - Message context and lifecycle hook type definitions
 * - Error handling and standardized error codes
 * - MemoryPubSub default implementation for testing and single-server deployments
 *
 * Does NOT provide:
 * - Router implementation (Phase 2.2+)
 * - Validator adapters (Zod, Valibot) — provided by @ws-kit/zod, @ws-kit/valibot
 * - Platform adapters (Bun, Cloudflare) — provided by @ws-kit/bun, @ws-kit/cloudflare-do
 *
 * This separation enables flexible composition: any validator + any platform combination
 * works without class explosion or special-case handling.
 */

// ============================================================================
// Core Types & Interfaces
// ============================================================================

export type {
  AppDataDefault,
  ServerWebSocket,
  WebSocketData,
  MessageMeta,
  MessageContext,
  SendFunction,
  OpenHandlerContext,
  OpenHandler,
  CloseHandlerContext,
  CloseHandler,
  MessageHandler,
  AuthHandler,
  ErrorHandler,
  Middleware,
  RouterHooks,
  HeartbeatConfig,
  LimitsConfig,
  WebSocketRouterOptions,
  MessageSchemaType,
  MessageHandlerEntry,
  ValidatorAdapter,
  PlatformAdapter,
  PubSub,
} from "./types.js";

// ============================================================================
// Error Handling
// ============================================================================

export { ErrorCode, WebSocketError } from "./error.js";
export type { ErrorCodeValue, ErrorPayload, ErrorMessage } from "./error.js";

// ============================================================================
// Constants & Defaults
// ============================================================================

export { RESERVED_META_KEYS, DEFAULT_CONFIG } from "./constants.js";
export type { ReservedMetaKey } from "./constants.js";

// ============================================================================
// PubSub Implementation
// ============================================================================

/**
 * Default in-memory Pub/Sub implementation.
 *
 * Suitable for:
 * - Testing
 * - Single Bun server (no horizontal scaling)
 * - Per-resource Cloudflare DO instances
 *
 * Not suitable for:
 * - Multi-process deployments
 * - Applications requiring persistence
 *
 * Use platform-specific adapters for production deployments.
 */
export { MemoryPubSub, publish } from "./pubsub.js";

// ============================================================================
// Message Normalization & Validation
// ============================================================================

export { validateMetaSchema, normalizeInboundMessage } from "./normalize.js";

// ============================================================================
// Utilities
// ============================================================================

/**
 * Throttled broadcast utilities for efficiently publishing rapid state changes.
 *
 * Coalesces multiple rapid messages into fewer broadcasts, reducing bandwidth
 * and processing overhead. Useful for real-time collaboration features like
 * live cursors, presence, or frequent state updates.
 *
 * @example
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { createThrottledPublish } from "@ws-kit/core";
 *
 * const router = createRouter();
 * const throttledPublish = createThrottledPublish(
 *   router.publish.bind(router),
 *   50 // milliseconds
 * );
 *
 * // Fast updates coalesced into single broadcast
 * throttledPublish("room", { cursor: { x: 10, y: 20 } });
 * throttledPublish("room", { cursor: { x: 11, y: 21 } });
 * ```
 */
export {
  createThrottledPublish,
  createAdvancedThrottledPublish,
} from "./throttle.js";
export type { ThrottledBroadcastConfig } from "./throttle.js";

/**
 * Logger adapter interface for structured logging.
 *
 * Allows integration with Winston, Pino, or other logging services instead of
 * relying on console.log. Useful for production deployments with centralized
 * logging and monitoring.
 *
 * @example
 * ```typescript
 * import { createRouter, createLogger } from "@ws-kit/zod";
 *
 * const logger = createLogger({
 *   minLevel: "info",
 *   log: (level, context, message, data) => {
 *     // Send to logging service
 *     logService.send({ level, context, message, data });
 *   },
 * });
 *
 * const router = createRouter({ logger });
 * ```
 */
export { createLogger, DefaultLoggerAdapter, LOG_CONTEXT } from "./logger.js";
export type { LoggerAdapter, LoggerOptions } from "./logger.js";

// ============================================================================
// Router Implementation
// ============================================================================

/**
 * Platform-agnostic WebSocket router for type-safe message routing.
 *
 * Provides:
 * - Message routing with pluggable validators (Zod, Valibot, custom)
 * - Lifecycle hooks (onOpen, onClose, onAuth, onError)
 * - Connection heartbeat with auto-close on timeout
 * - Message payload size limits
 * - Router composition via merge()
 *
 * Platform-agnostic design allows composition with any platform adapter
 * (Bun, Cloudflare DO, Node.js, etc.) and any validator.
 *
 * **Recommended**: For full TypeScript type inference in message handlers,
 * use the typed factory functions:
 * - `createRouter()` from `@ws-kit/zod`
 * - `createRouter()` from `@ws-kit/valibot`
 *
 * @example
 * ```typescript
 * // Recommended: Use typed router factory for full type inference
 * import { createRouter } from "@ws-kit/zod";
 * import { createBunHandler } from "@ws-kit/bun";
 * import { z } from "zod";
 *
 * const PingMessage = message("PING", { text: z.string() });
 *
 * const router = createRouter();
 *
 * router.on(PingMessage, (ctx) => {
 *   console.log("Ping:", ctx.payload.text);
 * });
 *
 * const { fetch, websocket } = createBunHandler(router);
 * ```
 */
export { WebSocketRouter } from "./router.js";
