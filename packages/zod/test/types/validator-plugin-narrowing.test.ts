/**
 * Type-level tests: Validator plugin narrowing and capability gating
 *
 * Scenarios:
 * - Router without validation plugin does NOT have rpc()
 * - Router with withZod() HAS rpc() and proper type narrowing
 * - Branded schemas preserve payload type through inference
 * - Multiple plugins chain correctly and merge capabilities
 * - Fluent API preserves types through chaining
 *
 * Run with: `bun tsc --noEmit` or `bun test`
 */

import { describe, it, expectTypeOf } from "bun:test";
import type { Router, MessageDescriptor } from "@ws-kit/core";
import { z, message, withZod, createRouter } from "../../src/index";

describe("validator plugin narrowing (types)", () => {
  // Test 1: Router without plugin has NO rpc() method
  it("router without plugin should NOT have rpc", () => {
    // Type assertion: Router without plugins should not have rpc
    type BaseRouter = Router<{ userId?: string }>;
    type HasRpc = "rpc" extends keyof BaseRouter ? true : false;

    expectTypeOf<HasRpc>().toEqualTypeOf<false>();
  });

  // Test 2: withZod() returns Router with validation capability
  it("withZod() plugin narrows router to validation capability", () => {
    type UnvalidatedRouter = Router<{ userId?: string }>;
    type ValidatedRouter = ReturnType<ReturnType<typeof withZod>>;

    expectTypeOf<ValidatedRouter>().toHaveProperty("rpc");
  });

  // Test 3: Router.plugin(withZod()) returns validated router
  it("router.plugin(withZod()) provides rpc method", () => {
    const validated = createRouter<{ userId?: string }>().plugin(withZod());

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
      .plugin(withZod())
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
      username: z.string(),
      password: z.string(),
    });

    // At type level, schema has __zod_payload brand
    expectTypeOf(LoginMessage).toHaveProperty("__zod_payload");

    // Can extract payload type and verify it's a ZodObject
    type PayloadType = typeof LoginMessage extends { __zod_payload: infer P }
      ? P
      : never;

    // PayloadType should be a valid Zod schema object
    expectTypeOf<PayloadType>().toMatchTypeOf<z.ZodType>();
  });

  // Test 6: withZod options configuration is type-safe
  it("withZod options are type-safe", () => {
    // Standard configuration should return function
    const standardConfig = withZod({
      validateOutgoing: true,
      coerce: false,
    });
    expectTypeOf(standardConfig).toBeFunction();

    // With custom error hook
    type ErrorHookType = (err: Error & { code: string; details: unknown }, ctx: { type: string; direction: "inbound" | "outbound"; payload: unknown }) => void | Promise<void>;

    const configWithHook = withZod({
      onValidationError: async (err, ctx) => {
        expectTypeOf(err.code).toBeString();
        expectTypeOf(ctx.type).toBeString();
        expectTypeOf(ctx.direction).toMatchTypeOf<"inbound" | "outbound">();
      },
    });
    expectTypeOf(configWithHook).toBeFunction();
  });

  // Test 7: RPC method available after plugin
  it("rpc method is available after plugin", () => {
    const validated = createRouter<{ userId?: string }>().plugin(withZod());

    // Chaining works - rpc returns same router type
    expectTypeOf(validated).toHaveProperty("plugin");
    expectTypeOf(validated).toHaveProperty("rpc");
  });

  // Test 8: Multiple plugins merge capabilities
  it("multiple plugins merge capabilities correctly", () => {
    // Mock pubsub plugin
    const withMockPubSub = (r: Router<any>) => {
      const enhanced = Object.assign(r, {
        publish: async (topic: string, schema: MessageDescriptor, payload: unknown) => {},
        subscriptions: { list: () => [] as string[], has: (t: string) => false },
      }) as Router<any, { pubsub: true }>;
      (enhanced as any).__caps = { pubsub: true };
      return enhanced;
    };

    const router = createRouter<{ userId?: string }>()
      .plugin(withZod())
      .plugin(withMockPubSub);

    // Both validation and pubsub methods should be available
    expectTypeOf(router).toHaveProperty("rpc");
    expectTypeOf(router).toHaveProperty("publish");
    expectTypeOf(router).toHaveProperty("on");
  });

  // Test 9: withZod() is idempotent
  it("withZod() plugin is idempotent", () => {
    const router = createRouter<{ userId?: string }>();
    const withZodPlugin = withZod();

    const validated1 = router.plugin(withZodPlugin);
    const validated2 = validated1.plugin(withZodPlugin);

    // Type should be same after both applications
    expectTypeOf(validated1).toHaveProperty("rpc");
    expectTypeOf(validated2).toHaveProperty("rpc");
  });

  // Test 10: Options don't affect type narrowing
  it("withZod options don't affect type narrowing", () => {
    const withoutValidation = withZod({ validateOutgoing: false });
    const withValidation = withZod({ validateOutgoing: true, coerce: true });
    const withHook = withZod({
      onValidationError: (err, ctx) => {
        // Just for type testing
      },
    });

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
    const plugin = withZod({
      onValidationError: (err, ctx) => {
        // Error structure
        expectTypeOf(err.code).toBeString();
        expectTypeOf(err.details).toBeDefined();

        // Context structure
        expectTypeOf(ctx.type).toBeString();
        expectTypeOf(ctx.direction).toMatchTypeOf<"inbound" | "outbound">();
        expectTypeOf(ctx.payload).toBeDefined();
      },
    });

    expectTypeOf(plugin).toBeFunction();
  });
});
