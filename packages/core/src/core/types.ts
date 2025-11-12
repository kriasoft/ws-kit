// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core type definitions for router, middleware, and handlers.
 * These types exist at the base level (no validation plugin dependency).
 */

import type { MinimalContext } from "../context/base-context";
import type { MessageDescriptor } from "../protocol/message-descriptor";

/**
 * Middleware is the same for global and per-route:
 * - Global: registered via router.use()
 * - Per-route: registered via router.route(schema).use()
 *
 * All middleware runs in order (global first, then per-route), before handler.
 *
 * TContext — the per-connection data available on ctx.data.
 */
export type Middleware<TContext = unknown> = (
  ctx: MinimalContext<TContext>,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * Event handler: fires when message arrives (fire-and-forget semantics).
 * Available after validation plugin adds payload inference.
 * Can use ctx.send() to broadcast to other clients (requires validation plugin).
 *
 * TContext — the per-connection data available on ctx.data.
 */
export type EventHandler<TContext = unknown> = (
  ctx: any, // MinimalContext<TContext> + payload (from validation)
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
export interface RouteEntry<TContext> {
  schema: MessageDescriptor;
  middlewares: Middleware<TContext>[];
  handler: EventHandler<TContext>;
}
