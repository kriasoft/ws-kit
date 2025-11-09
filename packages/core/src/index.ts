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
 * - Router implementation — separate packages provide full implementations
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
  AuthFailurePolicy,
  AuthHandler,
  CloseHandler,
  CloseHandlerContext,
  ErrorHandler,
  EventHandler,
  EventMessageContext,
  HeartbeatConfig,
  IngressContext,
  IWebSocketRouter,
  LimitExceededHandler,
  LimitExceededInfo,
  LimitsConfig,
  LimitType,
  MessageContext,
  MessageContextMethods,
  MessageHandler,
  MessageHandlerEntry,
  MessageMeta,
  MessageSchemaType,
  Middleware,
  OpenHandler,
  OpenHandlerContext,
  PlatformAdapter,
  Policy,
  PublishCapability,
  PublishError,
  PublishOptions,
  PublishResult,
  PubSub,
  PubSubPublishOptions,
  RateLimitDecision,
  RateLimiter,
  RouterHooks,
  RpcHandler,
  RpcMessageContext,
  SendFunction,
  ServerWebSocket,
  Topics,
  ValidatorAdapter,
  WebSocketData,
  WebSocketRouterOptions,
} from "./types.js";

// ============================================================================
// Error Handling
// ============================================================================

export {
  ERROR_CODE_META,
  ErrorCode,
  isStandardErrorCode,
  WebSocketError,
  WsKitError,
} from "./error.js";
export type {
  ErrorCodeMetadata,
  ErrorCodeValue,
  ErrorMessage,
  ErrorPayload,
  ExtErrorCode,
} from "./error.js";
export type { ErrorWire, RpcErrorWire } from "./types.js";

/**
 * Pub/Sub error handling.
 *
 * Provides error types for subscription and publication operations.
 * Topic subscription mutations (subscribe, unsubscribe) throw PubSubError on failure.
 * Message publication (publish) returns PublishResult with error code and retryability hint.
 *
 * See docs/specs/pubsub.md#errors for error semantics.
 */
export { PubSubError } from "./pubsub-error.js";
export type { PubSubErrorCode } from "./pubsub-error.js";

/**
 * Default Topics implementation.
 *
 * Provides per-connection topic subscriptions with idempotent operations
 * and atomic batch semantics.
 *
 * @internal Used by router to implement ctx.topics. Applications should use
 * the ctx.topics interface, not this class directly.
 */
export { TopicsImpl, createTopicValidator } from "./topics-impl.js";
export type { TopicValidator } from "./topics-impl.js";

// ============================================================================
// Constants & Defaults
// ============================================================================

export { DEFAULT_CONFIG, RESERVED_META_KEYS } from "./constants.js";
export type { ReservedMetaKey } from "./constants.js";
export { PUBLISH_ERROR_RETRYABLE } from "./types.js";

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
export { MemoryPubSub } from "./pubsub.js";

// ============================================================================
// Message Normalization & Validation
// ============================================================================

export { normalizeInboundMessage, validateMetaSchema } from "./normalize.js";

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
  createAdvancedThrottledPublish,
  createThrottledPublish,
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

/**
 * RPC utilities for idempotency key generation and payload canonicalization.
 *
 * @example
 * ```typescript
 * import { stableStringify, idempotencyKey } from "@ws-kit/core";
 * import crypto from "node:crypto";
 *
 * const payload = { user: "alice", action: "purchase" };
 * const hash = crypto
 *   .createHash("sha256")
 *   .update(stableStringify(payload))
 *   .digest("hex");
 * const key = idempotencyKey({
 *   tenant: "acme",
 *   user: "alice",
 *   type: "PURCHASE_ORDER",
 *   hash,
 * });
 * ```
 */
export { idempotencyKey, stableStringify } from "./utils.js";
export type { IdempotencyKeyOpts } from "./utils.js";

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
 * import { createRouter, z, message } from "@ws-kit/zod";
 * import { createBunHandler } from "@ws-kit/bun";
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
