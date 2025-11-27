// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests: Valibot validator plugin narrowing and capability gating
 *
 * Mirrors the Zod type tests to ensure both validators have equivalent type coverage.
 *
 * Scenarios:
 * - Router without validation plugin does NOT have rpc()
 * - Router with withValibot() HAS rpc() and proper type narrowing
 * - Branded schemas preserve payload type through inference
 * - Multiple plugins chain correctly and merge capabilities
 * - Fluent API preserves types through chaining
 *
 * Run with: `bun tsc --noEmit` or `bun test`
 */

import type { MessageDescriptor, Router } from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";
import { createRouter, message, v, withValibot } from "./index.js";

describe("validator plugin narrowing - Valibot (types)", () => {
  // Test 1: Router without plugin has NO rpc() method
  it("router without plugin should NOT have rpc", () => {
    // Type assertion: Router without plugins should not have rpc
    type BaseRouter = Router<{ userId?: string }>;
    type HasRpc = "rpc" extends keyof BaseRouter ? true : false;

    expectTypeOf<HasRpc>().toEqualTypeOf<false>();
  });

  // Test 2: withValibot() returns Router with validation capability
  it("withValibot() plugin narrows router to validation capability", () => {
    type ValidatedRouter = ReturnType<ReturnType<typeof withValibot>>;

    expectTypeOf<ValidatedRouter>().toHaveProperty("rpc");
  });

  // Test 3: Router.plugin(withValibot()) returns validated router
  it("router.plugin(withValibot()) provides rpc method", () => {
    const validated = createRouter<{ userId?: string }>().plugin(withValibot());

    // Should have rpc method
    expectTypeOf(validated).toHaveProperty("rpc");

    // Should still have base methods
    expectTypeOf(validated).toHaveProperty("on");
    expectTypeOf(validated).toHaveProperty("use");
    expectTypeOf(validated).toHaveProperty("onError");
  });

  // Test 4: Fluent chaining preserves validation capability
  it("fluent chaining preserves validation capability", () => {
    const validated = createRouter<{ userId?: string }>()
      .plugin(withValibot())
      .use(async (ctx, next) => {
        await next();
      });

    // Type is preserved - rpc() available after chaining
    expectTypeOf(validated).toHaveProperty("rpc");
    expectTypeOf(validated).toHaveProperty("on");
  });

  // Test 5: Branded schema preserves payload type inference
  it("branded schema preserves payload type inference", () => {
    const LoginMessage = message("LOGIN", {
      username: v.string(),
      password: v.string(),
    });

    // At type level, schema has __valibot_payload brand
    expectTypeOf(LoginMessage).toHaveProperty("__valibot_payload");

    // Can extract payload type
    type PayloadType = typeof LoginMessage extends {
      __valibot_payload: infer P;
    }
      ? P
      : never;

    // PayloadType should exist (it's the Valibot schema object)
    // Verify it's not never
    expectTypeOf<PayloadType>().not.toBeNever();
  });

  // Test 6: withValibot options configuration is type-safe
  it("withValibot options are type-safe", () => {
    // Standard configuration
    const standardConfig = withValibot({
      validateOutgoing: true,
    });
    expectTypeOf(standardConfig).toBeFunction();

    // With custom error hook
    const configWithHook = withValibot({
      onValidationError: async (err, ctx) => {
        // err should have code and details
        expectTypeOf(err.code).toBeString();
        expectTypeOf(err.details).not.toBeUndefined();

        // ctx should have type and direction
        expectTypeOf(ctx.type).toBeString();
        expectTypeOf(ctx.direction).toMatchTypeOf<"inbound" | "outbound">();
      },
    });
    expectTypeOf(configWithHook).toBeFunction();
  });

  // Test 7: RPC method available after plugin
  it("rpc method is available after plugin", () => {
    const validated = createRouter<{ userId?: string }>().plugin(withValibot());

    // Chaining works - rpc returns same router type
    expectTypeOf(validated).toHaveProperty("plugin");
    expectTypeOf(validated).toHaveProperty("rpc");
  });

  // Test 8: Multiple plugins merge capabilities
  it("multiple plugins merge capabilities correctly", () => {
    // Mock pubsub plugin for testing capability merging
    const withMockPubSub: (r: Router<any>) => Router<any, { pubsub: true }> = (
      r: Router<any>,
    ) => {
      const enhanced = Object.assign(r, {
        publish: async (
          topic: string,
          schema: MessageDescriptor,
          payload: unknown,
        ) => ({ ok: true as const, matched: 0, capability: "exact" as const }),
        topics: {
          list: () => [] as readonly string[],
          has: (t: string) => false,
        },
      }) as unknown as Router<any, { pubsub: true }>;
      (enhanced as any).__caps = { pubsub: true };
      return enhanced;
    };

    const router = createRouter<{ userId?: string }>()
      .plugin(withValibot())
      .plugin(withMockPubSub as any);

    // Both validation and pubsub methods should be available
    expectTypeOf(router).toHaveProperty("rpc");
    expectTypeOf(router).toHaveProperty("publish");
    expectTypeOf(router).toHaveProperty("on");
  });

  // Test 9: withValibot() is idempotent
  it("withValibot() plugin is idempotent", () => {
    const router = createRouter<{ userId?: string }>();
    const withValibotPlugin = withValibot();

    const validated1 = router.plugin(withValibotPlugin);
    const validated2 = validated1.plugin(withValibotPlugin);

    // Type should be same after both applications
    expectTypeOf(validated1).toHaveProperty("rpc");
    expectTypeOf(validated2).toHaveProperty("rpc");
  });

  // Test 10: Options don't affect type narrowing
  it("withValibot options don't affect type narrowing", () => {
    const withoutValidation = withValibot({
      validateOutgoing: false,
    });

    const withValidation = withValibot({
      validateOutgoing: true,
    });

    const withHook = withValibot({
      onValidationError: (err, ctx) => {
        // Just for type testing
      },
    });

    // All return same Router<TContext, { validation: true }> type
    const r1 = createRouter().plugin(withoutValidation);
    const r2 = createRouter().plugin(withValidation);
    const r3 = createRouter().plugin(withHook);

    // All should have rpc
    expectTypeOf(r1).toHaveProperty("rpc");
    expectTypeOf(r2).toHaveProperty("rpc");
    expectTypeOf(r3).toHaveProperty("rpc");
  });

  // Test 11: Error hook callback signature
  it("error hook callback signature is type-safe", () => {
    const plugin = withValibot({
      onValidationError: (err, ctx) => {
        // Error structure
        expectTypeOf(err.code).toBeString();
        expectTypeOf(err.details).not.toBeUndefined();

        // Context structure
        expectTypeOf(ctx.type).toBeString();
        expectTypeOf(ctx.direction).toMatchTypeOf<"inbound" | "outbound">();
        expectTypeOf(ctx.payload).not.toBeUndefined();
      },
    });

    expectTypeOf(plugin).toBeFunction();
  });

  // Test 12: withValibot() can be stacked with other plugins safely
  it("withValibot() can be stacked with other plugins safely", () => {
    // Apply same plugin twice - should be idempotent
    const plugin = withValibot();

    const router = createRouter().plugin(plugin).plugin(plugin); // Second application is safe

    // Should still have rpc (not duplicated or broken)
    expectTypeOf(router).toHaveProperty("rpc");
  });
});
