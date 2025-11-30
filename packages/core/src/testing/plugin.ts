// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Plugin testing utilities.
 *
 * Provides helpers for unit-testing routers with mocked or stubbed plugins.
 */

import type { ConnectionData } from "../context/base-context";
import type { Plugin } from "../core/router";
import { definePlugin } from "../plugin/define";

/**
 * Create a mock plugin for testing.
 *
 * Useful for:
 * - Stubbing plugin dependencies in isolation tests
 * - Testing router behavior without real plugin implementations
 * - Mocking async operations (pub/sub, validation, etc.)
 *
 * The returned plugin has the exact shape of `mockExtensions`, so TypeScript
 * infers the router type correctly after `.plugin(mockPlugin(...))`.
 *
 * @param mockExtensions Partial or full implementation of the plugin API
 * @returns A Plugin function with the given extensions
 *
 * @example Stub a pub/sub plugin for router testing
 * ```typescript
 * import { mockPlugin } from "@ws-kit/core/testing";
 * import type { PubSubAPI } from "@ws-kit/core/router";
 *
 * const mockPubSub = mockPlugin<MyContext, PubSubAPI<MyContext>>({
 *   publish: async () => ({ ok: true, capability: "test", matched: 0 }),
 *   topics: { list: () => [], has: () => false },
 *   pubsub: { tap: () => () => {}, init: async () => {}, shutdown: async () => {} },
 * });
 *
 * const router = createRouter<MyContext>()
 *   .plugin(withValidation)
 *   .plugin(mockPubSub); // Stub pub/sub
 *
 * // Now test router behavior without real broker
 * ```
 *
 * @example Partial mock with selective overrides
 * ```typescript
 * const mockPubSub = mockPlugin<MyContext, Partial<PubSubAPI<MyContext>>>({
 *   publish: async () => ({ ok: true, capability: "test", matched: 5 }),
 *   // Other properties can be undefined for minimal testing
 * });
 * ```
 *
 * @example Mock plugin that tracks calls (for verification)
 * ```typescript
 * const publishCalls: Array<{ topic: string; payload: unknown }> = [];
 *
 * const mockPubSub = mockPlugin<MyContext, PubSubAPI<MyContext>>({
 *   publish: async (topic, schema, payload) => {
 *     publishCalls.push({ topic, payload });
 *     return { ok: true, capability: "test", matched: 1 };
 *   },
 *   topics: { list: () => [], has: () => false },
 *   pubsub: { tap: () => () => {}, init: async () => {}, shutdown: async () => {} },
 * });
 *
 * // ... use router ...
 * expect(publishCalls).toHaveLength(1);
 * expect(publishCalls[0].topic).toBe("test:topic");
 * ```
 */
export function mockPlugin<
  TContext extends ConnectionData = ConnectionData,
  TPluginApi extends object = {},
>(mockExtensions: TPluginApi): Plugin<TContext, TPluginApi> {
  return definePlugin<TContext, TPluginApi>((router) => {
    // Preserve router argument for future expansion while keeping typing accurate
    void router;
    return mockExtensions;
  });
}
