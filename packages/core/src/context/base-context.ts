/**
 * Base context: always available (no plugin dependency).
 * Minimal surface: ws, type, data, setData.
 *
 * ValidationAPI adds: payload (inferred from schema)
 * Event handlers add: send(schema, payload)
 * RPC handlers add: reply(payload), progress(payload)
 */

import type { ServerWebSocket } from "../ws/platform-adapter";

export type BaseContextData = Record<string, unknown>;

export interface MinimalContext<TConn extends BaseContextData = unknown> {
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
    "ws" in ctx &&
    "type" in ctx &&
    "data" in ctx &&
    typeof (ctx as any).setData === "function"
  );
}
