// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client data constraint: always available (no plugin dependency).
 * Minimal surface: clientId, ws, type, data, setData.
 *
 * clientId is a stable identifier assigned at connection accept time.
 * Used for pub/sub membership tracking, middleware policy, and logging.
 *
 * ValidationAPI adds: payload (inferred from schema)
 * Event handlers add: send(schema, payload)
 * RPC handlers add: reply(payload), progress(payload)
 */

import type { ServerWebSocket } from "../ws/platform-adapter";

/**
 * Per-connection data structure.
 *
 * Augment this interface via declaration merging to add typed connection fields:
 * ```ts
 * declare module "@ws-kit/core" {
 *   interface ConnectionData {
 *     userId?: string;
 *     email?: string;
 *     roles?: string[];
 *   }
 * }
 * ```
 *
 * Users can also override generics for feature-specific data:
 * ```ts
 * type ChatData = ConnectionData & { roomId?: string };
 * const router = createRouter<ChatData>();
 * ```
 */
export interface ConnectionData {
  [key: string]: unknown;
}

/**
 * Utility type for defining custom per-connection data.
 *
 * Merges custom properties with the base `ConnectionData` structure.
 * Use when defining custom data for specific routers or features.
 *
 * @example
 * ```ts
 * // For a feature module with custom data
 * type ChatData = WebSocketData<{ roomId?: string }>;
 * const chatRouter = createRouter<ChatData>();
 * ```
 *
 * Equivalent to:
 * ```ts
 * type ChatData = ConnectionData & { roomId?: string };
 * ```
 */
export type WebSocketData<
  T extends Record<string, unknown> = Record<string, unknown>,
> = ConnectionData & T;

export interface MinimalContext<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Stable client identifier (assigned at accept-time, unique per connection).
   * Used for pub/sub membership, middleware authorization, and logging.
   */
  readonly clientId: string;

  /**
   * Underlying WebSocket (platform-agnostic wrapper).
   */
  readonly ws: ServerWebSocket;

  /**
   * Message type (literal from schema.type).
   */
  readonly type: string;

  /**
   * Per-connection data (passed to createRouter<TContext>).
   * TContext represents the data structure available on ctx.data.
   * Keep separate from clientId (app state vs. router identity).
   */
  readonly data: TContext;

  /**
   * Update connection data (partial merge).
   */
  setData(partial: Partial<TContext>): void;
}

/**
 * Assertion helper: is context a valid MinimalContext?
 */
export function isMinimalContext(ctx: unknown): ctx is MinimalContext {
  return (
    ctx !== null &&
    typeof ctx === "object" &&
    typeof (ctx as any).clientId === "string" &&
    "ws" in ctx &&
    "type" in ctx &&
    "data" in ctx &&
    typeof (ctx as any).setData === "function"
  );
}
