// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * definePlugin: type-safe plugin helper.
 *
 * Enforces that the plugin implementation function returns all properties
 * of TPluginApi at compile-time. This replaces manual __caps assignments
 * and provides a cleaner API for plugin authors.
 *
 * See ADR-029 for the plugin architecture design, including:
 * - Context enhancer chains for safe multi-plugin composition
 * - Typed plugin APIs to replace symbol-based internals access
 * - Extension namespace pattern via ctx.extensions
 *
 * @see ADR-029: Context Enhancer Registry & Plugin Safety
 *
 * @example
 * ```typescript
 * export const withValidation = definePlugin<MyContext, ValidationAPI<MyContext>>(
 *   (router) => ({
 *     rpc(schema, handler) {
 *       // Implementation
 *       return router;
 *     },
 *   }),
 * );
 * ```
 */

import type { ConnectionData } from "../context/base-context";
import type { Plugin, Router } from "../core/router";

/**
 * Define a plugin with compile-time API validation.
 *
 * The generic TPluginApi ensures the implementation function returns
 * an object that includes all required properties. TypeScript enforces
 * this at compile-time without needing runtime assertions.
 *
 * Merges plugin extensions into the router using `Object.assign`, which:
 * - Preserves the router's prototype chain and methods
 * - Allows fluent chaining (plugins can return the router from methods)
 * - Performs a shallow merge (first-level properties only)
 *
 * **Development mode warning**: If `NODE_ENV` is not 'production', logs
 * a warning when a plugin overwrites an existing router property. This
 * helps catch namespace collisions early.
 *
 * @param build Function that takes a router and returns plugin API extensions.
 *              For fluent methods, return `router` to ensure proper type widening.
 * @returns A Plugin function that can be chained via .plugin()
 *
 * @typeParam TContext - Per-connection data structure (defaults to ConnectionData)
 * @typeParam TPluginApi - The API interface this plugin provides
 *
 * @example Basic plugin with custom context:
 * ```typescript
 * interface MyContext { userId?: string; roles?: string[] }
 *
 * interface MyPluginAPI {
 *   metrics: { track(event: string): void };
 * }
 *
 * export const withMetrics = definePlugin<MyContext, MyPluginAPI>(
 *   (router) => ({
 *     metrics: {
 *       track(event: string) {
 *         console.log(`[metrics] ${event}`);
 *       },
 *     },
 *   }),
 * );
 *
 * const router = createRouter<MyContext>().plugin(withMetrics);
 * router.metrics.track("connection_open"); // TypeScript infers type
 * ```
 *
 * @example Plugin with fluent chaining:
 * ```typescript
 * interface ValidationAPI {
 *   rpc(schema: any, handler: any): Router<any, any>;
 * }
 *
 * export const withValidation = definePlugin<any, ValidationAPI>(
 *   (router) => ({
 *     rpc(schema, handler) {
 *       // Register handler logic
 *       router.on(schema, handler);
 *       // Always return router for proper type widening
 *       return router;
 *     },
 *   }),
 * );
 *
 * const router = createRouter()
 *   .plugin(withValidation)
 *   .rpc(GetUser, handler); // Chainable
 * ```
 */
export function definePlugin<
  TContext extends ConnectionData = ConnectionData,
  TPluginApi extends object = {},
>(
  build: (router: Router<TContext, any>) => TPluginApi,
): Plugin<TContext, TPluginApi> {
  return <TCurrentExt extends object>(
    router: Router<TContext, TCurrentExt>,
  ) => {
    const extensions = build(router);

    // Dev-mode: warn about property collisions
    // This helps catch namespace conflicts early without production perf cost
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production"
    ) {
      for (const key of Object.keys(extensions)) {
        if (key in router) {
          console.warn(
            `[definePlugin] Plugin overwrites existing router property: "${key}". ` +
              `This may cause unexpected behavior. Consider using a unique namespace.`,
          );
        }
      }
    }

    // Merge extensions into router using Object.assign to preserve prototype chain
    // This ensures all router methods (on, use, plugin, etc.) remain available
    return Object.assign(router, extensions) as Router<
      TContext,
      TCurrentExt & TPluginApi
    >;
  };
}
