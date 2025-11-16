// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for plugin capability gating.
 * Verifies that TypeScript enforces compile-time safety.
 */

import { createRouter } from "../../src/core/createRouter";
import type { Router } from "../../src/core/router";
import type { Plugin } from "../../src/plugin/types";

// Mock plugins for type testing
const mockValidationPlugin: Plugin<any, { validation: true }> = (router) => {
  return Object.assign(router, { rpc: () => {} }) as Router<
    any,
    { validation: true }
  >;
};

const mockPubSubPlugin: Plugin<any, { pubsub: true }> = (router) => {
  return Object.assign(router, {
    publish: async () => {},
    subscriptions: { list: () => [], has: () => false },
  }) as Router<any, { pubsub: true }>;
};

// ============================================================================
// Type Assertions (compile-time checks)
// ============================================================================

/**
 * Test 1: After validation plugin, rpc() should be available
 */
const routerWithValidation = createRouter().plugin(mockValidationPlugin);
// This should type-check without error (rpc exists)
routerWithValidation.rpc({} as any, () => {});

/**
 * Test 2: After PubSub plugin, publish() and subscriptions should be available
 */
const routerWithPubSub = createRouter().plugin(mockPubSubPlugin);
// This should type-check without error (publish exists)
routerWithPubSub.publish("topic", {} as any, {});
routerWithPubSub.subscriptions.has("topic");

/**
 * Test 3: After both plugins, both methods should be available
 */
const routerWithBoth = createRouter()
  .plugin(mockValidationPlugin)
  .plugin(mockPubSubPlugin);

routerWithBoth.rpc({} as any, () => {});
routerWithBoth.publish("topic", {} as any, {});

/**
 * Test 4: Different plugin order should still enable both methods
 */
const routerReversedOrder = createRouter()
  .plugin(mockPubSubPlugin)
  .plugin(mockValidationPlugin);

routerReversedOrder.rpc({} as any, () => {});
routerReversedOrder.publish("topic", {} as any, {});

// Type system ensures capability gating at compile time
export {};
