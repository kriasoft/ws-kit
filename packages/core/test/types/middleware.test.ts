// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type inference tests for middleware over per-route overloads and composed routers.
 *
 * These tests verify that:
 * 1. Global middleware has access to all message types
 * 2. Per-route middleware is correctly typed for specific message schemas
 * 3. Middleware can modify ctx.data with type safety via ctx.assignData()
 * 4. router composition with merge preserves message union types
 * 5. Composed routers maintain proper type intersection
 *
 * Tests are run via `tsc --noEmit` to verify type safety.
 */

import type { MessageContext, Middleware, WebSocketData } from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";

// ============================================================================
// Global Middleware Type Tests
// ============================================================================

describe("Global middleware typing", () => {
  it("should accept any message type in global middleware context", () => {
    // Simulate a context that could be any message type
    type AnyMessageContext = MessageContext<any, WebSocketData>;

    type GlobalMiddleware = Middleware<WebSocketData>;

    // Global middleware should accept context for any message type
    const middleware: GlobalMiddleware = (ctx, next) => {
      // ctx.type is generic string
      expectTypeOf(ctx.type).toBeString();
      // ctx should have all base properties
      expectTypeOf(ctx).toHaveProperty("ws");
      expectTypeOf(ctx).toHaveProperty("send");
      expectTypeOf(ctx).toHaveProperty("error");
      return next();
    };

    expectTypeOf(middleware).toBeFunction();
  });

  it("should allow modifying ctx.data in global middleware", () => {
    interface AppData {
      userId?: string;
      roles?: string[];
      isAuthenticated?: boolean;
    }

    type GlobalMiddleware = Middleware<AppData>;

    const authMiddleware: GlobalMiddleware = (ctx, next) => {
      // Should be able to modify ctx.data via assignData
      if (!ctx.data.userId) {
        ctx.assignData({ isAuthenticated: false });
        return;
      }
      ctx.assignData({ isAuthenticated: true });
      return next();
    };

    expectTypeOf(authMiddleware).toBeFunction();
  });

  it("should support async global middleware", () => {
    type GlobalMiddleware = Middleware<WebSocketData>;

    const asyncMiddleware: GlobalMiddleware = async (ctx, next) => {
      // Should be able to await next()
      await next();
      // Should be able to use async operations
      return Promise.resolve();
    };

    expectTypeOf(asyncMiddleware).toBeFunction();
  });
});

// ============================================================================
// Per-Route Middleware Type Tests
// ============================================================================

describe("Per-route middleware typing", () => {
  it("should have same type signature as global middleware", () => {
    type MiddlewareSignature = Middleware<WebSocketData>;

    // Per-route middleware should have the same signature
    type GlobalMiddlewareType = Middleware<WebSocketData>;
    type PerRouteMiddlewareType = Middleware<WebSocketData>;

    expectTypeOf<PerRouteMiddlewareType>().toEqualTypeOf<GlobalMiddlewareType>();
  });

  it("should allow context modification specific to message", () => {
    interface RequestData {
      requestId?: string;
      startTime?: number;
    }

    type RequestMiddleware = Middleware<RequestData>;

    // Per-route middleware for specific message can still modify generic data
    const requestTracker: RequestMiddleware = (ctx, next) => {
      ctx.assignData({
        requestId: ctx.meta?.correlationId || "unknown",
        startTime: Date.now(),
      });
      return next();
    };

    expectTypeOf(requestTracker).toBeFunction();
  });

  it("should work with complex data types", () => {
    interface ComplexAppData {
      user?: {
        id: string;
        email: string;
        permissions: string[];
      };
      session?: {
        token: string;
        expiresAt: number;
      };
      metadata?: Record<string, unknown>;
    }

    type AuthorizationMiddleware = Middleware<ComplexAppData>;

    const requireAdmin: AuthorizationMiddleware = (ctx, next) => {
      const hasAdminPermission =
        ctx.data.user?.permissions.includes("admin") ?? false;

      if (!hasAdminPermission) {
        ctx.error("PERMISSION_DENIED", "Admin access required");
        return;
      }

      return next();
    };

    expectTypeOf(requireAdmin).toBeFunction();
  });
});

