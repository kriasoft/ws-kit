// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Plugin system: pure functions that widen router capabilities.
 *
 * Plugins are defined via the definePlugin() helper and return plugin API
 * extensions that are merged into the router. See ADR-029 for the design.
 *
 * Plugins:
 * - Are idempotent (safe to call multiple times)
 * - Return a widened router (with new methods or context)
 * - Use the enhancer chain pattern for safe composition
 * - Do NOT mutate the router directly
 *
 * @see ADR-029: Context Enhancer Registry & Plugin Safety
 * @see definePlugin() for type-safe plugin creation
 */

import type { ConnectionData } from "../context/base-context";
import type { Router } from "../core/router";

/**
 * Plugin<TContext, TPluginApi> is a function that takes a router
 * and returns a router with extended API.
 *
 * The plugin is generic over both the current extensions (captured via `any`)
 * and the new extensions it adds (TPluginApi).
 *
 * @typeParam TContext - Per-connection data structure
 * @typeParam TPluginApi - Object representing the API this plugin adds
 *
 * @example
 * ```typescript
 * // A plugin that adds { rpc() } method
 * type ValidationPlugin = Plugin<MyContext, { rpc(...): this }>;
 *
 * // A plugin that adds { publish() } method
 * type PubSubPlugin = Plugin<MyContext, { publish(...): Promise<...> }>;
 * ```
 *
 * For type-safe plugin definition, use definePlugin() helper:
 * ```typescript
 * export const withMyFeature = definePlugin<MyContext, MyAPI>(
 *   (router) => ({ ... }),
 * );
 * ```
 */
export type Plugin<
  TContext extends ConnectionData = ConnectionData,
  TPluginApi extends object = {},
> = <TCurrentExt extends object>(
  router: Router<TContext, TCurrentExt>,
) => Router<TContext, TCurrentExt & TPluginApi>;
