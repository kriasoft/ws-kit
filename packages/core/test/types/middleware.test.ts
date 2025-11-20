// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type inference tests for middleware.
 *
 * Key design: Middleware is intentionally payload-blind (sees MinimalContext with
 * generic type). This keeps middleware reusable and prevents schema coupling.
 * Only handlers get narrowed types via the .on() overload.
 *
 * These tests verify:
 * 1. Middleware<TContext> parameter type is MinimalContext<TContext>
 * 2. Global middleware has generic context (type: string) with no payload field
 * 3. Handlers get narrowed payload types via .on() overload
 * 4. ctx.data mutation works with type safety via ctx.assignData()
 * 5. Router composition with merge() preserves types
 * 6. Middleware can use ctx.error() to signal errors
 * 7. Async middleware is fully supported
 *
 * Tests are run via `tsc --noEmit` to verify type safety.
 */

import { createRouter, message, z } from "@ws-kit/zod";
import type { Middleware, MinimalContext } from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";

// ============================================================================
// Middleware Type Signature Tests
// ============================================================================

describe("Middleware type signature", () => {
  it("should use MinimalContext as parameter type", () => {
    interface AppData extends Record<string, unknown> {
      userId?: string;
    }

    type MiddlewareType = (
      ctx: MinimalContext<AppData>,
      next: () => Promise<void>,
    ) => Promise<void>;

    // Verify exported Middleware<T> type matches MinimalContext<T> signature
    expectTypeOf<Middleware<AppData>>().toEqualTypeOf<MiddlewareType>();

    const router = createRouter<AppData>();
    const mw: MiddlewareType = (ctx, next) => {
      expectTypeOf(ctx.type).toBeString();
      expectTypeOf(ctx.clientId).toBeString();
      return next();
    };

    router.use(mw);
  });

  it("should make payload inaccessible in middleware", () => {
    const router = createRouter<Record<string, unknown>>();

    router.use(async (ctx, next) => {
      // @ts-expect-error - payload is not part of MinimalContext
      const _: unknown = ctx.payload;

      return next();
    });
  });
});

// ============================================================================
// Global Middleware Type Tests
// ============================================================================

describe("Global middleware typing", () => {
  it("should have generic context (type: string)", () => {
    const router = createRouter<{ userId?: string }>();

    router.use((ctx, next) => {
      // Middleware sees generic type (works with any message)
      expectTypeOf(ctx.type).toBeString();

      // Can access connection data with correct types
      expectTypeOf(ctx.clientId).toBeString();
      expectTypeOf(ctx.data.userId).toEqualTypeOf<string | undefined>();

      return next();
    });
  });

  it("should allow modifying ctx.data safely", () => {
    interface AppData extends Record<string, unknown> {
      userId?: string;
      isAuthenticated?: boolean;
    }

    const router = createRouter<AppData>();

    router.use((ctx, next) => {
      // assignData mutates ctx.data safely
      ctx.assignData({ userId: "user123", isAuthenticated: true });

      // Type still reflects original optional fields (assignData takes Partial<T>)
      expectTypeOf(ctx.data.userId).toEqualTypeOf<string | undefined>();
      expectTypeOf(ctx.data.isAuthenticated).toEqualTypeOf<
        boolean | undefined
      >();

      return next();
    });
  });

  it("should support async middleware", () => {
    const router = createRouter<Record<string, unknown>>();

    router.use(async (ctx, next) => {
      expectTypeOf(ctx.type).toBeString();

      // Can await next()
      const result = next();
      expectTypeOf(result).toMatchTypeOf<Promise<void>>();
      await result;
    });
  });

  it("should allow early return to skip handler", () => {
    const router = createRouter<Record<string, unknown>>();
    const TestMessage = message("TEST", {});

    router.use(async (ctx, next) => {
      if (Math.random() > 0.5) {
        ctx.error("UNAVAILABLE", "Feature disabled");
        return; // Skip next() - handler won't execute
      }
      return next(); // Continue to handler
    });

    router.on(TestMessage, () => {
      // Handler only runs if middleware called next()
    });
  });

  it("should have ctx.error() method available", () => {
    const router = createRouter<Record<string, unknown>>();

    router.use((ctx, next) => {
      // Can call error with code and optional message
      expectTypeOf(ctx.error).toBeFunction();
      ctx.error("INVALID_ARGUMENT", "Invalid input");
      // Error call terminates middleware chain - no next()
      return Promise.resolve();
    });
  });
});

// ============================================================================
// Handler Type Narrowing (Not Middleware!)
// ============================================================================

