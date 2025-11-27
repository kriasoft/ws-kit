// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @internal
 * Plugin API and internal infrastructure.
 *
 * This module provides the stable plugin API contract for accessing router capabilities
 * without exposing implementation classes. Plugins should import from this path.
 *
 * Usage:
 * ```ts
 * import { getRouterPluginAPI } from "@ws-kit/core/internal";
 * import { DESCRIPTOR, SCHEMA_OPTS, type SchemaOpts } from "@ws-kit/core/internal";
 *
 * const api = getRouterPluginAPI(router);
 * const routes = api.getRouteRegistry();
 * api.addContextEnhancer((ctx) => { ... });
 * ```
 *
 * Never import from `core/router.ts` directly for plugin access.
 */

import type { ConnectionData, MinimalContext } from "./context/base-context";
import type { Router } from "./core/router";
import { ROUTER_IMPL } from "./core/symbols";

export type { RouterImpl } from "./core/router";
export { ROUTER_IMPL } from "./core/symbols";

// Schema metadata infrastructure (shared by all validator adapters)
export {
  DESCRIPTOR,
  SCHEMA_OPTS,
  setSchemaOpts,
  getSchemaOpts,
  cloneWithOpts,
  getDescriptor,
  getKind,
  typeOf,
} from "./schema/metadata.js";
export type { SchemaOpts, DescriptorValue } from "./schema/metadata.js";

/**
 * Function signature for context enhancers.
 *
 * Enhancers are pure functions that mutate context post-creation.
 * They run in registration order (with optional priority).
 * Enhancers should not throw; if they do, the error is routed to lifecycle.handleError.
 *
 * @typeParam TContext - The per-connection data type
 *
 * @example
 * ```ts
 * internals.addContextEnhancer((ctx) => {
 *   ctx.extensions.set('zod', {
 *     reply: async (payload) => { ... },
 *     send: async (schema, payload) => { ... },
 *   });
 * });
 * ```
 */
export type ContextEnhancer<TContext extends ConnectionData = ConnectionData> =
  (ctx: MinimalContext<TContext>) => void | Promise<void>;

/**
 * Internal state stored on `ctx.__wskit`.
 *
 * This is the contract between Core and Plugins:
 * - Core error handling reads/writes `rpc.replied` for one-shot semantics
 * - RPC plugin reads/writes `rpc.replied` and `rpc.correlationId`
 * - Plugins may add other fields under different keys
 *
 * @internal
 */
export interface WsKitInternalState {
  /**
   * RPC-specific state (set by RPC plugin when handling RPC messages).
   */
  rpc?: {
    /**
     * Flag indicating a terminal response has been sent (via reply/progress/error).
     * Shared by all three methods to ensure one-shot semantics.
     */
    replied: boolean;

    /**
     * Request correlation ID (for matching responses to requests).
     * Set from inbound message meta.correlationId if present.
     */
    correlationId?: string | undefined;
  };

  /**
   * Function that returns current message metadata to be included in outbound messages.
   * Called by send/reply/error methods to preserve server-side meta fields.
   */
  meta?: () => Record<string, unknown>;
}

/**
 * Stable, typed plugin API contract.
 *
 * This interface defines what plugins can safely depend on.
 * It decouples plugins from the full RouterImpl class shape,
 * providing a clean, versioned contract for plugin development.
 *
 * @typeParam TContext - The per-connection data type
 */
export interface RouterPluginAPI<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Get a read-only view of registered message types and schemas.
   *
   * Routes are populated immediately when `router.on()` or `router.rpc()` is called.
   * For lazy-loaded routes, call `router.finalizeRoutes()` before accepting connections.
   *
   * @returns Map of message type → schema info
   */
  getRouteRegistry(): ReadonlyMap<string, { schema?: unknown; kind?: string }>;

  /**
   * Register a context enhancer.
   *
   * Enhancers are pure functions that extend or mutate the context.
   * They run in priority order (lower first), then registration order.
   *
   * All enhancers run for every message. To avoid collisions, use `ctx.extensions`
   * to namespace plugin-specific data:
   *
   * ```ts
   * internals.addContextEnhancer((ctx) => {
   *   ctx.extensions.set('myPlugin', { ... });
   * });
   * ```
   *
   * If an enhancer throws, the error is routed to `lifecycle.handleError()`,
   * and the message is dropped (router remains operational).
   *
   * @param enhancer - Pure function that enhances context
   * @param opts.priority - Lower runs first (default 0). Use negative for "must be first"
   *
   * @example
   * ```ts
   * // Validation runs first
   * internals.addContextEnhancer(validateFn, { priority: -100 });
   *
   * // Domain logic runs second
   * internals.addContextEnhancer(enrichFn, { priority: 0 });
   *
   * // Logging runs last
   * internals.addContextEnhancer(logFn, { priority: 100 });
   * ```
   */
  addContextEnhancer(
    enhancer: ContextEnhancer<TContext>,
    opts?: { priority?: number },
  ): void;

  /**
   * Access lifecycle for error handling, hooks, etc.
   *
   * This is an advanced interface. Document use cases sparingly.
   *
   * @returns Object with lifecycle methods
   */
  getLifecycle(): {
    handleError(
      err: unknown,
      ctx: MinimalContext<TContext> | null,
    ): Promise<void>;
  };
}

/**
 * Get the plugin API for a router.
 *
 * This is the primary way plugins should access router capabilities.
 * It provides a stable, typed contract instead of directly accessing symbols.
 *
 * @typeParam TContext - The per-connection data type
 * @param router - The router instance
 * @returns Router plugin API object
 * @throws If plugin API is not available (version mismatch or bundler issue)
 *
 * @example
 * ```ts
 * import { getRouterPluginAPI } from '@ws-kit/core/internal';
 *
 * const api = getRouterPluginAPI(router);
 * const routes = api.getRouteRegistry();
 * api.addContextEnhancer((ctx) => {
 *   // Enhance context...
 * });
 * ```
 */
export function getRouterPluginAPI<
  TContext extends ConnectionData = ConnectionData,
>(router: Router<TContext, any>): RouterPluginAPI<TContext> {
  const impl = (router as any)[ROUTER_IMPL];

  if (!impl) {
    throw new Error(
      "[ws-kit] Router plugin API not available. " +
        "This may indicate a version mismatch or bundler issue. " +
        "Please ensure @ws-kit/core is correctly installed and deduplicated.",
    );
  }

  // Return a wrapper object that implements RouterPluginAPI interface,
  // delegating to the actual RouterImpl methods
  return {
    getRouteRegistry: () =>
      (impl as any).getRouteRegistryForInternals?.() ?? new Map(),
    addContextEnhancer: (enhancer, opts) =>
      (impl as any).addContextEnhancer?.(enhancer, opts),
    getLifecycle: () => {
      const lifecycle = (impl as any).getInternalLifecycle?.();
      return {
        handleError: (err, ctx) =>
          lifecycle?.handleError?.(err, ctx) ?? Promise.resolve(),
      };
    },
  } as RouterPluginAPI<TContext>;
}
