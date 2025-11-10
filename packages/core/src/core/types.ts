/**
 * Core type definitions for router, middleware, and handlers.
 * These types exist at the base level (no validation plugin dependency).
 */

import type { MessageDescriptor } from "../../protocol/message-descriptor";
import type { MinimalContext } from "../context/base-context";

/**
 * Middleware is the same for global and per-route:
 * - Global: registered via router.use()
 * - Per-route: registered via router.route(schema).use()
 *
 * All middleware runs in order (global first, then per-route), before handler.
 *
 * TConn — the per-connection data available on ctx.data.
 */
export type Middleware<TConn = unknown> = (
  ctx: MinimalContext<TConn>,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * Event handler: fires when message arrives (fire-and-forget semantics).
 * Available after validation plugin adds payload inference.
 * Can use ctx.send() to broadcast to other clients (requires validation plugin).
 *
 * TConn — the per-connection data available on ctx.data.
 */
export type EventHandler<TConn = unknown> = (
  ctx: any, // MinimalContext<TConn> + payload (from validation)
) => Promise<void> | void;

/**
 * Options for createRouter. Only heartbeat/limits here; validators/pubsub are plugins.
 */
export interface CreateRouterOptions {
  heartbeat?: {
    intervalMs?: number;
    timeoutMs?: number;
  };
  limits?: {
    maxPending?: number;
    maxPayloadBytes?: number;
  };
}

/**
 * Handler registry entry (internal).
 * Tracks middleware chain + handler for each schema.type.
 */
export interface RouteEntry<TConn> {
  schema: MessageDescriptor;
  middlewares: Middleware<TConn>[];
  handler: EventHandler<TConn>;
}