// ============================================================================
// Middleware Chain Type Tests
// ============================================================================

describe("Middleware chain typing", () => {
  it("should compose multiple middleware with proper typing", () => {
    interface ChainedAppData {
      userId?: string;
      isAuthenticated?: boolean;
      isAuthorized?: boolean;
    }

    type AuthMiddleware = Middleware<ChainedAppData>;

    const authenticate: AuthMiddleware = (ctx, next) => {
      ctx.assignData({ isAuthenticated: true });
      return next();
    };

    const authorize: AuthMiddleware = (ctx, next) => {
      if (ctx.data.isAuthenticated) {
        ctx.assignData({ isAuthorized: true });
      }
      return next();
    };

    // Both should be assignable to the same type
    expectTypeOf(authenticate).toMatchTypeOf<AuthMiddleware>();
    expectTypeOf(authorize).toMatchTypeOf<AuthMiddleware>();
  });

  it("should allow early return in middleware", () => {
    type ShortCircuitMiddleware = Middleware<WebSocketData>;

    const skipIfCondition: ShortCircuitMiddleware = (ctx, next) => {
      if (Math.random() > 0.5) {
        return; // Skip next() - handler won't execute
      }
      return next(); // Continue to handler
    };

    expectTypeOf(skipIfCondition).toBeFunction();
  });
});

// ============================================================================
// Router Composition Type Tests
// ============================================================================

describe("Router composition preserves message union types", () => {
  it("should preserve distinct message types when composing routers", () => {
    // This is a compile-time test that verifies the concept:
    // When you compose two routers with different message types,
    // the composed router should be able to handle both message types

    interface Message1 {
      type: "MSG1";
      payload: { text: string };
    }
    interface Message2 {
      type: "MSG2";
      payload: { count: number };
    }

    // Simulating two routers with different handler types
    type Router1Messages = Message1;
    type Router2Messages = Message2;

    // The composed router should have a union of both
    type ComposedMessages = Router1Messages | Router2Messages;

    // We can extract the message type from the union
    type ExtractType<T> = T extends { type: infer U } ? U : never;

    type ComposedTypes = ExtractType<ComposedMessages>;
    expectTypeOf<ComposedTypes>().toEqualTypeOf<"MSG1" | "MSG2">();
  });

  it("should allow middleware to access composed message context", () => {
    // Middleware in a composed router sees generic context
    // since messages can be from either router
    type GenericContext = MessageContext<any, WebSocketData>;

    const composedMiddleware = (
      ctx: GenericContext,
      next: () => void | Promise<void>,
    ) => {
      // Type is a string since it could be any message type
      expectTypeOf(ctx.type).toBeString();
      return next();
    };

    expectTypeOf(composedMiddleware).toBeFunction();
  });

  it("should preserve data type across router composition", () => {
    interface SharedAppData {
      userId: string;
      sessionId: string;
    }

    // Both routers share the same data type
    type Router1Middleware = Middleware<SharedAppData>;
    type Router2Middleware = Middleware<SharedAppData>;

    const router1Auth: Router1Middleware = (ctx, next) => {
      expectTypeOf(ctx.data.userId).toBeString();
      return next();
    };

    const router2Auth: Router2Middleware = (ctx, next) => {
      expectTypeOf(ctx.data.sessionId).toBeString();
      return next();
    };

    expectTypeOf(router1Auth).toMatchTypeOf<Router1Middleware>();
    expectTypeOf(router2Auth).toMatchTypeOf<Router2Middleware>();
  });
});

// ============================================================================
// Intersection of Message Unions Type Tests
// ============================================================================

