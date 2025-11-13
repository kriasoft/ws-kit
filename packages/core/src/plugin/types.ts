// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Plugin system: pure functions that widen router capabilities.
 *
 * Plugins:
 * - Are idempotent (safe to call multiple times)
 * - Return a widened router (with new methods or context)
 * - Add capabilities via capability bit-flags (validation, pubsub, etc.)
 * - Do NOT mutate the router
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

/**
 * Capability bit-flags (internal union).
 * Kept for runtime capability tracking in PluginHost.
 * NOT used for type-level API gating anymore.
 * @internal
 */
export interface Capabilities {
  validation?: boolean;
  pubsub?: boolean;
  telemetry?: boolean;
}

/**
 * Merge capabilities (internal helper).
 * Kept for backward compatibility with existing code.
 * @internal
 * @deprecated Use definePlugin() instead for new plugins
 */
export type MergeCapabilities<T = unknown> = T extends Capabilities ? T : {};

/**
 * Internal alias for MergeCapabilities.
 * @internal
 * @deprecated Use definePlugin() instead for new plugins
 */
export type AsCapabilities<T = unknown> = MergeCapabilities<T>;

/**
 * Example: Memory PubSub Plugin
 * ```ts
 * export function withMemoryPubSub(): Plugin<any, { pubsub: true }> {
 *   return (router) => {
 *     const pubsub = new InMemoryPubSub();
 *
 *     const publish = async (
 *       topic: string,
 *       schema: MessageDescriptor,
 *       payload: unknown,
 *       opts?: { partitionKey?: string; meta?: Record<string, unknown> }
 *     ) => {
 *       // Publish to topic...
 *       pubsub.publish(topic, payload);
 *     };
 *
 *     const topics = {
 *       list: () => pubsub.topics(),
 *       has: (topic: string) => pubsub.hasTopic(topic),
 *     };
 *
 *     const enhanced = Object.assign(router, {
 *       publish,
 *       topics,
 *     }) as Router<any, { pubsub: true }>;
 *
 *     (enhanced as any).__caps = { pubsub: true };
 *     return enhanced;
 *   };
 * }
 * ```
 *
 * Example: Telemetry Plugin
 * ```ts
 * export function withTelemetry(hooks: {
 *   onMessage?(meta: { type: string; size: number; ts: number }): void;
 *   onPublish?(meta: { topic: string; type: string }): void;
 * }): Plugin<any> {
 *   return (router) => {
 *     // Hook into onError, intercept messages, etc.
 *     router.onError((err, ctx) => {
 *       hooks.onMessage?.({
 *         type: ctx?.type ?? "unknown",
 *         size: JSON.stringify(err).length,
 *         ts: Date.now(),
 *       });
 *     });
 *
 *     (router as any).__caps = { telemetry: true };
 *     return router as Router<any, { telemetry: true }>;
 *   };
 * }
 * ```
 */
