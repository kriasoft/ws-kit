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
export { createRouter } from "./core/createRouter";
export { getRouteIndex } from "./core/router";
export type {
  ReadonlyRouteIndex,
  RouteBuilder,
  Router,
  RouterCore,
} from "./core/router";
export type { CreateRouterOptions } from "./core/types";

// Router observer API (testing and monitoring)
export type { PublishRecord, RouterObserver } from "./core/types";

// Schema runtime shape
export type { MessageDescriptor } from "./protocol/message-descriptor";
export {
  isEventDescriptor,
  isMessageDescriptor,
  isRpcDescriptor,
} from "./schema/guards";

// Minimal context (always present)
export { getContextExtension, isMinimalContext } from "./context/base-context";
export type {
  ConnectionData,
  MinimalContext,
  WebSocketData,
} from "./context/base-context";

// Middleware types
export type { EventHandler, Middleware } from "./core/types";

// Plugin system
export type { Plugin } from "./plugin/types";

// Error handling
export type { ErrorCode, WsKitErrorData } from "./error/codes";
export { WsKitError } from "./error/error";

// Capability contracts (core only; validators add validation, adapters add transport)
export type {
  PublishEnvelope,
  PubSubAdapter,
} from "./capabilities/pubsub/adapter";
// Router-level Pub/Sub API (user-facing)
export type {
  Observer,
  TelemetryHooks,
} from "./capabilities/telemetry/contracts";
export type {
  ValidationContext,
  ValidatorAdapter,
} from "./capabilities/validation/contracts";
export type {
  PublishCapability,
  PublishError,
  PublishOptions,
  PublishResult,
} from "./core/router";
export { isPublishError } from "./core/types";

// Platform adapter contract
export type {
  AdapterWebSocket,
  PlatformAdapter,
  ServerWebSocket,
} from "./ws/platform-adapter";

// Useful type utilities (capability-gated context types)
export type {
  EventContext,
  ProgressOptions,
  PubSubContext,
  ReplyOptions,
  RpcContext,
  SendOptions,
} from "./context/types";

// Pub/Sub utilities
export {
  createAdvancedThrottledPublish,
  createThrottledPublish,
} from "./utils/throttle";
export type { ThrottledBroadcastConfig } from "./utils/throttle";

// Test harness (opt-in)
export * as test from "./testing";

// Normalization utility (for testing validator integration)
export { normalizeInboundMessage } from "./internal/normalize";
