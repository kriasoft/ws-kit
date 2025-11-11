/**
 * Lifecycle hooks: onError sink + activity tracking.
 * All errors (validation, middleware, handler, pubsub) flow here.
 * Telemetry plugin subscribes internally to observe patterns.
 * Activity tracking enables heartbeat and connection monitoring.
 */

import type { MinimalContext } from "../context/base-context";
import type { ServerWebSocket } from "../ws/platform-adapter";

export type ErrorHandler<TConn> = (
  err: unknown,
  ctx: MinimalContext<TConn> | null,
) => void | Promise<void>;

export type OpenHandler<TConn> = (ws: ServerWebSocket) => void | Promise<void>;

export type CloseHandler<TConn> = (
  ws: ServerWebSocket,
  code?: number,
  reason?: string,
) => void | Promise<void>;

/**
 * Managed lifecycle sink with error handling and open/close notifications.
 * - Tracks error handlers for the onError hook
 * - Tracks open handlers for per-connection setup
 * - Tracks close handlers for per-connection cleanup
 * - Tracks last activity timestamp per connection for heartbeat monitoring
 */
export class LifecycleManager<TConn> {
  private errorHandlers: ErrorHandler<TConn>[] = [];
  private openHandlers: OpenHandler<TConn>[] = [];
  private closeHandlers: CloseHandler<TConn>[] = [];
  private activityMap = new WeakMap<ServerWebSocket, number>();

  onError(handler: ErrorHandler<TConn>): void {
    this.errorHandlers.push(handler);
  }

  onOpen(handler: OpenHandler<TConn>): void {
    this.openHandlers.push(handler);
  }

  onClose(handler: CloseHandler<TConn>): void {
    this.closeHandlers.push(handler);
  }

  async handleError(
    err: unknown,
    ctx: MinimalContext<TConn> | null,
  ): Promise<void> {
    for (const handler of this.errorHandlers) {
      try {
        await Promise.resolve(handler(err, ctx));
      } catch (e) {
        // Prevent one handler from preventing others
        console.error("Error in onError handler:", e);
      }
    }
  }

  async handleOpen(ws: ServerWebSocket): Promise<void> {
    // Notify all open handlers, ensuring error isolation
    for (const handler of this.openHandlers) {
      try {
        await Promise.resolve(handler(ws));
      } catch (e) {
        // Prevent one handler from preventing others
        console.error("Error in onOpen handler:", e);
      }
    }
  }

  async handleClose(
    ws: ServerWebSocket,
    code?: number,
    reason?: string,
  ): Promise<void> {
    // Clean up activity map for consistency
    this.activityMap.delete(ws);

    // Notify all close handlers, ensuring error isolation
    for (const handler of this.closeHandlers) {
      try {
        await Promise.resolve(handler(ws, code, reason));
      } catch (e) {
        // Prevent one handler from preventing others
        console.error("Error in onClose handler:", e);
      }
    }
  }

  /**
   * Mark activity on a connection (update timestamp for heartbeat).
   * Called after each successful message or heartbeat ACK.
   */
  markActivity(ws: ServerWebSocket, now: number): void {
    this.activityMap.set(ws, now);
  }

  /**
   * Get last activity timestamp for a connection.
   * Returns 0 if no activity recorded yet.
   */
  lastActivity(ws: ServerWebSocket): number {
    return this.activityMap.get(ws) ?? 0;
  }
}
