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

import type { Router } from "../core/router";

/**
 * Plugin<TContext, TCaps> takes a router, returns a router with added capabilities.
 * TCaps describes what capabilities are added (e.g., { validation: true }).
 * TContext — the per-connection data structure available throughout the router.
 */
export type Plugin<TContext = unknown, TCaps = unknown> = (
  router: Router<TContext, any>,
) => Router<TContext, MergeCapabilities<TCaps>>;

/**
 * Capability bit-flags (internal union).
 * Plugins merge their capabilities into this type.
 * @internal
 */
export interface Capabilities {
  validation?: boolean;
  pubsub?: boolean;
  telemetry?: boolean;
}

/**
 * Merge capabilities (used by Router type narrowing).
 */
export type MergeCapabilities<T = unknown> = T extends Capabilities ? T : {};

/**
 * Internal alias for MergeCapabilities.
 * @internal
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
