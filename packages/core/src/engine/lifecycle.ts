// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Lifecycle hooks: onError sink + activity tracking.
 * All errors (validation, middleware, handler, pubsub) flow here.
 * Telemetry plugin subscribes internally to observe patterns.
 * Activity tracking enables heartbeat and connection monitoring.
 *
 * Two types of lifecycle handlers:
 * 1. Internal handlers (plugins): receive raw ws, used for infrastructure setup
 * 2. Router-level handlers (user code): receive full typed context via router.onOpen()/onClose()
 */

import type {
  ConnectionData,
  MinimalContext,
} from "../context/base-context.js";
import type {
  BaseCloseContext,
  BaseOpenContext,
  LifecycleErrorContext,
} from "../context/lifecycle-context.js";
import type { ServerWebSocket } from "../ws/platform-adapter.js";

export type ErrorHandler<TContext extends ConnectionData = ConnectionData> = (
  err: unknown,
  ctx: MinimalContext<TContext> | LifecycleErrorContext<TContext> | null,
) => void | Promise<void>;

/**
 * Internal open handler (for plugins).
 * Receives raw WebSocket for infrastructure setup.
 */
export type InternalOpenHandler = (ws: ServerWebSocket) => void | Promise<void>;

/**
 * Internal close handler (for plugins).
 * Receives raw WebSocket for cleanup.
 */
export type InternalCloseHandler = (
  ws: ServerWebSocket,
  code?: number,
  reason?: string,
) => void | Promise<void>;

/**
 * Router-level open handler (for user code).
 * Receives full typed context with capability-gated methods.
 */
export type RouterOpenHandler<
  TContext extends ConnectionData = ConnectionData,
> = (ctx: BaseOpenContext<TContext>) => void | Promise<void>;

/**
 * Router-level close handler (for user code).
 * Receives full typed context with capability-gated methods.
 */
export type RouterCloseHandler<
  TContext extends ConnectionData = ConnectionData,
> = (ctx: BaseCloseContext<TContext>) => void | Promise<void>;

/**
 * Managed lifecycle sink with error handling and open/close notifications.
 * - Tracks error handlers for the onError hook
 * - Tracks internal open/close handlers for plugin infrastructure
 * - Tracks router-level open/close handlers for user code (with full context)
 * - Tracks last activity timestamp per connection for heartbeat monitoring
 */
export class LifecycleManager<
  TContext extends ConnectionData = ConnectionData,
> {
  private errorHandlers: ErrorHandler<TContext>[] = [];

  // Internal handlers (plugins) - receive raw ws
  private internalOpenHandlers: InternalOpenHandler[] = [];
  private internalCloseHandlers: InternalCloseHandler[] = [];

  // Router-level handlers (user code) - receive full context
  private routerOpenHandlers: RouterOpenHandler<TContext>[] = [];
  private routerCloseHandlers: RouterCloseHandler<TContext>[] = [];

  private activityMap = new WeakMap<ServerWebSocket, number>();

  onError(handler: ErrorHandler<TContext>): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Register an internal open handler (for plugins).
   * These receive raw ws and run before router-level handlers.
   */
  onInternalOpen(handler: InternalOpenHandler): void {
    this.internalOpenHandlers.push(handler);
  }

  /**
   * Register an internal close handler (for plugins).
   * These receive raw ws and run before router-level handlers.
   */
  onInternalClose(handler: InternalCloseHandler): void {
    this.internalCloseHandlers.push(handler);
  }

  /**
   * Register a router-level open handler (for user code).
   * These receive full typed context and run after internal handlers.
   */
  onRouterOpen(handler: RouterOpenHandler<TContext>): void {
    this.routerOpenHandlers.push(handler);
  }

  /**
   * Register a router-level close handler (for user code).
   * These receive full typed context and run after internal handlers.
   */
  onRouterClose(handler: RouterCloseHandler<TContext>): void {
    this.routerCloseHandlers.push(handler);
  }

  /**
   * Get router-level open handlers (used by RouterImpl to run with context).
   */
  getRouterOpenHandlers(): readonly RouterOpenHandler<TContext>[] {
    return this.routerOpenHandlers;
  }

  /**
   * Get router-level close handlers (used by RouterImpl to run with context).
   */
  getRouterCloseHandlers(): readonly RouterCloseHandler<TContext>[] {
    return this.routerCloseHandlers;
  }

  async handleError(
    err: unknown,
    ctx: MinimalContext<TContext> | LifecycleErrorContext<TContext> | null,
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

  /**
   * Handle internal open (plugins only).
   * Router-level handlers are run separately by RouterImpl with full context.
   */
  async handleInternalOpen(ws: ServerWebSocket): Promise<void> {
    for (const handler of this.internalOpenHandlers) {
      try {
        await Promise.resolve(handler(ws));
      } catch (e) {
        console.error("Error in internal onOpen handler:", e);
      }
    }
  }

  /**
   * Handle internal close (plugins only).
   * Router-level handlers are run separately by RouterImpl with full context.
   */
  async handleInternalClose(
    ws: ServerWebSocket,
    code?: number,
    reason?: string,
  ): Promise<void> {
    // Clean up activity map for consistency
    this.activityMap.delete(ws);

    for (const handler of this.internalCloseHandlers) {
      try {
        await Promise.resolve(handler(ws, code, reason));
      } catch (e) {
        console.error("Error in internal onClose handler:", e);
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
