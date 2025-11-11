/**
 * @ws-kit/core — Tiny, type-safe WebSocket router
 *
 * Public API surface (capability-gated):
 * - createRouter() → Factory with only heartbeat/limits options
 * - Router → BaseRouter (use/on/route/merge/mount/plugin/onError)
 * - MessageDescriptor → Stable runtime shape for all validators
 * - MinimalContext → Base context (ws, type, data, setData)
 *
 * Plugins add:
 * - withZod/withValibot → ValidationAPI (rpc method, payload/reply context)
 * - withPubSub → PubSubAPI (publish, subscribe context)
 * - withTelemetry → Observer hooks (onMessage, onError, onPublish)
 * - withHeartbeat/withLimits → Transparent behavior (no API surface)
 */

// Router factory and types
export { createRouter } from "./core/createRouter";
export type { Router, BaseRouter, RouteBuilder } from "./core/router";
export type { CreateRouterOptions } from "./core/types";

// Schema runtime shape
export type { MessageDescriptor } from "./protocol/message-descriptor";
export {
  isMessageDescriptor,
  isEventDescriptor,
  isRpcDescriptor,
} from "./schema/guards";

// Minimal context (always present)
export type { MinimalContext, BaseContextData } from "./context/base-context";

// Middleware types
export type { Middleware, EventHandler } from "./core/types";

// Plugin system
export type { Plugin, MergeCaps } from "./plugin/types";

// Error handling
export { WsKitError } from "./error/error";
export type { ErrorCode, WsKitErrorData } from "./error/codes";

// Capability contracts (core only; validators add validation, adapters add transport)
export type {
  ValidatorAdapter,
  ValidationContext,
} from "./capabilities/validation/contracts";
export type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "./capabilities/pubsub/adapter";
export type {
  Observer,
  TelemetryHooks,
} from "./capabilities/telemetry/contracts";

// Platform adapter contract
export type { PlatformAdapter, ServerWebSocket } from "./ws/platform-adapter";

// Useful type utilities
export type { EventContext, RpcContext } from "./context/types";

// Pub/Sub utilities
export {
  createThrottledPublish,
  createAdvancedThrottledPublish,
} from "./utils/throttle";
export type { ThrottledBroadcastConfig } from "./utils/throttle";

// Test harness (opt-in)
export * as test from "./test";
