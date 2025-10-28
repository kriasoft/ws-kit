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
  RouterHooks,
  HeartbeatConfig,
  LimitsConfig,
  WebSocketRouterOptions,
  MessageSchemaType,
  MessageHandlerEntry,
  ValidatorAdapter,
  PlatformAdapter,
  PubSub,
} from "./types";

// ============================================================================
// Error Handling
// ============================================================================

export { ErrorCode, WebSocketError } from "./error";
export type { ErrorCodeValue, ErrorPayload, ErrorMessage } from "./error";

// ============================================================================
// Constants & Defaults
// ============================================================================

export { RESERVED_META_KEYS, DEFAULT_CONFIG } from "./constants";
export type { ReservedMetaKey } from "./constants";

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
export { MemoryPubSub } from "./pubsub";