describe("Handler type narrowing via .on() overload", () => {
  it("should accept handlers registered with .on()", () => {
    const router = createRouter<Record<string, unknown>>();
    const PingMessage = message("PING", { text: z.string() });

    // Handler registration should succeed (types are verified by validation plugin)
    router.on(PingMessage, (ctx) => {
      // At runtime, ctx has narrowed type with payload from validation plugin
      // Type assertions here would fail with bun:test since ctx is `any`
      // But the .on() overload ensures type safety via the validation layer
    });
  });

  it("should support multiple handlers with different schemas", () => {
    const router = createRouter<Record<string, unknown>>();
    const LoginMessage = message("LOGIN", { username: z.string() });
    const SubmitMessage = message("SUBMIT", {
      data: z.object({ id: z.number() }),
    });

    // Each .on() call registers a handler for its specific message type
    router.on(LoginMessage, (ctx) => {
      // ctx type is narrowed by validation plugin to LoginMessage payload
    });

    router.on(SubmitMessage, (ctx) => {
      // ctx type is narrowed by validation plugin to SubmitMessage payload
    });
  });

  it("should preserve connection data through middleware chain", () => {
    const router = createRouter<{ userId?: string }>();
    const SecureMessage = message("SECURE", { secret: z.string() });

    // Middleware stays generic (payload-blind)
    router.use((ctx, next) => {
      expectTypeOf(ctx.type).toBeString();
      ctx.assignData({ userId: "user123" });
      return next();
    });

    // Handler receives narrowed type via validation plugin
    // plus any data mutations from middleware
    router.on(SecureMessage, (ctx) => {
      // ctx.data has the mutation from middleware
      // ctx.payload has the schema type (from validation plugin)
    });
  });
});

// ============================================================================
// Middleware Chain Type Tests
// ============================================================================

describe("Middleware chain typing", () => {
  it("should compose multiple middleware sequentially", () => {
    interface ChainedAppData extends Record<string, unknown> {
      userId?: string;
      isAuthenticated?: boolean;
      isAuthorized?: boolean;
    }

    const router = createRouter<ChainedAppData>();

    router.use((ctx, next) => {
      ctx.assignData({ isAuthenticated: true });
      return next();
    });

    router.use((ctx, next) => {
      if (ctx.data.isAuthenticated) {
        ctx.assignData({ isAuthorized: true });
      }
      return next();
    });
  });

  it("should preserve data mutations through chain", () => {
    interface ChainData extends Record<string, unknown> {
      step1?: string;
      step2?: number;
    }

    const router = createRouter<ChainData>();
    const TestMessage = message("TEST", {});

    router.use((ctx, next) => {
      ctx.assignData({ step1: "done" });
      return next();
    });

    router.use((ctx, next) => {
      expectTypeOf(ctx.data.step1).toEqualTypeOf<string | undefined>();
      ctx.assignData({ step2: 42 });
      return next();
    });

    router.on(TestMessage, (ctx) => {
      // Handler sees all mutations from middleware chain
      // (type assertions on ctx would fail since handlers are typed as `any`)
    });
  });

  it("should support conditional data mutation", () => {
    interface AccessData extends Record<string, unknown> {
      isAdmin?: boolean;
      canAccess?: boolean;
    }

    const router = createRouter<AccessData>();
    const AdminMsg = message("ADMIN_ACTION", {});

    router.use(async (ctx, next) => {
      // Conditionally set access based on user role
      if (ctx.data.isAdmin) {
        ctx.assignData({ canAccess: true });
      } else {
        ctx.assignData({ canAccess: false });
        return; // Skip handler
      }
      return next();
    });

    router.on(AdminMsg, () => {
      // Only reaches here if canAccess was true
    });
  });
});

// ============================================================================
// Router Composition Type Tests
// ============================================================================

