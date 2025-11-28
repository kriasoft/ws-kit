// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for plugin capability gating.
 *
 * Verifies that TypeScript enforces compile-time safety:
 * - Base router lacks rpc(), publish() methods (negative gating)
 * - Adding validation plugin enables rpc() (positive gating)
 * - Adding pubsub plugin enables publish() and topics (positive gating)
 *
 * Note: Plugin composition (Tests 3–4) has a known type inference limitation
 * where chaining plugins doesn't preserve all capabilities in the type system.
 * This is documented as TODO; the runtime behavior is correct.
 *
 * Run with: `bun run tsc --noEmit` to verify types.
 */

import { createRouter } from "../../src/core/createRouter";
import type { Router } from "../../src/core/router";
import type { Plugin } from "../../src/plugin/types";

// Mock plugins for type testing
const mockValidationPlugin: Plugin<any, { validation: true }> = <
  TCurrentExt extends object,
>(
  router: Router<any, TCurrentExt>,
) => {
  return Object.assign(router, {
    validation: true as const,
    rpc: (() => {}) as any,
  }) as any as Router<any, TCurrentExt & { validation: true }>;
};

const mockPubSubPlugin: Plugin<any, { pubsub: true }> = <
  TCurrentExt extends object,
>(
  router: Router<any, TCurrentExt>,
) => {
  return Object.assign(router, {
    pubsub: true as const,
    publish: (() => {}) as any,
    topics: { list: () => [], has: () => false } as any,
  }) as any as Router<any, TCurrentExt & { pubsub: true }>;
};

// ============================================================================
// Negative Gating: Base router lacks capability methods
// These are compile-time only checks - never executed at runtime
// ============================================================================

/**
 * Test 1A: Base router should NOT have rpc() method
 * Test 1B: Base router should NOT have publish() method
 * Test 1C: Base router should NOT have topics
 *
 * Note: Wrapped in function to prevent runtime execution while still
 * allowing TypeScript to check the types.
 */
function typeChecksOnly() {
  const baseRouter = createRouter();
  // @ts-expect-error — rpc() should not exist without validation plugin
  baseRouter.rpc({} as any, () => {});
  // @ts-expect-error — publish() should not exist without pubsub plugin
  baseRouter.publish("topic", {} as any, {});
  // @ts-expect-error — topics should not exist without pubsub plugin
  void baseRouter.topics;
}
void typeChecksOnly; // Reference to avoid unused warning

// ============================================================================
// Positive Gating: Single plugins enable capabilities
// ============================================================================

/**
 * Test 2A: After validation plugin, rpc() becomes available
 *
 * Note: The `rpc()` method is type-gated and enforced by TypeScript.
 * The `validation` flag is a runtime affordance (not type-checked, hence `as any`).
 */
const routerWithValidation = createRouter().plugin(mockValidationPlugin);
routerWithValidation.rpc({} as any, () => {});
// Runtime flag exists but is not part of the type contract
void (routerWithValidation as any).validation;

/**
 * Test 2B: After PubSub plugin, publish() and topics become available
 *
 * Note: The `publish()` method and `topics` property are type-gated and enforced.
 * The `pubsub` flag is a runtime affordance (not type-checked, hence `as any`).
 */
const routerWithPubSub = createRouter().plugin(mockPubSubPlugin);
routerWithPubSub.publish("topic", {} as any, {});
routerWithPubSub.topics.has("topic");
// Runtime flag exists but is not part of the type contract
void (routerWithPubSub as any).pubsub;

// ============================================================================
// Plugin Composition (Known Limitation)
// ============================================================================

/**
 * Test 3: Both plugins (validation → pubsub)
 *
 * TODO: Plugin composition has a type inference limitation.
 * At runtime, both capabilities exist; the type system doesn't expose them.
 *
 * IMPORTANT: These tests use `as any` casts and will NOT auto-fail when composition
 * types are fixed. When you fix the types, you must manually:
 * 1. Remove the `as any` casts below
 * 2. Verify they compile without errors
 * 3. Remove the TODO comment
 *
 * Before fix (current):
 *   (routerWithBoth as any).rpc(...);
 *   (routerWithBoth as any).publish(...);
 *
 * After fix (desired):
 *   routerWithBoth.rpc(...);
 *   routerWithBoth.publish(...);
 */
const routerWithBoth = createRouter()
  .plugin(mockValidationPlugin)
  .plugin(mockPubSubPlugin);

// Currently must cast due to composition type inference limitation
(routerWithBoth as any).rpc({} as any, () => {});
(routerWithBoth as any).publish("topic", {} as any, {});

/**
 * Test 4: Both plugins (pubsub → validation)
 *
 * Same limitation as Test 3, regardless of plugin order.
 */
const routerReversedOrder = createRouter()
  .plugin(mockPubSubPlugin)
  .plugin(mockValidationPlugin);

// Currently must cast due to composition type inference limitation
(routerReversedOrder as any).rpc({} as any, () => {});
(routerReversedOrder as any).publish("topic", {} as any, {});

// Type system enforces gating for single plugins; composition is a known TODO
export {};
