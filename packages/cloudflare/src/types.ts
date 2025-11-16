// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { WebSocketData } from "@ws-kit/core";

/**
 * Cloudflare Durable Object WebSocket connection data.
 *
 * Extends core WebSocketData with DO-specific metadata.
 */
export type DurableObjectWebSocketData<
  T extends Record<string, unknown> = Record<string, unknown>,
> = WebSocketData<T> & {
  /** Unique resource identifier (room ID, user ID, etc.) */
  resourceId?: string;

  /** DO instance identifier (assigned by Cloudflare) */
  doId?: string;

  /** Connection timestamp (when upgrade was accepted) */
  connectedAt: number;
};

/**
 * Options for creating a Durable Object WebSocket handler.
 */
export interface DurableObjectHandlerOptions<TData = unknown> {
  /** Custom authentication function called during WebSocket upgrade */
  authenticate?: (
    req: Request,
  ) => Promise<TData | undefined> | TData | undefined;

  /** Custom context passed to handlers */
  context?: unknown;

  /** Whether to use BroadcastChannel for pub/sub (default: true) */
  useBroadcastChannel?: boolean;

  /** Maximum number of concurrent connections (DO quota safety) */
  maxConnections?: number;
}

/**
 * Handler for Durable Object fetch requests (HTTP upgrade + WebSocket events).
 */
export interface DurableObjectHandler {
  /** Fetch handler for HTTP upgrade requests and WebSocket events */
  fetch(req: Request): Response | Promise<Response>;

  /** WebSocket handler compatible with DO's WebSocket API */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  websocket?: any;
}

/**
 * Durable Object WebSocket-specific context extensions.
 *
 * Passed through MessageContext to handlers for DO-specific functionality.
 */
export interface DurableObjectContext {
  /** Storage interface for persistent data in this DO instance */
  storage: DurableObjectStorage;

  /** Resource ID (e.g., room ID, user ID) passed during upgrade */
  resourceId?: string;

  /** DO instance ID (unique per Cloudflare region) */
  doId?: string;

  /** Alarm scheduler for scheduled tasks */
  alarm?: DurableObjectAlarm;
}

/**
 * Minimal DurableObjectStorage interface (subset of full Cloudflare API).
 *
 * Used for simple key-value operations. For full API, import from @cloudflare/workers-types.
 */
export interface DurableObjectStorage {
  get(key: string): Promise<unknown>;

  put(
    key: string,
    value: unknown,
    options?: { expirationTtl?: number },
  ): Promise<void>;

  delete(key: string): Promise<void>;

  list(options?: {
    limit?: number;
    prefix?: string;
  }): Promise<Map<string, unknown>>;

  deleteAll(): Promise<void>;

  transaction<T>(
    callback: (txn: DurableObjectStorage) => Promise<T>,
  ): Promise<T>;

  sync(): Promise<void>;
}

/**
 * Minimal DurableObjectAlarm interface for scheduled tasks.
 */
export interface DurableObjectAlarm {
  set(scheduledTime: Date | number | null): Promise<void>;

  get(): Promise<number | null>;

  delete(): Promise<void>;
}

/**
 * Durable Object binding namespace for federating across instances.
 *
 * Used by `federate()` helper to coordinate cross-DO messaging.
 */
export interface DurableObjectNamespace {
  get(id: string): DurableObjectStub;

  idFromName(name: string): string;

  idFromString(id: string): string;
}

/**
 * Stub for a Durable Object instance (used for RPC/fetch).
 */
export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;

  fetch(request: string, init?: RequestInit): Promise<Response>;
}

/**
 * Environment object available in DO script context.
 *
 * Used to access bindings like DO namespaces and other resources.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DurableObjectEnv
  extends Record<string, DurableObjectNamespace | unknown> {}
