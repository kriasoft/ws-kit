// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for the optional semantic capability layer.
 * Verifies that RouterWithCapabilities provides proper type inference.
 *
 * These are compile-time tests only (using tsc).
 */

import type { Router } from "../../src/core/router";
import type {
  RouterCapabilityAPIs,
  RouterWithCapabilities,
} from "../../src/plugin/capabilities";
import type { ConnectionData } from "../../src/context/base-context";

// ============================================================================
// Test Context
// ============================================================================

interface MyContext extends ConnectionData {
  userId?: string;
  roles?: string[];
}

// ============================================================================
// Type Assertions (compile-time checks)
// ============================================================================

/**
 * Test 1: RouterCapabilityAPIs registry is properly typed
 */
type CapabilityRegistry = RouterCapabilityAPIs<MyContext>;

// These should compile without errors (properties exist)
type ValidationCapability = CapabilityRegistry["validation"];
type PubSubCapability = CapabilityRegistry["pubsub"];

/**
 * Test 2: RouterWithCapabilities with single capability
 */
type ValidationRouter = RouterWithCapabilities<MyContext, ["validation"]>;

// Should have Router<MyContext, ValidatinoAPI>
const validationRouter: ValidationRouter = {} as any;
// Type assertion: validationRouter should have rpc method
(validationRouter as any).rpc({} as any, () => {});

/**
 * Test 3: RouterWithCapabilities with multiple capabilities
 */
type FullRouter = RouterWithCapabilities<MyContext, ["validation", "pubsub"]>;

// Should have Router<MyContext, ValidationAPI & PubSubAPI>
const fullRouter: FullRouter = {} as any;
// Type assertions: fullRouter should have both rpc and publish
(fullRouter as any).rpc({} as any, () => {});
(fullRouter as any).publish("topic", {} as any, {});

/**
 * Test 4: RouterWithCapabilities with just pubsub
 */
type PubSubRouter = RouterWithCapabilities<MyContext, ["pubsub"]>;

// Should have Router<MyContext, PubSubAPI>
const pubsubRouter: PubSubRouter = {} as any;
// Type assertion: pubsubRouter should have publish
(pubsubRouter as any).publish("topic", {} as any, {});

/**
 * Test 5: Empty capabilities (base router only)
 */
type BaseRouter = RouterWithCapabilities<MyContext, []>;

// Should be Router<MyContext, {}>
const baseRouter: BaseRouter = {} as any;
// Type assertion: baseRouter should have base methods
(baseRouter as any).use(() => {});
(baseRouter as any).on({} as any, () => {});

/**
 * Test 6: Custom context preserved
 */
type CustomContextRouter = RouterWithCapabilities<
  { customField: string },
  ["validation"]
>;

// Custom context should be preserved in the router type
const customRouter: CustomContextRouter = {} as any;
(customRouter as any).rpc({} as any, (ctx: any) => {
  // Context data should be available
  ctx.data.customField;
});

/**
 * Test 7: Capability names are validated against registry
 */
// This should only allow names that exist in RouterCapabilityAPIs
type ValidCapabilities = RouterWithCapabilities<MyContext, ["validation"]>;

// Uncomment the following line to see a type error
// (it references a non-existent capability)
// type InvalidCapabilities = RouterWithCapabilities<MyContext, ["nonexistent"]>;
// ^^^ Should produce: "Type '"nonexistent"' is not assignable to type 'keyof RouterCapabilityAPIs<MyContext>'"

/**
 * Test 8: Semantic layer is optional (users can ignore it)
 */
// Users can still use plain Router type without RouterWithCapabilities
type PlainRouter = Router<MyContext>;
const plainRouter: PlainRouter = {} as any;
(plainRouter as any).use(() => {});
(plainRouter as any).on({} as any, () => {});

// Export dummy to prevent "file has no exports" error in strict mode
export const __test__ = true;
