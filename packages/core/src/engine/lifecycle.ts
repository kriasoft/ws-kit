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
) => void;

/**
 * Managed error sink with activity tracking.
 * - Tracks error handlers for the onError hook
 * - Tracks last activity timestamp per connection for heartbeat monitoring
 */
export class LifecycleManager<TConn> {
  private errorHandlers: ErrorHandler<TConn>[] = [];
  private activityMap = new WeakMap<ServerWebSocket, number>();

  onError(handler: ErrorHandler<TConn>): void {
    this.errorHandlers.push(handler);
  }

  async handleError(
    err: unknown,
    ctx: MinimalContext<TConn> | null,
  ): Promise<void> {
    for (const handler of this.errorHandlers) {
      try {
        handler(err, ctx);
      } catch (e) {
        // Prevent one handler from preventing others
        console.error("Error in onError handler:", e);
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
