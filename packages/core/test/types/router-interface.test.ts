// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for IWebSocketRouter interface conformance.
 *
 * These tests verify that:
 * 1. TypedZodRouter conforms to IWebSocketRouter
 * 2. WebSocketRouter implements IWebSocketRouter
 * 3. Adapters accept IWebSocketRouter parameters
 * 4. Fluent chaining works correctly
 *
 * Run: bun test packages/core/test/types/router-interface.test.ts
 */

import type {
  IWebSocketRouter,
  ValidatorAdapter,
  WebSocketData,
} from "@ws-kit/core";
import { WebSocketRouter } from "@ws-kit/core";
import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expectTypeOf, it } from "bun:test";

describe("IWebSocketRouter interface conformance", () => {
  // Test 1: TypedZodRouter conforms to IWebSocketRouter
  it("TypedZodRouter satisfies IWebSocketRouter type", () => {
    const typed = createRouter<{ userId?: string }>();

    // Type-level verification: typed must satisfy IWebSocketRouter
    expectTypeOf(typed).toMatchTypeOf<IWebSocketRouter<{ userId?: string }>>();
  });

  // Test 2: WebSocketRouter implements IWebSocketRouter
  it("WebSocketRouter implements IWebSocketRouter", () => {
    const core = new WebSocketRouter<ValidatorAdapter, { clientId: string }>();

    // Type-level verification: core must satisfy IWebSocketRouter
    expectTypeOf(core).toMatchTypeOf<IWebSocketRouter<{ clientId: string }>>();
  });

  // Test 3: Functions can accept IWebSocketRouter parameters
  it("Functions accept IWebSocketRouter parameters", () => {
    const acceptRouter = (r: IWebSocketRouter<{ clientId: string }>): void => {
      // Verify router has required methods
      expectTypeOf(r.on).toBeFunction();
      expectTypeOf(r.rpc).toBeFunction();
      expectTypeOf(r.topic).toBeFunction();
      expectTypeOf(r.publish).toBeFunction();
      expectTypeOf(r.merge).toBeFunction();
    };

    const typed = createRouter<{ clientId: string }>();
    // Type-level verification: typed is assignable to parameter type
    expectTypeOf(typed).toMatchTypeOf<Parameters<typeof acceptRouter>[0]>();

    const core = new WebSocketRouter<ValidatorAdapter, { clientId: string }>();
    expectTypeOf(core).toMatchTypeOf<Parameters<typeof acceptRouter>[0]>();
  });

  // Test 4: Fluent chaining returns correct type
  it("Fluent chaining returns correct type", () => {
    const TestMsg = message("TEST", { data: z.string() });
    const router = createRouter<{ clientId: string }>();

    // Chaining should return a router that still matches IWebSocketRouter
    const result = router
      .on(TestMsg, (ctx) => {
        ctx.send(TestMsg, { data: "test" });
      })
      .onOpen((ctx) => {
        expectTypeOf(ctx.clientId).toBeString();
      })
      .onClose((ctx) => {
        expectTypeOf(ctx.clientId).toBeString();
      });

    // Verify result still satisfies router interface
    expectTypeOf(result).toMatchTypeOf<
      IWebSocketRouter<{ clientId: string }>
    >();
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

    expectTypeOf(router).toMatchTypeOf<IWebSocketRouter<{ userId?: string }>>();
  });

  // Test 6: Mixed router types can be merged
  it("Different router types can be merged", () => {
    const typed = createRouter<{ clientId: string }>();
    const core = new WebSocketRouter<ValidatorAdapter, { clientId: string }>();

    // Both must satisfy the interface for composition
    expectTypeOf(typed).toMatchTypeOf<IWebSocketRouter<{ clientId: string }>>();
    expectTypeOf(core).toMatchTypeOf<IWebSocketRouter<{ clientId: string }>>();

    // Merge should return a router
    const result = typed.merge(core);
    expectTypeOf(result).toMatchTypeOf<
      IWebSocketRouter<{ clientId: string }>
    >();
  });

  // Test 7: Router satisfies WebSocketData constraint
  it("Router works with generic WebSocketData", () => {
    // Router should work with the base WebSocketData type
    const router = createRouter<WebSocketData>();
    expectTypeOf(router).toMatchTypeOf<IWebSocketRouter<WebSocketData>>();
  });
});

describe("Adapter compatibility", () => {
  // Type-level tests that verify routers are compatible with adapters
  // by checking they satisfy IWebSocketRouter parameter types

  it("Typed router is compatible with adapter expectations", () => {
    const router = createRouter<{ clientId: string }>();

    // Define adapter-like function that accepts IWebSocketRouter
    type AdapterFn = (r: IWebSocketRouter<{ clientId: string }>) => void;

    // Verify router satisfies adapter parameter type
    expectTypeOf(router).toMatchTypeOf<Parameters<AdapterFn>[0]>();
  });

  it("Core router is compatible with adapter expectations", () => {
    const router = new WebSocketRouter<
      ValidatorAdapter,
      { clientId: string }
    >();

    // Adapter parameter type
    type AdapterFn = (r: IWebSocketRouter<{ clientId: string }>) => void;

    // Verify router satisfies adapter parameter type
    expectTypeOf(router).toMatchTypeOf<Parameters<AdapterFn>[0]>();
  });
});
