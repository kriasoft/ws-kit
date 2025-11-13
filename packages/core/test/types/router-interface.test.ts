// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for Router interface conformance.
 *
 * These tests verify that:
 * 1. TypedZodRouter conforms to Router
 * 2. WebSocketRouter implements Router
 * 3. Adapters accept Router parameters
 * 4. Fluent chaining works correctly
 *
 * Run: bun test packages/core/test/types/router-interface.test.ts
 */

import type { Router, WebSocketData } from "@ws-kit/core";
import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expectTypeOf, it } from "bun:test";

describe("Router interface conformance", () => {
  // Test 1: TypedZodRouter conforms to Router
  it("TypedZodRouter satisfies Router type", () => {
    const typed = createRouter<{ userId?: string }>();

    // Type-level verification: typed must satisfy Router
    expectTypeOf(typed).toMatchTypeOf<Router<{ userId?: string }>>();
  });

  // Test 2: Router from createRouter implements Router
  it("Router implements Router", () => {
    const core = createRouter<{ clientId: string }>();

    // Type-level verification: core must satisfy Router
    expectTypeOf(core).toMatchTypeOf<Router<{ clientId: string }>>();
  });

  // Test 3: Functions can accept Router parameters
  it("Functions accept Router parameters", () => {
    const acceptRouter = (r: Router<{ clientId: string }>): void => {
      // Verify router has required methods
      expectTypeOf(r.on).toBeFunction();
      expectTypeOf(r.merge).toBeFunction();
      expectTypeOf(r.use).toBeFunction();
    };

    const typed = createRouter<{ clientId: string }>();
    // Type-level verification: typed is assignable to parameter type
    expectTypeOf(typed).toMatchTypeOf<Parameters<typeof acceptRouter>[0]>();

    const core = createRouter<{ clientId: string }>();
    expectTypeOf(core).toMatchTypeOf<Parameters<typeof acceptRouter>[0]>();
  });

  // Test 4: Fluent chaining returns correct type
  it("Fluent chaining returns correct type", () => {
    const TestMsg = message("TEST", { data: z.string() });
    const TestMsg2 = message("TEST2", { data: z.string() });
    const router = createRouter<{ clientId: string }>();

    // Chaining should return a router that still matches Router
    const result = router
      .on(TestMsg, (ctx) => {
        ctx.send(TestMsg, { data: "test" });
      })
      .on(TestMsg2, (ctx) => {
        ctx.send(TestMsg2, { data: "test" });
      });

    // Verify result still satisfies router interface
    expectTypeOf(result).toMatchTypeOf<Router<{ clientId: string }>>();
    expectTypeOf(result.on).toBeFunction();
    expectTypeOf(result.rpc).toBeFunction();
  });

  // Test 5: Type inference in handlers is preserved
  it("Type inference in handlers is preserved", () => {
    const LoginMsg = message("LOGIN", {
      username: z.string(),
      password: z.string(),
    });
    const LoginOk = message("LOGIN_OK", { token: z.string() });

    const router = createRouter<{ userId?: string }>();

    router.on(LoginMsg, (ctx) => {
      // Payload should be fully typed
      const { username, password } = ctx.payload;

      // Type-level verification of payload shape
      expectTypeOf<typeof username>().toBeString();
      expectTypeOf<typeof password>().toBeString();

      // send should be callable with matching schema
      expectTypeOf(ctx.send).toBeFunction();
    });

    expectTypeOf(router).toMatchTypeOf<Router<{ userId?: string }>>();
  });

  // Test 6: Mixed router instances can be merged
  it("Different router instances can be merged", () => {
    const router1 = createRouter<{ clientId: string }>();
    const router2 = createRouter<{ clientId: string }>();

    // Both must satisfy the interface for composition
    expectTypeOf(router1).toMatchTypeOf<Router<{ clientId: string }>>();
    expectTypeOf(router2).toMatchTypeOf<Router<{ clientId: string }>>();

    // Merge should return a router
    const result = router1.merge(router2);
    expectTypeOf(result).toMatchTypeOf<Router<{ clientId: string }>>();
  });

  // Test 7: Router satisfies WebSocketData constraint
  it("Router works with generic WebSocketData", () => {
    // Router should work with the base WebSocketData type
    const router = createRouter<WebSocketData>();
    expectTypeOf(router).toMatchTypeOf<Router<WebSocketData>>();
  });
});

describe("Adapter compatibility", () => {
  // Type-level tests that verify routers are compatible with adapters
  // by checking they satisfy Router parameter types

  it("Typed router is compatible with adapter expectations", () => {
    const router = createRouter<{ clientId: string }>();

    // Define adapter-like function that accepts Router
    type AdapterFn = (r: Router<{ clientId: string }>) => void;

    // Verify router satisfies adapter parameter type
    expectTypeOf(router).toMatchTypeOf<Parameters<AdapterFn>[0]>();
  });

  it("Zod router is compatible with adapter expectations", () => {
    const router = createRouter<{ clientId: string }>();

    // Adapter parameter type
    type AdapterFn = (r: Router<{ clientId: string }>) => void;

    // Verify router satisfies adapter parameter type
    expectTypeOf(router).toMatchTypeOf<Parameters<AdapterFn>[0]>();
  });
});
