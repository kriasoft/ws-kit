// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Optional semantic capability registry for advanced type documentation.
 *
 * Teams that want type-level capability semantics can use this registry
 * to map capability names to their APIs. This is completely optional and
 * NOT required for plugins to work.
 *
 * Core plugins (validation, pubsub) provide their API interfaces here.
 * Third-party plugins can augment this registry via module augmentation.
 *
 * @example Basic usage (type annotation only):
 * ```typescript
 * import type { RouterWithCapabilities } from "@ws-kit/core/plugin";
 *
 * type AppRouter = RouterWithCapabilities<MyContext, ["validation", "pubsub"]>;
 *
 * const router: AppRouter = createRouter()
 *   .plugin(withZod())
 *   .plugin(withPubSub({ adapter }));
 * ```
 *
 * @example Third-party plugin augmentation:
 * ```typescript
 * // my-metrics-plugin/src/index.ts
 * export interface MetricsAPI<TContext> {
 *   trackEvent(event: string, meta?: Record<string, unknown>): void;
 * }
 *
 * // Module augmentation
 * declare module "@ws-kit/core/plugin" {
 *   interface RouterCapabilityAPIs<TContext> {
 *     metrics: MetricsAPI<TContext>;
 *   }
 * }
 * ```
 */

import type { ConnectionData } from "../context/base-context";
import type { ValidationAPI, PubSubAPI } from "../core/router";

/**
 * Registry mapping capability names to their APIs.
 *
 * Core capabilities are provided here. Third-party plugins augment this
 * interface via module augmentation to make their APIs discoverable at
 * the type level.
 *
 * @typeParam TContext - Per-connection data structure
 *
 * @example Declaring a capability in your plugin:
 * ```typescript
 * declare module "@ws-kit/core/plugin" {
 *   interface RouterCapabilityAPIs<TContext> {
 *     myfeature: MyFeatureAPI<TContext>;
 *   }
 * }
 * ```
 */
export interface RouterCapabilityAPIs<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Validation API: adds request-response (RPC) handlers with validation.
   * Provided by @ws-kit/zod or @ws-kit/valibot.
   */
  validation: ValidationAPI<TContext>;

  /**
   * Pub/Sub API: adds message broadcasting to topics.
   * Provided by @ws-kit/pubsub.
   */
  pubsub: PubSubAPI<TContext>;
}

/**
 * Helper utility: convert a union type to an intersection type.
 *
 * Used internally by RouterWithCapabilities to merge multiple capability
 * APIs into a single intersection for type inference.
 *
 * @example
 * ```typescript
 * type Union = { a: 1 } | { b: 2 };
 * type Intersection = UnionToIntersection<Union>; // { a: 1 } & { b: 2 }
 * ```
 *
 * @internal
 */
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

/**
 * Type alias: Router with specific named capabilities.
 *
 * This is an optional helper for type-level documentation. Users can use
 * it directly to annotate their router type, or ignore it entirely.
 *
 * The semantic layer does NOT affect runtime behavior. It's purely for
 * static type checking and IDE assistance.
 *
 * @typeParam TContext - Per-connection data structure
 * @typeParam TCapabilities - Array of capability names to require
 *
 * @example With validation and pubsub:
 * ```typescript
 * type AppRouter = RouterWithCapabilities<MyContext, ["validation", "pubsub"]>;
 *
 * const router: AppRouter = createRouter()
 *   .plugin(withZod())
 *   .plugin(withPubSub({ adapter }));
 * ```
 *
 * @example With just validation:
 * ```typescript
 * type ValidationRouter = RouterWithCapabilities<MyContext, ["validation"]>;
 *
 * const router: ValidationRouter = createRouter()
 *   .plugin(withZod());
 * ```
 *
 * @remarks
 * Benefits of this pattern:
 * - Type-safe capability composition
 * - IDE autocomplete for capability names
 * - Self-documenting: function signatures show required capabilities
 * - Zero runtime cost
 *
 * Limitations:
 * - Manual annotation required (not inferred from .plugin() calls)
 * - Must match actual plugin application order
 * - Mismatch between type and runtime is not prevented (use tests for this)
 */
export type RouterWithCapabilities<
  TContext extends ConnectionData,
  TCapabilities extends readonly (keyof RouterCapabilityAPIs<TContext>)[],
> = import("../core/router").Router<
  TContext,
  UnionToIntersection<
    {
      [K in TCapabilities[number]]: RouterCapabilityAPIs<TContext>[K];
    }[TCapabilities[number]]
  > &
    object
>;
