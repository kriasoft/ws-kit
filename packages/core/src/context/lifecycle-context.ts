// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Lifecycle context types for router.onOpen() and router.onClose() handlers.
 *
 * These contexts are capability-gated based on installed plugins:
 * - Base context always available (clientId, data, ws, assignData)
 * - send() available when validation plugin installed (onOpen only)
 * - publish(), topics available when pubsub plugin installed
 *
 * Note: onClose context has read-only topics (list, has) since the connection
 * is terminating and subscription changes are meaningless.
 */

import type { PublishOptions, PublishResult } from "../core/types.js";
import type { MessageDescriptor } from "../protocol/message-descriptor.js";
import type { SYSTEM_LIFECYCLE } from "../schema/reserved.js";
import type { ServerWebSocket } from "../ws/platform-adapter.js";
import type { ConnectionData } from "./base-context.js";

/**
 * WebSocket interface for close handlers.
 * Omits send() since the socket is CLOSING or CLOSED.
 */
export type ClosingWebSocket = Omit<ServerWebSocket, "send">;

/**
 * Base context for onOpen handlers (always present).
 */
export interface BaseOpenContext<
  TContext extends ConnectionData = ConnectionData,
> {
  /** Stable client identifier (assigned at accept-time, unique per connection). */
  readonly clientId: string;

  /** Per-connection data (populated by authenticate()). */
  readonly data: TContext;

  /** Connection timestamp (ms since epoch). */
  readonly connectedAt: number;

  /** Underlying WebSocket (escape hatch for raw socket access). */
  readonly ws: ServerWebSocket;

  /** Update connection data (partial merge). */
  assignData(partial: Partial<TContext>): void;
}

/**
 * Base context for onClose handlers (always present).
 */
export interface BaseCloseContext<
  TContext extends ConnectionData = ConnectionData,
> {
  /** Stable client identifier. */
  readonly clientId: string;

  /** Per-connection data. */
  readonly data: TContext;

  /** WebSocket close code (e.g., 1000 for normal close). */
  readonly code?: number;

  /** Close reason string. */
  readonly reason?: string;

  /** Underlying WebSocket (socket is CLOSING or CLOSED, send() unavailable). */
  readonly ws: ClosingWebSocket;
}

/**
 * Send capability for lifecycle contexts (added by validation plugins).
 */
export interface LifecycleSendCapability {
  /**
   * Send a message to the client.
   * Only available in onOpen (socket is open and ready).
   */
  send(schema: MessageDescriptor, payload: unknown): void;
}

/**
 * Publish capability for lifecycle contexts (added by pubsub plugin).
 */
export interface LifecyclePublishCapability {
  /**
   * Publish message to a topic (broadcast to all subscribers).
   */
  publish(
    topic: string,
    schema: MessageDescriptor,
    payload: unknown,
    opts?: PublishOptions,
  ): Promise<PublishResult>;
}

/**
 * Full topics API for onOpen (subscribe/unsubscribe allowed).
 */
export interface LifecycleTopicsFullCapability {
  readonly topics: {
    /** Subscribe to a topic. */
    subscribe(topic: string): Promise<void>;
    /** Unsubscribe from a topic. */
    unsubscribe(topic: string): Promise<void>;
    /** List all subscribed topics. */
    list(): readonly string[];
    /** Check if subscribed to a topic. */
    has(topic: string): boolean;
  };
}

/**
 * Read-only topics API for onClose (no subscribe/unsubscribe).
 */
export interface LifecycleTopicsReadOnlyCapability {
  readonly topics: {
    /** List all subscribed topics (for debugging/metrics). */
    list(): readonly string[];
    /** Check if subscribed to a topic. */
    has(topic: string): boolean;
  };
}

/**
 * Error context for lifecycle errors (passed to router.onError).
 */
export interface LifecycleErrorContext<
  TContext extends ConnectionData = ConnectionData,
> {
  /** Event type ($ws:open or $ws:close). */
  readonly type: typeof SYSTEM_LIFECYCLE.OPEN | typeof SYSTEM_LIFECYCLE.CLOSE;
  /** Client identifier. */
  readonly clientId: string;
  /** Connection data. */
  readonly data: TContext;
}

/**
 * Capability detection helper.
 * Checks for capability markers in extensions object.
 */
type HasCapability<T, K extends string> = T extends { __caps: infer C }
  ? C extends Record<K, true>
    ? true
    : false
  : T extends Record<K, true>
    ? true
    : false;

/**
 * Full OpenContext type with capability-gated methods.
 *
 * - Always has: clientId, data, connectedAt, ws, assignData
 * - If validation plugin: adds send()
 * - If pubsub plugin: adds publish(), topics (full API)
 */
export type OpenContext<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> = BaseOpenContext<TContext> &
  (HasCapability<TExtensions, "validation"> extends true
    ? LifecycleSendCapability
    : {}) &
  (HasCapability<TExtensions, "pubsub"> extends true
    ? LifecyclePublishCapability & LifecycleTopicsFullCapability
    : {});

/**
 * Full CloseContext type with capability-gated methods.
 *
 * - Always has: clientId, data, code, reason, ws
 * - No send() (socket is closing/closed)
 * - If pubsub plugin: adds publish(), topics (read-only)
 */
export type CloseContext<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> = BaseCloseContext<TContext> &
  (HasCapability<TExtensions, "pubsub"> extends true
    ? LifecyclePublishCapability & LifecycleTopicsReadOnlyCapability
    : {});

/**
 * Handler type for router.onOpen().
 */
export type OpenHandler<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> = (ctx: OpenContext<TContext, TExtensions>) => void | Promise<void>;

/**
 * Handler type for router.onClose().
 */
export type CloseHandler<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> = (ctx: CloseContext<TContext, TExtensions>) => void | Promise<void>;
