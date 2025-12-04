// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/core — Tiny, type-safe WebSocket router
 *
 * Public API surface (capability-gated):
 * - createRouter() → Factory with only heartbeat/limits options
 * - Router → RouterCore (use/on/route/merge/mount/plugin/onError)
 * - MessageDescriptor → Stable runtime shape for all validators
 * - MinimalContext → Base context (clientId, ws, type, data, assignData)
 *
 * Plugins add:
 * - withZod/withValibot → ValidationAPI (rpc method, payload/reply context)
 * - withPubSub → PubSubAPI (publish, subscribe context)
 * - withTelemetry → Observer hooks (onMessage, onError, onPublish)
 * - withHeartbeat/withLimits → Transparent behavior (no API surface)
 */

// Router factory and types
export { createRouter } from "./core/createRouter.js";
export { getRouteIndex } from "./core/router.js";
export type {
  ReadonlyRouteIndex,
  RouteBuilder,
  Router,
  RouterCore,
  RouterWithExtensions,
} from "./core/router.js";
export type { CreateRouterOptions } from "./core/types.js";

// Router observer API (testing and monitoring)
export type { PublishRecord, RouterObserver } from "./core/types.js";

// Schema runtime shape
export type { MessageDescriptor } from "./protocol/message-descriptor.js";
export {
  isEventDescriptor,
  isMessageDescriptor,
  isRpcDescriptor,
} from "./schema/guards.js";

// Minimal context (always present)
export {
  getContextExtension,
  isMinimalContext,
} from "./context/base-context.js";
export type {
  ConnectionData,
  MinimalContext,
  WebSocketData,
} from "./context/base-context.js";

// Middleware types
export type { EventHandler, Middleware } from "./core/types.js";

// Plugin system
export type { Plugin } from "./plugin/types.js";

// Error handling (canonical: new unified implementation in ./error.ts)
export {
  CloseError,
  ERROR_CODE_META,
  isStandardErrorCode,
  WsKitError,
} from "./error.js";
export type {
  ErrorCode,
  ErrorCodeMetadata,
  ErrorMessage,
  ErrorPayload,
  ExtErrorCode,
} from "./error.js";

// Capability contracts (core only; validators add validation, adapters add transport)
export type {
  PublishEnvelope,
  PubSubAdapter,
} from "./capabilities/pubsub/adapter.js";
// Router-level Pub/Sub API (user-facing)
export type {
  Observer,
  TelemetryHooks,
} from "./capabilities/telemetry/contracts.js";
export type {
  ValidationContext,
  ValidatorAdapter,
} from "./capabilities/validation/contracts.js";
export type {
  PublishCapability,
  PublishError,
  PublishOptions,
  PublishResult,
} from "./core/router.js";
export { isPublishError } from "./core/types.js";

// Schema branding/inference (used by validator adapters)
export type {
  AnySchema,
  BrandedSchema,
  InferMessage,
  InferMeta,
  InferPayload,
  InferResponse,
  InferType,
  MessageSchema,
  RpcSchema,
} from "./protocol/schema.js";

// Platform adapter contract
export type {
  AdapterWebSocket,
  PlatformAdapter,
  ServerWebSocket,
} from "./ws/platform-adapter.js";

// Useful type utilities (capability-gated context types)
export type {
  EventContext,
  ProgressOptions,
  PubSubContext,
  ReplyOptions,
  RpcContext,
  SendOptions,
} from "./context/types.js";

// Lifecycle context types (for router.onOpen/onClose handlers)
export type {
  BaseCloseContext,
  BaseOpenContext,
  CloseContext,
  CloseHandler,
  LifecycleErrorContext,
  OpenContext,
  OpenHandler,
} from "./context/lifecycle-context.js";

// Reserved/system types
export { SYSTEM_LIFECYCLE } from "./schema/reserved.js";

// Pub/Sub utilities
export {
  createAdvancedThrottledPublish,
  createThrottledPublish,
} from "./utils/throttle.js";
export type { ThrottledBroadcastConfig } from "./utils/throttle.js";

// Test harness (opt-in)
export * as test from "./testing/index.js";

// Normalization utility (for testing validator integration)
export { normalizeInboundMessage } from "./internal/normalize.js";