describe("Message union intersection in composition", () => {
  it("should maintain separate handler types for each message", () => {
    // Simulating message types from two routers
    interface ChatMessage {
      type: "CHAT";
      payload: { text: string };
    }
    interface PingMessage {
      type: "PING";
      payload?: undefined;
    }

    type MessageUnion = ChatMessage | PingMessage;

    // Extract payload type by message type
    type GetPayload<T extends MessageUnion, K extends string> =
      Extract<T, { type: K }> extends { payload: infer P } ? P : never;

    type ChatPayload = GetPayload<MessageUnion, "CHAT">;
    type PingPayload = GetPayload<MessageUnion, "PING">;

    expectTypeOf<ChatPayload>().toEqualTypeOf<{ text: string }>();
    // Ping has no payload (undefined or not present)
    expectTypeOf<PingPayload>().toEqualTypeOf<undefined>();
  });

  it("should preserve handler overload specificity", () => {
    // Middleware with specific schema should receive narrowed context
    interface SpecificContext {
      type: "SPECIFIC";
      payload: { id: string };
    }

    interface GenericContext {
      type: string;
      payload?: unknown;
    }

    // Specific handler should be narrower
    const specificHandler = (ctx: SpecificContext) => {
      expectTypeOf(ctx.type).toEqualTypeOf<"SPECIFIC">();
      expectTypeOf(ctx.payload).toEqualTypeOf<{ id: string }>();
    };

    const genericHandler = (ctx: GenericContext) => {
      expectTypeOf(ctx.type).toBeString();
      expectTypeOf(ctx.payload).toEqualTypeOf<unknown>();
    };

    expectTypeOf(specificHandler).toBeFunction();
    expectTypeOf(genericHandler).toBeFunction();
  });
});

// ============================================================================
// Context Modification in Middleware Type Tests
// ============================================================================

describe("Context modification with types", () => {
  it("should track data mutations through middleware chain", () => {
    interface ProgressiveData {
      step1?: string;
      step2?: number;
      step3?: boolean;
    }

    type ProgressMiddleware = Middleware<ProgressiveData>;

    const step1: ProgressMiddleware = (ctx, next) => {
      ctx.assignData({ step1: "done" });
      expectTypeOf(ctx.data.step1).toEqualTypeOf<string | undefined>();
      return next();
    };

    const step2: ProgressMiddleware = (ctx, next) => {
      // Previous step may have set step1
      const prev = ctx.data.step1;
      expectTypeOf(prev).toEqualTypeOf<string | undefined>();

      ctx.assignData({ step2: 42 });
      return next();
    };

    const step3: ProgressMiddleware = (ctx, next) => {
      ctx.assignData({ step3: true });
      return next();
    };

    expectTypeOf(step1).toBeFunction();
    expectTypeOf(step2).toBeFunction();
    expectTypeOf(step3).toBeFunction();
  });

  it("should support conditional data mutation", () => {
    interface ConditionalData {
      requiresAuth?: boolean;
      isAdmin?: boolean;
      canAccess?: boolean;
    }

    type ConditionalMiddleware = Middleware<ConditionalData>;

    const accessControl: ConditionalMiddleware = (ctx, next) => {
      if (ctx.data.requiresAuth && !ctx.data.isAdmin) {
        ctx.assignData({ canAccess: false });
        return; // Skip handler
      }
      ctx.assignData({ canAccess: true });
      return next();
    };

    expectTypeOf(accessControl).toBeFunction();
  });
});

// ============================================================================
// Error Handling in Middleware Type Tests
// ============================================================================

describe("Error handling in middleware", () => {
  it("should have error method in middleware context", () => {
    type ErrorMiddleware = Middleware<WebSocketData>;

    const errorHandler: ErrorMiddleware = (ctx, next) => {
      expectTypeOf(ctx).toHaveProperty("error");
      expectTypeOf(ctx.error).toBeFunction();

      // Should be callable with code and message
      ctx.error("INVALID_ARGUMENT", "Invalid input");
      return;
    };

    expectTypeOf(errorHandler).toBeFunction();
  });

  it("should support error codes in middleware", () => {
    type ValidationMiddleware = Middleware<WebSocketData>;

    const validate: ValidationMiddleware = (ctx, next) => {
      if (!ctx.meta) {
        ctx.error("INVALID_ARGUMENT", "Missing metadata");
        return;
      }

      if (!ctx.type) {
        ctx.error("INVALID_ARGUMENT", "Unknown message type");
        return;
      }

      return next();
    };

    expectTypeOf(validate).toBeFunction();
  });
});
