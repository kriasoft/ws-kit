// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket as BunServerWebSocket } from "bun";
import type { WebSocketData } from "@ws-kit/core";

/**
 * Options for WebSocket upgrade in Bun.
 *
 * Passed to the fetch handler to configure how the connection is upgraded.
 */
export interface UpgradeOptions<TData = unknown> {
  /** Bun server instance (required for upgrade) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: import("bun").Server<any>;

  /** Custom application data attached to the connection */
  data?: TData;

  /** HTTP headers to include in the upgrade response */
  headers?: Record<string, string> | Headers;

  /** Authentication function called during upgrade */
  authenticate?: (req: Request) => Promise<TData> | TData;

  /** Context passed to auth/handlers (e.g., database connections, env vars) */
  context?: unknown;
}

/**
 * Options for creating a Bun WebSocket handler.
 */
export interface BunHandlerOptions<TData = unknown> {
  /** Custom authentication function */
  authenticate?: (
    req: Request,
  ) => Promise<TData | undefined> | TData | undefined;

  /** Context passed to handlers */
  context?: unknown;

  /** Custom header for returning client ID in upgrade response */
  clientIdHeader?: string;

  /** Called when an unhandled error occurs in a handler or middleware */
  onError?: (error: Error, ctx?: { type?: string; userId?: string }) => void;

  /** Called when router.publish() is invoked (before actual send) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBroadcast?: (message: any, topic: string) => void;

  /** Called during WebSocket upgrade (before authentication) */
  onUpgrade?: (req: Request) => void;

  /** Called after connection is established and authenticated */
  onOpen?: (ctx: { ws: { data: BunWebSocketData<TData> } }) => void;

  /** Called when connection closes (after cleanup) */
  onClose?: (ctx: { ws: { data: BunWebSocketData<TData> } }) => void;
}

/**
 * Bun-specific WebSocket connection data.
 *
 * Extends core WebSocketData with Bun-specific properties.
 */
export type BunWebSocketData<T = unknown> = WebSocketData<T> & {
  /** Connection timestamp (when upgrade was accepted) */
  connectedAt: number;
};

/**
 * Type alias for Bun's ServerWebSocket for convenience.
 *
 * Maps to the core ServerWebSocket interface for type safety.
 */
export type BunWebSocket<TData = unknown> = BunServerWebSocket<TData>;

/**
 * Return type of createBunHandler factory.
 */
export interface BunHandler<TData = unknown> {
  /** Fetch handler for HTTP upgrade requests */
  fetch: (
    req: Request,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server: import("bun").Server<any>,
  ) => Response | Promise<Response>;

  /** WebSocket handler for Bun.serve */
  websocket: import("bun").WebSocketHandler<BunWebSocketData<TData>>;
}
