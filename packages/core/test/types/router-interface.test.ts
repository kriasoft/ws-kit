// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for Router interface conformance.
 *
 * These tests verify that:
 * 1. Zod-validated routers conform to the Router interface
 * 2. Fluent chaining preserves Router type
 * 3. Handler type inference is preserved
 * 4. Router composition (merge) works correctly
 * 5. Functions and adapters can accept Router parameters
 *
 * Run: bun test packages/core/test/types/router-interface.test.ts
 */

import type { Router, WebSocketData } from "@ws-kit/core";
import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expectTypeOf, it } from "bun:test";

describe("Router interface conformance", () => {
  // Test 1: Router conforms to Router interface
  it("createRouter returns a Router-conformant instance", () => {
    const router = createRouter<{ userId?: string }>();
    expectTypeOf(router).toExtend<Router<{ userId?: string }>>();
  });

  // Test 2: Functions and adapters can accept Router parameters
  it("Functions can accept Router as parameter", () => {
    type RouterParameter = Router<{ clientId: string }>;
    const acceptRouter = (r: RouterParameter): void => {};

    const router = createRouter<{ clientId: string }>();
    expectTypeOf(router).toExtend<Parameters<typeof acceptRouter>[0]>();

    // Verify Router core methods are available
    expectTypeOf<RouterParameter["on"]>().toBeFunction();
    expectTypeOf<RouterParameter["merge"]>().toBeFunction();
    expectTypeOf<RouterParameter["use"]>().toBeFunction();
  });

  // Test 3: Fluent chaining returns correct type
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
    expectTypeOf(result).toExtend<Router<{ clientId: string }>>();
    expectTypeOf(result.on).toBeFunction();
    expectTypeOf(result.merge).toBeFunction();
  });

  // Test 4: Type inference in handlers is preserved
  it("Type inference in handlers is preserved", () => {
    const LoginMsg = message("LOGIN", {
      username: z.string(),
      password: z.string(),
    });

    const router = createRouter<{ userId?: string }>();

    router.on(LoginMsg, (ctx) => {
      // Payload should be fully typed
      // TypeScript infers ctx.payload has { username: string, password: string }
      const payload = ctx.payload;
      // Verify ctx has send method for type-safe responses
      type HasSend = typeof ctx extends { send: any } ? true : false;
      const _: HasSend = true;
    });

    expectTypeOf(router).toExtend<Router<{ userId?: string }>>();
  });

  // Test 5: Router composition via merge
  it("Different router instances can be merged", () => {
    const router1 = createRouter<{ clientId: string }>();
    const router2 = createRouter<{ clientId: string }>();

    // Both must satisfy the interface for composition
    expectTypeOf(router1).toExtend<Router<{ clientId: string }>>();
    expectTypeOf(router2).toExtend<Router<{ clientId: string }>>();

    // Merge should return a router
    const result = router1.merge(router2);
    expectTypeOf(result).toExtend<Router<{ clientId: string }>>();
  });

  // Test 6: Router works with generic WebSocketData
  it("Router works with generic WebSocketData", () => {
    // Router should work with the base WebSocketData type
    const router = createRouter<WebSocketData>();
    expectTypeOf(router).toExtend<Router<WebSocketData>>();
  });
});

describe("Adapter compatibility", () => {
  // Verify routers can be used where Router type is expected in function signatures
  // This ensures adapters can accept router instances as parameters

  it("Routers satisfy adapter parameter expectations", () => {
    const router = createRouter<{ clientId: string }>();

    // Adapter function signature
    type AdapterFn = (r: Router<{ clientId: string }>) => void;

    // Router should be assignable to adapter's Router parameter
    expectTypeOf(router).toExtend<Parameters<AdapterFn>[0]>();
  });
});
