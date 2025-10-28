// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket as BunServerWebSocket } from "bun";
import type { ServerWebSocket, WebSocketData } from "@ws-kit/core";

/**
 * Options for WebSocket upgrade in Bun.
 *
 * Passed to the fetch handler to configure how the connection is upgraded.
 */
export interface UpgradeOptions<TData = unknown> {
  /** Bun server instance (required for upgrade) */
  server: import("bun").Server;

  /** Custom application data attached to the connection */
  data?: TData;

  /** HTTP headers to include in the upgrade response */
  headers?: HeadersInit;

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
    server: import("bun").Server,
  ) => Response | Promise<Response>;

  /** WebSocket handler for Bun.serve */
  websocket: import("bun").WebSocketHandler<BunWebSocketData<TData>>;
}