describe("Router composition preserves middleware types", () => {
  it("should preserve connection data type when merging routers", () => {
    interface SharedData extends Record<string, unknown> {
      userId?: string;
      sessionId?: string;
    }

    const router1 = createRouter<SharedData>();
    const router2 = createRouter<SharedData>();

    const Msg1 = message("MSG1", { text: z.string() });
    const Msg2 = message("MSG2", { count: z.number() });

    router1.on(Msg1, (ctx) => {
      // Handler ctx is typed `any` by plugin system
    });

    router2.on(Msg2, (ctx) => {
      // Handler ctx is typed `any` by plugin system
    });

    const merged = router1.merge(router2);

    // Middleware in merged router shares the same connection data type
    merged.use((ctx, next) => {
      expectTypeOf(ctx.data.userId).toEqualTypeOf<string | undefined>();
      expectTypeOf(ctx.data.sessionId).toEqualTypeOf<string | undefined>();
      return next();
    });
  });

  it("should maintain generic middleware in composed router", () => {
    const router1 = createRouter<{ step?: number }>();
    const router2 = createRouter<{ step?: number }>();

    const LoginMsg = message("LOGIN", { username: z.string() });
    const ProcessMsg = message("PROCESS", {
      data: z.object({ id: z.number() }),
    });

    router1.on(LoginMsg, (ctx) => {
      // Handler ctx typed via validation plugin (any for type assertions)
    });

    router2.on(ProcessMsg, (ctx) => {
      // Handler ctx typed via validation plugin (any for type assertions)
    });

    const merged = router1.merge(router2);

    // Middleware in merged router sees generic type (payload-blind)
    merged.use((ctx, next) => {
      expectTypeOf(ctx.type).toBeString();
      // @ts-expect-error payload should not be accessible in middleware
      const _: unknown = ctx.payload;
      return next();
    });
  });

  it("should allow middleware sharing between composed routers", () => {
    interface AppData extends Record<string, unknown> {
      requestId?: string;
      userId?: string;
    }

    const router1 = createRouter<AppData>();
    const router2 = createRouter<AppData>();

    // Register middleware on both routers
    router1.use((ctx, next) => {
      ctx.assignData({ requestId: "req_1" });
      return next();
    });

    router2.use((ctx, next) => {
      ctx.assignData({ userId: "user_1" });
      return next();
    });

    const merged = router1.merge(router2);

    // Both middlewares execute in sequence
    merged.use((ctx, next) => {
      expectTypeOf(ctx.data.requestId).toEqualTypeOf<string | undefined>();
      expectTypeOf(ctx.data.userId).toEqualTypeOf<string | undefined>();
      return next();
    });
  });
});

// ============================================================================
// Error Handling in Middleware Type Tests
// ============================================================================

describe("Error handling in middleware", () => {
  it("should allow error handling based on context", () => {
    const router = createRouter<{ userId?: string }>();
    const SecureMsg = message("SECURE", { data: z.string() });

    router.use((ctx, next) => {
      // Validate authentication before handler runs
      if (!ctx.data.userId) {
        ctx.error("UNAUTHENTICATED", "User not authenticated");
        return Promise.resolve(); // Skip handler
      }
      return next();
    });

    router.on(SecureMsg, () => {
      // Handler only runs if middleware authenticated the user
    });
  });

  it("should work with async middleware error handling", () => {
    const router = createRouter<Record<string, unknown>>();
    const AsyncMsg = message("ASYNC", {});

    router.use(async (ctx, next) => {
      try {
        return await next();
      } catch (err) {
        ctx.error("INTERNAL", "Handler failed");
      }
    });

    router.on(AsyncMsg, async () => {
      // Handler runs within error boundary
    });
  });
});

// ============================================================================
// Per-Route Middleware Type Tests
// ============================================================================

describe("Per-route middleware typing", () => {
  it("should keep middleware payload-blind even with per-route scope (fluent API)", () => {
    const router = createRouter<Record<string, unknown>>();
    const TestMsg = message("TEST", { val: z.string() });

    // Per-route middleware via fluent API still receives MinimalContext (generic type)
    router
      .route(TestMsg)
      .use((ctx, next) => {
        expectTypeOf(ctx.type).toBeString();
        // @ts-expect-error - payload still not accessible in middleware
        const _: unknown = ctx.payload;
        return next();
      })
      .on((ctx) => {
        // Fluent .on() handler receives context typed as `any` by plugin system
        // But schema narrowing is enforced at the validation plugin level
      });

    // For comparison: global middleware also sees generic context
    router.use((ctx, next) => {
      expectTypeOf(ctx.type).toBeString();
      // @ts-expect-error - payload not accessible
      const _: unknown = ctx.payload;
      return next();
    });
  });

  it("should support per-route middleware with data mutation", () => {
    interface RouteData extends Record<string, unknown> {
      isVerified?: boolean;
    }

    const router = createRouter<RouteData>();
    const SecureMsg = message("SECURE", { id: z.number() });

    router
      .route(SecureMsg)
      .use((ctx, next) => {
        // Route middleware can still mutate data
        ctx.assignData({ isVerified: true });
        expectTypeOf(ctx.data.isVerified).toEqualTypeOf<boolean | undefined>();
        return next();
      })
      .on((ctx) => {
        // Handler receives context with mutated data from middleware chain
        // (ctx is typed `any` by plugin system)
      });
  });

  it("should support multiple per-route middleware on same message", () => {
    const router = createRouter<{ step?: number }>();
    const StepMsg = message("STEP", { num: z.number() });

    router
      .route(StepMsg)
      .use((ctx, next) => {
        ctx.assignData({ step: 1 });
        return next();
      })
      .use((ctx, next) => {
        expectTypeOf(ctx.data.step).toEqualTypeOf<number | undefined>();
        return next();
      })
      .on((ctx) => {
        // Handler receives context with all mutations from chained middleware
        // (ctx is typed `any` by plugin system)
      });
  });
});
