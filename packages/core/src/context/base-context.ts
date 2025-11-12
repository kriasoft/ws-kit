/**
 * Base context: always available (no plugin dependency).
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

export type BaseContextData = Record<string, unknown>;

export interface MinimalContext<TConn extends BaseContextData = unknown> {
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
   * Per-connection data (passed to createRouter<TConn>).
   * TConn represents the data structure available on ctx.data.
   * Keep separate from clientId (app state vs. router identity).
   */
  readonly data: TConn;

  /**
   * Update connection data (partial merge).
   */
  setData(partial: Partial<TConn>): void;
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
