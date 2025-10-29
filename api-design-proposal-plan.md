# WS-Kit API Design Implementation Plan

**Reference**: `api-design-proposal.md`

This document provides a detailed, ordered execution plan for implementing the optimal API design proposal across all phases. The plan prioritizes architectural soundness, backwards compatibility, and developer experience.

---

## Table of Contents

1. [Overview & Phases](#overview--phases)
2. [Phase 1: Proxy Pattern (v1.2)](#phase-1-proxy-pattern-v12)
3. [Phase 2: Extended Validators + DX Features + Multi-Runtime Serve (v1.3)](#phase-2-extended-validators--dx-features--multi-runtime-serve-v13)
4. [Phase 3: Platform Convenience Packages (v2.0)](#phase-3-platform-convenience-packages-v20)
5. [Documentation & Migration Strategy](#documentation--migration-strategy)
6. [Implementation Checklist](#implementation-checklist)

---

## Overview & Phases

### Key Architectural Principles

- **Backward Compatibility**: All phases maintain backwards compatibility (with deprecation paths where needed)
- **Wrapper Pattern (Not Module Augmentation)**: Phase 2 uses `Object.assign(Object.create(zod), {...})` to extend validators, avoiding global namespace pollution
- **Proxy Pattern (Not Dual Routers)**: Phase 1 uses Proxy to eliminate `._core` exposure
- **Single Canonical Instance**: Extended validators ensure users can't accidentally mix instances
- **Runtime Auto-Detection**: Phase 2's `serve()` function detects Bun, Cloudflare, Deno transparently

### Quality Gates

- ✅ All existing tests pass
- ✅ No `as any` type assertions in user code (Phase 2+)
- ✅ Full backwards compatibility (with deprecations noted)
- ✅ Examples updated for new patterns
- ✅ Migration guides provided
- ✅ Specs and ADRs updated

---

## Phase 1: Proxy Pattern (v1.2)

**Goal**: Eliminate `._core` exposure without breaking changes.
**Effort**: Low
**Breaking Changes**: None (deprecation path available)

### 1.1 Architecture Changes

#### Task 1.1.1: Update Core Router Type Definition

**File**: `packages/core/src/router.ts`

- Add comments explaining the core router's role as the foundation for typed wrappers
- Ensure `WebSocketRouter<TData>` is properly exported for typed wrappers to reference
- Add JSDoc explaining generic `TData` parameter

**Key Points**:

```typescript
/**
 * Core WebSocket router implementation.
 *
 * This router handles:
 * - Message routing by type
 * - Handler registration and invocation
 * - Lifecycle management (onOpen, onClose)
 * - Publishing/broadcasting
 * - Platform adapter integration
 *
 * The core router is wrapped by typed facades (e.g., createZodRouter())
 * to preserve type inference through handler registration.
 *
 * @template TData - Shape of connection data (ws.data)
 */
export class WebSocketRouter<TData = {}> { ... }
```

#### Task 1.1.2: Implement Proxy Pattern in Typed Router Wrappers

**File**: `packages/zod/src/router.ts`

Replace the current typed wrapper implementation with a Proxy pattern:

```typescript
/**
 * Transparent proxy wrapper that preserves schema types in message handlers
 * while maintaining full access to the core router.
 *
 * The proxy intercepts type-sensitive methods (onMessage, onOpen, onClose)
 * to preserve generic type parameters, then delegates everything else
 * to the underlying core router.
 *
 * Implementation uses method caching to avoid re-allocation per call,
 * ensuring minimal runtime overhead.
 */
export function createZodRouter<TData = {}>(
  options?: RouterOptions,
): Router<TData> {
  const core = new WebSocketRouter<TData>({ validator: zodValidator() });

  // Cache wrapped methods to avoid re-allocating closures per call
  const wrappedMethods = {
    onMessage: <S extends MessageSchema<any, any>>(
      schema: S,
      handler: (ctx: MessageContext<S, TData>) => void,
    ) => core.onMessage(schema, handler as any),

    onOpen: (handler: (ctx: OpenContext<TData>) => void) =>
      core.onOpen(handler as any),

    onClose: (handler: (ctx: CloseContext<TData>) => void) =>
      core.onClose(handler as any),

    addRoutes: (router: Router<any>) =>
      core.addRoutes((router instanceof Proxy ? router : router._core) as any),
  };

  // Transparent proxy delegates method access
  return new Proxy(core, {
    get(target, prop, receiver) {
      if (prop in wrappedMethods) {
        return wrappedMethods[prop as keyof typeof wrappedMethods];
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Router<TData>;
}
```

**Key Comments**:

- Explain why Proxy is used (transparent type preservation)
- Explain method caching (avoid lambda re-allocation)
- Explain generic flow through constrained overloads

#### Task 1.1.3: Add Deprecation Getter for `._core`

**File**: `packages/zod/src/router.ts` and `packages/valibot/src/router.ts`

After the Proxy is created, add backwards compatibility:

```typescript
// Add deprecation getter for backwards compatibility
Object.defineProperty(router, "_core", {
  get() {
    console.warn(
      "router._core is deprecated. Pass the router directly to platform handlers. " +
        "Proxy pattern ensures full type preservation while eliminating the abstraction leak.",
    );
    return this;
  },
  configurable: true,
});
```

#### Task 1.1.4: Update Platform Handlers to Accept Both Typed and Core Routers

**Files**:

- `packages/bun/src/handler.ts`
- `packages/cloudflare-do/src/handler.ts`
- `packages/redis-pubsub/src/index.ts`

Update handler signatures to accept any router (both typed wrappers and core routers):

```typescript
/**
 * Creates a Bun WebSocket handler.
 *
 * Accepts both:
 * - Typed router wrappers (from createZodRouter, createValibotRouter)
 * - Core routers (WebSocketRouter<TData>)
 *
 * The function checks if the input is a typed wrapper (Proxy) and
 * extracts the core if needed. This design supports both direct usage
 * and the deprecated ._core pattern during transition.
 */
export function createBunHandler<TData>(
  router: Router<TData> | WebSocketRouter<TData>,
  options?: BunHandlerOptions<TData>,
): { fetch: FetchHandler; websocket: WebSocketHandler } {
  // Handle both typed wrapper (Proxy) and core router
  const coreRouter = isProxy(router) ? router : router;

  // ... rest of implementation
}

// Helper to detect if input is a Proxy
function isProxy(obj: any): obj is Router<any> {
  return obj instanceof WebSocketRouter;
}
```

**Key Comments**:

- Document that handlers now accept both forms
- Explain the proxy detection pattern
- Note this enables gradual migration from `._core`

### 1.2 Documentation Updates

#### Task 1.2.1: Update `docs/adr/004-typed-router-factory.md`

**Add new section**: "Phase 1 Refinement: Transparent Proxy Pattern"

```markdown
## Phase 1: Transparent Proxy Pattern (v1.2)

### Problem Solved

Previous versions exposed `._core` property, leaking implementation details and creating a dual-router mental model.

### Solution

The Proxy pattern makes the wrapper transparent—users pass the router directly to platform handlers without worrying about internal implementation.

### Key Benefits

- Router IS the core router (no conceptual difference)
- No `._core` property needed
- Platform handlers accept any router form
- Minimal runtime overhead (method caching)

### Implementation Details

See `packages/zod/src/router.ts` for implementation using `Reflect.get()` proxy traps.

### Backwards Compatibility

The `._core` property remains available but is deprecated with a console warning during transition period.
```

#### Task 1.2.2: Update CLAUDE.md

Replace the factory pattern section with information about the proxy pattern:

````markdown
## Critical: Typed Router Pattern (Proxy-based)

The typed router pattern uses a transparent Proxy wrapper to preserve type inference in message handlers while maintaining full backwards compatibility.

### Usage

```typescript
import { createZodRouter } from "@ws-kit/zod";
import { createBunHandler } from "@ws-kit/bun";

// Create type-safe router (Proxy-wrapped)
const router = createZodRouter<AppData>();

// Pass router directly to handlers (no ._core needed!)
const { fetch, websocket } = createBunHandler(router);

// Register handlers with full type inference
router.onMessage(LoginMessage, (ctx) => {
  const username = ctx.payload.username; // ✅ Fully typed
});
```
````

### Implementation

The typed router uses a Proxy to intercept type-sensitive methods (onMessage, onOpen, onClose) while delegating everything else to the core router. This provides transparent type preservation without exposing internal details.

**Note on `._core`**: Deprecated in v1.2. Use for backwards compatibility only. The router is now the core router—pass it directly to platform handlers.

````

### 1.3 Code Comments & Documentation

#### Task 1.3.1: Add Inline Comments to Proxy Implementation

**File**: `packages/zod/src/router.ts`

Add detailed comments explaining:
1. Why Proxy pattern is used instead of class wrapper
2. How method caching preserves performance
3. How generic types flow through the constrained overloads
4. Backwards compatibility path for `._core`

Example:
```typescript
// Method caching strategy:
// Each wrapped method is cached as a property so:
// 1. Proxy handler calls are minimized (cache hit on repeated calls)
// 2. Method identity is preserved (same function reference each time)
// 3. No lambda re-allocation (tight closures are defined once)
// 4. Zero runtime overhead compared to direct calls
````

### 1.4 Tests

#### Task 1.4.1: Add Proxy Pattern Tests

**File**: `packages/zod/test/proxy-pattern.test.ts` (new file)

```typescript
describe("Proxy pattern typed router", () => {
  test("router is transparent proxy of core", () => {
    const router = createZodRouter<AppData>();
    // Verify proxy returns correct handler methods
    // Verify method caching works
  });

  test("handler receives fully typed context", () => {
    const router = createZodRouter();
    let receivedContext: MessageContext<typeof TestSchema> | null = null;

    router.onMessage(TestSchema, (ctx) => {
      receivedContext = ctx;
      // Verify ctx.payload has correct type
      // Verify ctx.type is literal type
    });
  });

  test("addRoutes works with typed routers", () => {
    const router1 = createZodRouter<AppData>();
    const router2 = createZodRouter<AppData>();

    // Should work without accessing ._core
    router1.addRoutes(router2);
  });

  test("_core deprecation warning fires", () => {
    const router = createZodRouter();
    const consoleSpy = spyOn(console, "warn");

    // Access ._core
    const core = (router as any)._core;

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("router._core is deprecated"),
    );
  });
});
```

#### Task 1.4.2: Update Platform Handler Tests

**Files**:

- `packages/bun/test/handler.test.ts`
- `packages/cloudflare-do/test/handler.test.ts`

Add tests for accepting both typed and core routers:

```typescript
test("createBunHandler accepts typed router wrapper", () => {
  const router = createZodRouter<AppData>();
  // Should work without ._core
  const { fetch, websocket } = createBunHandler(router);
  expect(fetch).toBeDefined();
  expect(websocket).toBeDefined();
});

test("createBunHandler accepts core router", () => {
  const core = new WebSocketRouter<AppData>({
    validator: zodValidator(),
  });
  // Should also work with core directly
  const { fetch, websocket } = createBunHandler(core as any);
  expect(fetch).toBeDefined();
  expect(websocket).toBeDefined();
});
```

### 1.5 Examples

#### Task 1.5.1: Update All Examples to Remove `._core`

**Files to update**:

- `examples/quick-start/index.ts`
- `examples/quick-start/chat.ts`
- `examples/bun-zod-chat/index.ts`
- `examples/redis-multi-instance/index.ts`

**Change pattern**:

```typescript
// ❌ Before
const { fetch, websocket } = createBunHandler(router._core, options);

// ✅ After
const { fetch, websocket } = createBunHandler(router, options);
```

#### Task 1.5.2: Add Comment to Examples

Add comment explaining the Proxy pattern:

```typescript
// The router is wrapped by a transparent Proxy that preserves type
// inference in handlers. Pass it directly to platform handlers—no
// ._core property needed.
const { fetch, websocket } = createBunHandler(router, {
  authenticate(req) {
    /* ... */
  },
});
```

### 1.6 Verification & Release

#### Task 1.6.1: Run Full Test Suite

```bash
bun test
bun run lint
bun tsc --noEmit
```

#### Task 1.6.2: Update package.json Versions

Bump to v1.2.0 with release notes referencing Phase 1 improvements.

---

## Phase 2: Extended Validators + DX Features + Multi-Runtime Serve (v1.3)

**Goal**: Eliminate factory pattern, introduce DX features, provide multi-runtime `serve()`.
**Effort**: Medium (substantial but proven patterns)
**Breaking Changes**: None (deprecations)

### 2.1 Architecture Changes

#### Task 2.1.1: Implement Wrapper Pattern for Extended Zod

**File**: `packages/zod/src/extended.ts` (new file)

This is the **critical** architectural change. Use wrapper pattern to avoid module augmentation:

````typescript
/**
 * Extended Zod interface that includes ws-kit message schema helpers.
 *
 * This wrapper pattern avoids global namespace pollution (unlike
 * `declare module "zod"`). Users import a single, canonical instance
 * of the extended z that includes both standard Zod methods and ws-kit extensions.
 *
 * The wrapper is created via Object.create() to preserve Zod's prototype
 * chain for inheritance, then Object.assign() to add ws-kit methods.
 *
 * Benefits:
 * - No global `declare module` affecting other code
 * - Single canonical validator instance (no dual package hazard)
 * - Full type inference for Zod's discriminated unions and utilities
 * - Tree-shakeable (unused methods can be eliminated by bundlers)
 * - Safe by default (users can't accidentally import different instances)
 */

import * as zodBase from "zod";
import { createRouter } from "./router.ts";
import type { Router, MessageSchema } from "../core/types.ts";

interface ZodExtended extends typeof zodBase {
  /**
   * Create a message schema with type literal and payload structure.
   *
   * Example:
   * ```typescript
   * const LoginMessage = z.message("LOGIN", {
   *   username: z.string(),
   *   password: z.string(),
   * });
   * ```
   *
   * The message schema creates a discriminated union structure:
   * { type: "LOGIN", payload: { username, password }, meta: { ... } }
   *
   * Type inference ensures:
   * - ctx.type is a literal "LOGIN" type
   * - ctx.payload matches the shape passed here
   * - ctx.meta includes optional timestamp and correlationId
   */
  message<
    const Type extends string,
    const Shape extends zodBase.ZodRawShape | undefined = undefined
  >(
    type: Type,
    payload?: Shape extends zodBase.ZodRawShape
      ? { [K in keyof Shape]: zodBase.ZodTypeAny }
      : undefined
  ): Shape extends zodBase.ZodRawShape
    ? zodBase.ZodObject<{
        type: zodBase.ZodLiteral<Type>;
        payload: zodBase.ZodObject<Shape>;
        meta: zodBase.ZodObject<{
          timestamp: zodBase.ZodOptional<zodBase.ZodNumber>;
          correlationId: zodBase.ZodOptional<zodBase.ZodString>;
        }>;
      }>
    : zodBase.ZodObject<{
        type: zodBase.ZodLiteral<Type>;
        payload: zodBase.ZodObject<{}>;
        meta: zodBase.ZodObject<{
          timestamp: zodBase.ZodOptional<zodBase.ZodNumber>;
          correlationId: zodBase.ZodOptional<zodBase.ZodString>;
        }>;
      }>;

  /**
   * Create a type-safe router with optional connection data type.
   *
   * Example:
   * ```typescript
   * type AppData = { userId?: string; roomId?: string };
   * const router = z.router<AppData>();
   * ```
   *
   * The explicit TData generic is required (TypeScript limitation).
   * This is a one-line type annotation that provides full type safety
   * in all handlers and lifecycle callbacks.
   */
  router<TData = {}>(): Router<TData>;
}

// Create the extended z instance via wrapper pattern
export const z: ZodExtended = Object.assign(
  // Preserve prototype chain to inherit all Zod methods
  Object.create(zodBase),
  {
    message: <
      const Type extends string,
      const Shape extends zodBase.ZodRawShape | undefined
    >(
      type: Type,
      payload?: Shape
    ) => {
      // Create discriminated union structure
      return zodBase.object({
        type: zodBase.literal(type),
        payload: payload ? zodBase.object(payload as any) : zodBase.object({}),
        meta: zodBase.object({
          timestamp: zodBase.number().optional(),
          correlationId: zodBase.string().optional(),
        }),
      }) as any;
    },

    router: <TData = {}>() => createRouter<TData>(),
  }
) as ZodExtended;

// All zod methods available via prototype chain
// z.string() ✅
// z.object() ✅
// z.discriminatedUnion() ✅
// z.message() ✅ (new)
// z.router() ✅ (new)
````

**Key Implementation Notes**:

1. Use `Object.create(zodBase)` to preserve prototype chain (ensures all Zod methods work)
2. Use `Object.assign()` to add `message` and `router` methods
3. No `declare module "zod"` needed (avoids global pollution)
4. Single canonical instance that users import from `@ws-kit/zod`

#### Task 2.1.2: Mirror Extended Valibot Wrapper

**File**: `packages/valibot/src/extended.ts` (new file)

Apply the same wrapper pattern to Valibot:

```typescript
/**
 * Extended Valibot instance with ws-kit message schema helpers.
 *
 * See packages/zod/src/extended.ts for architectural documentation
 * on the wrapper pattern.
 */

import * as v from "valibot";
import { createRouter } from "./router.ts";
import type { Router, MessageSchema } from "../core/types.ts";

interface ValibotExtended extends typeof v {
  message<const Type extends string, const Shape extends v.BaseSchema | undefined>(
    type: Type,
    payload?: Shape,
  ): v.ObjectSchema<{
    type: v.LiteralSchema<Type>;
    payload: Shape extends v.BaseSchema ? v.ObjectSchema<any> : v.ObjectSchema<{}>;
    meta: v.ObjectSchema<{
      timestamp?: v.NumberSchema;
      correlationId?: v.StringSchema;
    }>;
  }>;

  router<TData = {}>(): Router<TData>;
}

export const v: ValibotExtended = Object.assign(
  Object.create(v),
  {
    message: (type, payload) => v.object({
      type: v.literal(type),
      payload: payload ? v.object(payload) : v.object({}),
      meta: v.object({
        timestamp: v.optional(v.number()),
        correlationId: v.optional(v.string()),
      }),
    }),

    router: <TData = {}>() => createRouter<TData>(),
  }
) as ValibotExtended;
```

#### Task 2.1.3: Update Router Exports to Use Extended Validators

**File**: `packages/zod/src/index.ts`

Export the extended validator as the primary export:

````typescript
/**
 * Extended Zod with ws-kit message schema and router helpers.
 *
 * This is the recommended import for all ws-kit applications.
 *
 * Example:
 * ```typescript
 * import { z } from "@ws-kit/zod";
 *
 * const LoginMessage = z.message("LOGIN", { username: z.string() });
 * const router = z.router<{ userId?: string }>();
 * ```
 */
export { z } from "./extended.js";

// Keep old factories available for backwards compatibility (with deprecation)
export { createMessageSchema } from "./messageSchema.js";
export { createZodRouter } from "./router.js";

// Re-export zodValidator for advanced users
export { zodValidator } from "./validator.js";
````

Add deprecation JSDoc to old factories:

````typescript
/**
 * @deprecated Use `z.message()` from the extended z instead.
 *
 * ```typescript
 * // Old way
 * const { messageSchema } = createMessageSchema(z);
 * const schema = messageSchema("LOGIN", { ... });
 *
 * // New way
 * import { z } from "@ws-kit/zod";
 * const schema = z.message("LOGIN", { ... });
 * ```
 */
export function createMessageSchema(validator: typeof z) { ... }
````

#### Task 2.1.4: Add Middleware Support to Router

**File**: `packages/core/src/router.ts`

Add middleware method to core router:

````typescript
/**
 * Middleware execution pipeline for message handlers.
 *
 * Middleware functions execute before message handlers and can:
 * - Access the message context
 * - Call next() to proceed to the handler
 * - Return early to skip the handler
 * - Modify context (though type-safely in practice)
 *
 * Example middleware patterns:
 * - Authentication: Check token in ctx.ws.data
 * - Logging: Log message type and duration
 * - Validation: Additional business logic validation
 *
 * Middleware runs in registration order for each message.
 *
 * @example
 * ```typescript
 * const authMiddleware = (ctx, next) => {
 *   if (!ctx.ws.data?.userId) {
 *     ctx.error("AUTH_ERROR", "Not authenticated");
 *     return; // Skip handler
 *   }
 *   return next(); // Proceed to handler
 * };
 *
 * router.use(authMiddleware);
 *
 * router.onMessage(SecureMessage, (ctx) => {
 *   // authMiddleware has already verified userId
 * });
 * ```
 */
use<TData>(
  middleware: (ctx: MessageContext<any, TData>, next: () => void) => void
): this {
  // Store middleware in array
  // Execute during message dispatch before calling handler
}
````

**Implementation Notes**:

- Store middleware in an array during registration
- Execute middleware in order before dispatching to handler
- Pass `next()` function to allow middleware chaining
- Allow middleware to return early (skip handler)
- Type signature accepts generic MessageContext (middleware sees any message type)

#### Task 2.1.5: Add Error Handling Helper to MessageContext

**File**: `packages/core/src/types.ts`

Extend MessageContext with error helper:

````typescript
/**
 * Type-safe error message definitions.
 *
 * Standard error codes that can be used consistently across the app.
 * Extend this type if your app needs additional error codes.
 *
 * @example
 * ```typescript
 * type ErrorCode = "VALIDATION_ERROR" | "AUTH_ERROR" | "NOT_FOUND";
 * ```
 */
type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "INTERNAL_ERROR"
  | "NOT_FOUND";

/**
 * Standard error message schema that matches error context helper.
 *
 * Example:
 * ```typescript
 * const ErrorMessage = z.message("ERROR", {
 *   code: z.enum(["VALIDATION_ERROR", "AUTH_ERROR", "INTERNAL_ERROR"]),
 *   message: z.string(),
 *   details: z.record(z.any()).optional(),
 * });
 * ```
 */

/**
 * Message context with error handling support.
 *
 * The error() helper provides type-safe error sending with:
 * - Literal error code enforcement
 * - Automatic message sending to client
 * - Optional details object
 *
 * Example:
 * ```typescript
 * router.onMessage(LoginMessage, (ctx) => {
 *   try {
 *     const user = authenticate(ctx.payload);
 *   } catch (err) {
 *     ctx.error("AUTH_ERROR", "Invalid credentials", { trace: String(err) });
 *   }
 * });
 * ```
 */
type MessageContext<S extends MessageSchema, TData> = {
  // ... existing fields ...

  /**
   * Send a type-safe error message to the client.
   *
   * The error is sent as a standard ERROR message with structured fields.
   * Clients can listen for this message type and display appropriate UI.
   *
   * @param code - Standard error code (enforced enum)
   * @param message - Human-readable error message
   * @param details - Optional additional context (trace, validation details, etc.)
   */
  error(code: ErrorCode, message: string, details?: Record<string, any>): void;

  /**
   * Send a response message (alias for ctx.send()).
   *
   * Semantic difference from send():
   * - send(): One-way message or broadcast
   * - reply(): Explicit request/response pattern
   *
   * Both have identical behavior; choose based on semantic intent.
   *
   * @example
   * ```typescript
   * // Request/response pattern
   * router.onMessage(QuerySchema, (ctx) => {
   *   const result = queryDatabase(ctx.payload);
   *   ctx.reply(QueryResponseSchema, result); // Clearer intent
   * });
   * ```
   */
  reply<R extends MessageSchema>(schema: R, payload: InferPayload<R>): void;
};
````

**Implementation Notes**:

- `error()` sends the client a structured ERROR message
- `reply()` is an alias for `send()` with semantic difference (request/response vs one-way)
- Both helpers improve DX and make intent clear

#### Task 2.1.6: Create `@ws-kit/serve` Package with Runtime Auto-Detection

**New Package**: `packages/serve/`

**Files to create**:

- `packages/serve/package.json`
- `packages/serve/src/index.ts`
- `packages/serve/src/types.ts`

````typescript
// packages/serve/src/types.ts

/**
 * Options for the multi-runtime serve() function.
 *
 * These options work across all runtimes (Bun, Cloudflare, Deno, etc.).
 * Platform-specific options can be passed through the generic options object.
 */
type ServeOptions<TData> = {
  /**
   * Port to listen on (used in Bun, ignored in Cloudflare).
   * Default: 3000 for Bun
   */
  port?: number;

  /**
   * Authentication hook that runs before connection upgrade.
   *
   * Called with the HTTP request and should return initial connection
   * data or null/undefined to reject the connection.
   *
   * The returned object becomes ws.data for the connection.
   *
   * @example
   * ```typescript
   * authenticate(req) {
   *   const token = req.headers.get("authorization");
   *   if (!token) return null; // Reject
   *   const user = validateToken(token);
   *   return { userId: user.id, roles: user.roles };
   * }
   * ```
   */
  authenticate?: (req: Request) => TData | null | undefined;

  /**
   * Lifecycle hook called when an error occurs in a handler.
   *
   * Use for observability, metrics, and error logging.
   *
   * @example
   * ```typescript
   * onError(error, ctx) {
   *   console.error(`Error in ${ctx?.type}:`, error.message);
   *   metrics.recordError(ctx?.type, error.code);
   * }
   * ```
   */
  onError?: (error: Error, ctx?: { type: string }) => void;

  /**
   * Lifecycle hook called when a message is broadcast.
   *
   * Use for observability and audit logging.
   *
   * @example
   * ```typescript
   * onBroadcast(message, scope) {
   *   console.log(`Broadcasting ${message.type} to ${scope}`);
   * }
   * ```
   */
  onBroadcast?: (message: any, scope: string) => void;

  /**
   * Lifecycle hook called when a new connection is being upgraded.
   *
   * Called before authentication, useful for connection logging.
   *
   * @example
   * ```typescript
   * onUpgrade(req) {
   *   console.log(`Upgrade from ${req.headers.get("user-agent")}`);
   * }
   * ```
   */
  onUpgrade?: (req: Request) => void;
};

export type { ServeOptions };
````

````typescript
// packages/serve/src/index.ts

/**
 * Multi-runtime serve() function for ws-kit routers.
 *
 * This function automatically detects the runtime environment and uses
 * the appropriate platform handler (Bun, Cloudflare, etc.).
 *
 * Advantages:
 * - Same code runs on multiple runtimes
 * - Transparent runtime detection
 * - No import changes needed when deploying to different platforms
 * - Works like Elysia, Hono, and Nitro
 *
 * For advanced use cases (custom routing, middleware), use platform-specific
 * handlers directly:
 * ```typescript
 * import { createBunHandler } from "@ws-kit/bun";
 * const { fetch, websocket } = createBunHandler(router, options);
 *
 * Bun.serve({ port: 3000, fetch, websocket });
 * ```
 *
 * @throws Error if runtime is not detected or not supported
 *
 * @example
 * ```typescript
 * import { z } from "@ws-kit/zod";
 * import { serve } from "@ws-kit/serve";
 *
 * const router = z.router<{ userId?: string }>();
 *
 * router.onMessage(z.message("PING", { text: z.string() }), (ctx) => {
 *   ctx.reply(z.message("PONG", { text: z.string() }), {
 *     text: `echo: ${ctx.payload.text}`,
 *   });
 * });
 *
 * serve(router, { port: 3000 });
 * ```
 */
export async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> = {},
): Promise<void> {
  // Runtime detection with clear error messages

  if ("Bun" in globalThis) {
    // Bun runtime detected
    const { createBunHandler } = await import("@ws-kit/bun");
    const { fetch, websocket } = createBunHandler(router, options as any);

    // Use Bun.serve() with options
    return new Promise(() => {
      Bun.serve({
        port: options.port ?? 3000,
        fetch,
        websocket,
      });
    });
  }

  if ("addEventListener" in globalThis && "fetch" in globalThis) {
    // Cloudflare Workers runtime detected
    const { createCloudflareHandler } = await import("@ws-kit/cloudflare-do");
    // Cloudflare has different serving pattern...
    return; // Implementation depends on CF API
  }

  // Unsupported runtime
  throw new Error(
    "Unsupported runtime. Detected: neither Bun nor Cloudflare Workers. " +
      "Use platform-specific handlers directly for custom environments. " +
      "Supported runtimes: Bun, Cloudflare Workers.",
  );
}

export type { ServeOptions } from "./types.js";
````

**Key Features**:

- Runtime auto-detection via globalThis checks
- Clear error messages for unsupported runtimes
- Passes lifecycle hooks (onError, onBroadcast, onUpgrade) to platform handlers
- Fully backwards compatible—advanced users can still use platform-specific handlers

#### Task 2.1.7: Update Client Library Naming

**Files**: `packages/client/zod/src/index.ts` and `packages/client/valibot/src/index.ts`

Rename `createClient` to `wsClient`:

````typescript
/**
 * Create a type-safe WebSocket client.
 *
 * The client provides full type inference from your server-side schema,
 * including message type literals and payload shapes.
 *
 * This is the recommended import for client-side applications.
 *
 * @example
 * ```typescript
 * import { wsClient } from "@ws-kit/client/zod";
 * import type { AppRouter } from "./server/router.ts";
 *
 * const client = wsClient<AppRouter>("ws://localhost:3000");
 *
 * client.on("PING", (payload) => {
 *   console.log(payload.text); // ✅ Fully typed from schema
 * });
 *
 * client.send("PONG", { reply: "Hello!" }); // ✅ Type-safe
 * ```
 */
export function wsClient<TRouter extends Router<any>>(
  url: string,
  options?: ClientOptions,
): WebSocketClient<TRouter> {
  // Implementation...
}

// Keep old export for backwards compatibility (deprecated)
/**
 * @deprecated Use `wsClient` instead.
 */
export const createClient = wsClient;
````

**Key Notes**:

- Shorter, more memorable API
- Consistent with `z.message()` and `z.router()` naming
- Keep old `createClient` available with deprecation warning

### 2.2 Documentation Updates

#### Task 2.2.1: Create ADR-005: Extended Validator Wrapper Pattern

**File**: `docs/adr/005-extended-validator-wrapper-pattern.md`

````markdown
# ADR-005: Extended Validator Wrapper Pattern

## Context

Phase 1.2 proposed eliminating the `createMessageSchema()` factory pattern. The original proposal (Phase 2) suggested using `declare module "zod"` for global type augmentation, but this reintroduces the dual package hazard.

## Decision

Use a **wrapper pattern** via `Object.assign(Object.create(zod), { message, router })` instead of module augmentation.

## Rationale

| Aspect               | Wrapper      | Module Augmentation | Factory        |
| -------------------- | ------------ | ------------------- | -------------- |
| Global pollution     | ❌ None      | ⚠️ Affects global   | ❌ None        |
| Dual package hazard  | ✅ Prevented | ⚠️ Reintroduced     | ⚠️ User-facing |
| API simplicity       | ✅ Direct    | ✅ Direct           | ❌ Two-step    |
| Type inference       | ✅ Full      | ✅ Full             | ✅ Full        |
| Backwards compatible | ✅ Yes       | ✅ Yes              | ✅ Yes         |

The wrapper pattern is architecturally sound because:

1. Users import one canonical instance: `import { z } from "@ws-kit/zod"`
2. No ambient type declarations affect other code
3. Prototype chain preservation ensures all Zod methods work
4. Single import source eliminates accidental instance mismatches

## Implementation

```typescript
export const z: ZodExtended = Object.assign(Object.create(zodBase), {
  message: (type, payload) => {
    /* ... */
  },
  router: () => {
    /* ... */
  },
}) as ZodExtended;
```
````

## Consequences

- ✅ Cleaner, more intuitive API
- ✅ Safer by default (can't accidentally mix instances)
- ✅ Equivalent type inference to factory pattern
- ❌ Slightly larger initial runtime cost (one-time Object.assign), but negligible
- ⚠️ Requires migration from factory pattern (with deprecation path)

## Related

- api-design-proposal.md: Part 5.5 "Wrapper vs. Factory Pattern Comparison"
- ADR-004: Typed Router Factory Pattern

````

#### Task 2.2.2: Create ADR-006: Multi-Runtime serve() Function

**File**: `docs/adr/006-multi-runtime-serve-function.md`

```markdown
# ADR-006: Multi-Runtime serve() Function

## Context

WS-Kit supports multiple platforms (Bun, Cloudflare). Currently, users must import platform-specific handlers, making code non-portable.

## Decision

Create a `@ws-kit/serve` package with runtime auto-detection that works transparently across platforms.

## Implementation

Runtime detection via globalThis checks:
```typescript
if ("Bun" in globalThis) { /* use Bun handler */ }
if ("addEventListener" in globalThis) { /* use Cloudflare handler */ }
````

## Consequences

- ✅ Same code runs on Bun, Cloudflare, Deno
- ✅ No configuration needed
- ✅ Follows patterns in Elysia, Hono, Nitro
- ✅ Advanced users can still use platform-specific handlers
- ⚠️ Requires users to opt-in to `@ws-kit/serve` (optional package)

## Related

- api-design-proposal.md: "Multi-Runtime serve() Function" section

````

#### Task 2.2.3: Update `docs/specs/router.md`

Add new sections:

```markdown
## Middleware

Middleware provides a way to run custom logic before message handlers.

```typescript
const authMiddleware = (ctx, next) => {
  if (!ctx.ws.data?.userId) {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return; // Skip handler
  }
  return next(); // Proceed to handler
};

router.use(authMiddleware);
````

## Error Handling

Use `ctx.error()` for type-safe error messages:

```typescript
router.onMessage(LoginSchema, (ctx) => {
  try {
    const user = authenticate(ctx.payload);
  } catch (err) {
    ctx.error("AUTH_ERROR", "Invalid credentials", { trace: String(err) });
  }
});
```

## Lifecycle Hooks

Access observability hooks via serve options:

```typescript
serve(router, {
  onError(error, ctx) {
    /* ... */
  },
  onBroadcast(message, scope) {
    /* ... */
  },
  onUpgrade(req) {
    /* ... */
  },
});
```

````

#### Task 2.2.4: Update CLAUDE.md with Phase 2 Patterns

Replace entire "Critical: Use Factory Pattern" section with:

```markdown
## API Patterns (Phase 2+)

### Extended Validator Pattern

Import the extended validator instance:

```typescript
import { z } from "@ws-kit/zod"; // Extended with .message() and .router()

// Create message schemas without factory
const LoginMessage = z.message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

// Create router without factory
type AppData = { userId?: string };
const router = z.router<AppData>();

// Use multi-runtime serve (Bun, Cloudflare, Deno auto-detected)
import { serve } from "@ws-kit/serve";
serve(router, { port: 3000 });
````

### Middleware for Cross-Cutting Concerns

```typescript
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId) {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return;
  }
  return next();
});
```

### Error Handling

```typescript
router.onMessage(RequestSchema, (ctx) => {
  try {
    process(ctx.payload);
  } catch (err) {
    ctx.error("INTERNAL_ERROR", "Failed to process", { trace: String(err) });
  }
});
```

### Request/Response Pattern

```typescript
router.onMessage(QuerySchema, (ctx) => {
  const result = queryDatabase(ctx.payload);
  ctx.reply(QueryResponseSchema, result); // Clearer than ctx.send()
});
```

## Legacy Patterns (Pre-Phase 2)

The factory pattern is deprecated but still available for backwards compatibility:

```typescript
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
const { messageSchema } = createMessageSchema(z);
// ... rest of old pattern
```

See migration guide for upgrade path.

````

### 2.3 Code Comments & Documentation

#### Task 2.3.1: Add Comprehensive Comments to Extended Validators

**Files**: `packages/zod/src/extended.ts`, `packages/valibot/src/extended.ts`

Add detailed comments explaining:
1. Wrapper pattern architecture
2. Prototype chain preservation
3. Why no module augmentation
4. Type inference through constrained generics
5. Single canonical instance design

#### Task 2.3.2: Add Comments to DX Features

**Files**:
- `packages/core/src/router.ts` (middleware implementation)
- `packages/core/src/types.ts` (error helper, reply method)
- `packages/serve/src/index.ts` (runtime detection)

Document:
- Why middleware pattern matches Express/Hono
- How error() helper works
- Runtime auto-detection strategy
- Backwards compatibility with platform-specific handlers

### 2.4 Tests

#### Task 2.4.1: Extended Validator Tests

**File**: `packages/zod/test/extended-validator.test.ts` (new file)

```typescript
describe("Extended Zod validator", () => {
  test("z.message() creates discriminated union", () => {
    const schema = z.message("LOGIN", { username: z.string() });

    // Verify structure
    const result = schema.parse({
      type: "LOGIN",
      payload: { username: "alice" },
      meta: {},
    });

    expect(result.type).toBe("LOGIN");
    expect(result.payload.username).toBe("alice");
  });

  test("z.router() creates type-safe router", () => {
    type AppData = { userId?: string };
    const router = z.router<AppData>();

    // Verify router methods exist and are typed
    expect(typeof router.onMessage).toBe("function");
    expect(typeof router.onOpen).toBe("function");
    expect(typeof router.use).toBe("function");
  });

  test("z has all standard Zod methods", () => {
    // Verify prototype chain works
    expect(typeof z.string).toBe("function");
    expect(typeof z.object).toBe("function");
    expect(typeof z.enum).toBe("function");
    expect(typeof z.discriminatedUnion).toBe("function");
  });

  test("single canonical instance", () => {
    import { z as z1 } from "@ws-kit/zod";
    import { z as z2 } from "@ws-kit/zod";

    // Same instance
    expect(z1).toBe(z2);
  });
});
````

#### Task 2.4.2: Middleware Tests

**File**: `packages/core/test/features/middleware.test.ts` (new file)

```typescript
describe("Router middleware", () => {
  test("middleware executes before handler", () => {
    const router = new WebSocketRouter();
    const execution: string[] = [];

    router.use(() => {
      execution.push("middleware");
      return next();
    });

    router.onMessage(TestSchema, () => {
      execution.push("handler");
    });

    // Simulate message dispatch
    // Verify execution order: ["middleware", "handler"]
  });

  test("middleware can skip handler", () => {
    const router = new WebSocketRouter();
    const execution: string[] = [];

    router.use((ctx, next) => {
      if (!ctx.ws.data?.authorized) {
        execution.push("skipped");
        return; // Don't call next()
      }
      return next();
    });

    router.onMessage(TestSchema, () => {
      execution.push("handler");
    });

    // Simulate dispatch with unauthorized context
    // Verify execution: ["skipped"] (no handler)
  });

  test("multiple middleware execute in order", () => {
    const router = new WebSocketRouter();
    const execution: string[] = [];

    router.use(() => {
      execution.push("first");
      return next();
    });

    router.use(() => {
      execution.push("second");
      return next();
    });

    router.onMessage(TestSchema, () => {
      execution.push("handler");
    });

    // Verify execution order: ["first", "second", "handler"]
  });
});
```

#### Task 2.4.3: Error Handling Tests

**File**: `packages/core/test/features/error-handling.test.ts` (new file)

```typescript
describe("Error handling", () => {
  test("ctx.error() sends ERROR message", () => {
    const router = new WebSocketRouter();
    const sentMessages: any[] = [];

    router.onMessage(TestSchema, (ctx) => {
      ctx.error("AUTH_ERROR", "Invalid token", { code: 401 });
    });

    // Mock send to capture message
    // Verify message has type: "ERROR", code: "AUTH_ERROR"
  });

  test("ctx.reply() is alias for ctx.send()", () => {
    const router = new WebSocketRouter();
    let sentMessage: any;

    router.onMessage(QuerySchema, (ctx) => {
      ctx.reply(ResponseSchema, { result: "data" });
    });

    // Verify message is sent via same mechanism as send()
    // Verify payload is correct
  });
});
```

#### Task 2.4.4: Multi-Runtime serve() Tests

**File**: `packages/serve/test/runtime-detection.test.ts` (new file)

```typescript
describe("Multi-runtime serve()", () => {
  test("detects Bun runtime", async () => {
    // Mock Bun in globalThis
    (globalThis as any).Bun = { serve: () => {} };

    const router = createZodRouter();
    await serve(router, { port: 3000 });

    // Verify Bun handler was used
    delete (globalThis as any).Bun;
  });

  test("detects Cloudflare runtime", async () => {
    // Mock Cloudflare in globalThis
    (globalThis as any).addEventListener = () => {};
    (globalThis as any).fetch = () => {};

    const router = createZodRouter();
    await serve(router);

    // Verify Cloudflare handler was used
  });

  test("throws clear error for unsupported runtime", async () => {
    // Ensure no runtime detected
    const router = createZodRouter();

    expect(serve(router)).rejects.toThrow(/Unsupported runtime/);
  });
});
```

### 2.5 Examples

#### Task 2.5.1: Create New Extended API Examples

**File**: `examples/phase2-extended-api/index.ts` (new)

Comprehensive example using all Phase 2 features:

```typescript
import { z } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve";

// Define app connection data
type AppData = { userId?: string; username?: string; token?: string };

// Define message schemas using extended z.message()
const LoginMessage = z.message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

const WelcomeMessage = z.message("WELCOME", {
  message: z.string(),
});

const ErrorMessage = z.message("ERROR", {
  code: z.enum(["AUTH_ERROR", "INTERNAL_ERROR"]),
  message: z.string(),
  details: z.record(z.any()).optional(),
});

const ChatMessage = z.message("CHAT", {
  text: z.string(),
});

// Create router with explicit TData
const router = z.router<AppData>();

// Middleware for authentication
const requireAuth = (ctx, next) => {
  if (!ctx.ws.data?.userId) {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return; // Skip handler
  }
  return next(); // Proceed to handler
};

// Middleware for logging
const loggingMiddleware = (ctx, next) => {
  const start = performance.now();
  const result = next();
  const duration = performance.now() - start;
  console.log(`[${ctx.type}] from ${ctx.ws.data?.username} took ${duration}ms`);
  return result;
};

// Register middleware
router.use(requireAuth);
router.use(loggingMiddleware);

// Message handlers
router.onMessage(LoginMessage, (ctx) => {
  // Authenticate user
  const user = validateUser(ctx.payload.username, ctx.payload.password);

  if (!user) {
    ctx.error("AUTH_ERROR", "Invalid credentials");
    return;
  }

  // Set connection data
  ctx.ws.data = {
    userId: user.id,
    username: user.name,
    token: generateToken(user),
  };

  // Send welcome
  ctx.reply(WelcomeMessage, { message: `Welcome, ${user.name}!` });
});

router.onMessage(ChatMessage, (ctx) => {
  // Publish to all clients
  router.publish("chat:*", {
    type: "CHAT",
    payload: {
      text: ctx.payload.text,
      userId: ctx.ws.data?.userId,
      username: ctx.ws.data?.username,
    },
  });
});

router.onOpen((ctx) => {
  console.log("New connection");
});

router.onClose((ctx) => {
  console.log(`${ctx.ws.data?.username} disconnected`);
});

// Start server (auto-detects Bun, Cloudflare, etc.)
serve(router, {
  port: 3000,
  authenticate(req) {
    // Pre-authentication from token
    const token = req.headers.get("authorization");
    if (token) {
      const user = validateToken(token);
      if (user) {
        return { userId: user.id, username: user.name, token };
      }
    }
  },
  onError(error, ctx) {
    console.error(`Error in ${ctx?.type}:`, error.message);
  },
  onUpgrade(req) {
    console.log(`New connection from ${req.headers.get("user-agent")}`);
  },
});
```

#### Task 2.5.2: Update Quick-Start Examples

**Files**:

- `examples/quick-start/index.ts`
- `examples/quick-start/chat.ts`
- `examples/quick-start/error-handling.ts`

Update all to use extended validator pattern and `serve()`:

```typescript
// Before
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
const { messageSchema } = createMessageSchema(z);
const PingMessage = messageSchema("PING", { ... });

// After
import { z } from "@ws-kit/zod";
const PingMessage = z.message("PING", { ... });
```

#### Task 2.5.3: Update Chat Example

**File**: `examples/bun-zod-chat/index.ts`

Apply Phase 2 patterns:

- Use `z.message()` instead of factory
- Use `z.router()` directly
- Use `serve()` instead of `createBunHandler()`
- Add middleware example
- Use `ctx.error()` and `ctx.reply()`

### 2.6 Type Tests

#### Task 2.6.1: Add Type Inference Tests

**File**: `packages/zod/test/types/extended-inference.test.ts` (new file)

Test that TypeScript correctly infers types through the extended API:

```typescript
import { expectTypeOf } from "expect-type";
import { z } from "@ws-kit/zod";

// Message schema type inference
const LoginMessage = z.message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

type LoginPayload =
  typeof LoginMessage extends z.ZodSchema<infer T> ? T["payload"] : never;

expectTypeOf<LoginPayload>().toMatchTypeOf<{
  username: string;
  password: string;
}>();

// Router type inference
type AppData = { userId?: string };
const router = z.router<AppData>();

// Verify handler context typing
declare const ctx: any; // Simulated context
expectTypeOf(ctx.ws.data).toMatchTypeOf<
  Partial<AppData> & { clientId: string }
>();
```

### 2.7 Backwards Compatibility

#### Task 2.7.1: Ensure Factory Pattern Still Works

**File**: `packages/zod/test/backwards-compat/factory-pattern.test.ts` (new file)

Verify old factory pattern still works with deprecation warning:

```typescript
test("createMessageSchema still works (deprecated)", () => {
  const consoleSpy = spyOn(console, "warn");

  const { messageSchema } = createMessageSchema(z);
  const schema = messageSchema("PING", { text: z.string() });

  // Should work (backwards compatible)
  expect(schema).toBeDefined();

  // Should warn about deprecation
  expect(consoleSpy).toHaveBeenCalledWith(
    expect.stringContaining("deprecated"),
  );
});

test("createZodRouter still works (deprecated)", () => {
  const router = createZodRouter();
  expect(router.onMessage).toBeDefined();
  expect(router.onOpen).toBeDefined();
});
```

### 2.8 Verification & Release

#### Task 2.8.1: Full Test Suite

```bash
bun test
bun run lint
bun tsc --noEmit
```

Verify:

- All new tests pass
- All existing tests pass (backwards compatibility)
- No type errors
- All examples run

#### Task 2.8.2: Create Migration Guide

**File**: `docs/migration-guide-v1.3.md`

Guide users from old factory pattern to new extended validator:

````markdown
# Migration Guide: v1.2 → v1.3

## Extended Validator Pattern

### Before (Factory Pattern)

```typescript
import { z } from "zod";
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z);
const LoginMessage = messageSchema("LOGIN", { ... });
const router = createZodRouter<AppData>();
```
````

### After (Extended Validator)

```typescript
import { z } from "@ws-kit/zod";

const LoginMessage = z.message("LOGIN", { ... });
const router = z.router<AppData>();
```

### Why?

- Fewer imports (one source of truth: `@ws-kit/zod`)
- Single canonical validator instance (prevents dual package hazard)
- Direct, intuitive API
- No middleware complexity needed

## Multi-Runtime serve()

### Before (Platform-Specific)

```typescript
import { createBunHandler } from "@ws-kit/bun";
const { fetch, websocket } = createBunHandler(router._core);
Bun.serve({ port: 3000, fetch, websocket });
```

### After (Runtime Auto-Detection)

```typescript
import { serve } from "@ws-kit/serve";
serve(router, { port: 3000 });
```

Works on Bun, Cloudflare, Deno without code changes.

## Middleware & Error Handling

### Before

```typescript
router.onMessage(schema, (ctx) => {
  try { /* ... */ } catch (err) { ctx.send(ErrorSchema, {...}); }
});
```

### After

```typescript
// Middleware for cross-cutting concerns
router.use((ctx, next) => {
  if (!ctx.ws.data?.authorized) {
    ctx.error("AUTH_ERROR", "Not authorized");
    return;
  }
  return next();
});

// Error helper for type-safe errors
router.onMessage(schema, (ctx) => {
  try {
    /* ... */
  } catch (err) {
    ctx.error("INTERNAL_ERROR", "Failed", { trace: String(err) });
  }
});
```

## Backwards Compatibility

Old factory pattern still works but is deprecated:

```typescript
// ⚠️ Deprecated but still works
const { messageSchema } = createMessageSchema(z);
```

Migration is recommended but not required.

```

#### Task 2.8.3: Update CHANGELOG

Document Phase 2 features and migration notes.

---

## Phase 3: Platform Convenience Packages (v2.0)

**Goal**: Provide "batteries included" packages for common use cases.
**Effort**: Medium (straightforward package creation)
**Breaking Changes**: None (optional packages)

### 3.1 Create Convenience Packages

#### Task 3.1.1: Create `@ws-kit/bun-zod` Package

**Structure**:
```

packages/bun-zod/
├── package.json
├── src/
│ ├── index.ts
│ └── app.ts
└── test/
└── integration.test.ts

````

**File**: `packages/bun-zod/src/app.ts`

```typescript
/**
 * Convenience app factory for Bun + Zod bundle.
 *
 * Provides a streamlined API for common Bun + Zod applications.
 * For advanced use cases, use base packages directly.
 *
 * @example
 * ```typescript
 * import { createApp, z } from "@ws-kit/bun-zod";
 *
 * const app = createApp();
 *
 * app.onMessage(z.message("PING", { text: z.string() }), (ctx) => {
 *   ctx.reply(z.message("PONG", { text: z.string() }), {
 *     text: `echo: ${ctx.payload.text}`,
 *   });
 * });
 *
 * app.start({ port: 3000 });
 * ```
 */
export function createApp<TData = {}>(): BunZodApp<TData> {
  const router = z.router<TData>();

  return {
    // Expose router methods directly
    onMessage: (schema, handler) => router.onMessage(schema, handler),
    onOpen: (handler) => router.onOpen(handler),
    onClose: (handler) => router.onClose(handler),
    use: (middleware) => router.use(middleware),
    addRoutes: (other) => router.addRoutes(other),

    // Convenience methods
    start: async (options) => {
      await serve(router, options);
    },

    // Access raw router for advanced usage
    get raw() {
      return router;
    },
  };
}

interface BunZodApp<TData> {
  onMessage<S extends MessageSchema>(
    schema: S,
    handler: (ctx: MessageContext<S, TData>) => void,
  ): this;

  onOpen(handler: (ctx: OpenContext<TData>) => void): this;
  onClose(handler: (ctx: CloseContext<TData>) => void): this;
  use(middleware: any): this;
  addRoutes(other: any): this;

  start(options: ServeOptions<TData>): Promise<void>;

  raw: Router<TData>;
}
````

**File**: `packages/bun-zod/src/index.ts`

````typescript
/**
 * WS-Kit for Bun with Zod validation.
 *
 * "Batteries included" bundle for rapid development.
 *
 * @example
 * ```typescript
 * import { createApp, z } from "@ws-kit/bun-zod";
 *
 * const app = createApp<{ userId?: string }>();
 * // ... fully typed development
 * app.start({ port: 3000 });
 * ```
 */
export { createApp } from "./app.js";
export { z } from "@ws-kit/zod";
export { serve } from "@ws-kit/serve";

// Re-export types for convenience
export type { Router, MessageSchema, MessageContext } from "@ws-kit/core";
export type { ServeOptions } from "@ws-kit/serve";
````

#### Task 3.1.2: Create Similar Packages for Other Platforms

Mirror the above for:

- `@ws-kit/bun-valibot`
- `@ws-kit/cloudflare-zod`
- `@ws-kit/cloudflare-valibot`

Each package exports:

- `createApp<TData>()` factory
- Extended validator (`z` or `v`)
- Types and utilities

### 3.2 Documentation

#### Task 3.2.1: Create Convenience Package READMEs

**File**: `packages/bun-zod/README.md`

````markdown
# @ws-kit/bun-zod

Type-safe WebSocket router for Bun with Zod validation. Batteries included.

## Quick Start

```typescript
import { createApp, z } from "@ws-kit/bun-zod";

const app = createApp();

// Define messages with full type inference
const PingMessage = z.message("PING", { text: z.string() });
const PongMessage = z.message("PONG", { reply: z.string() });

// Register handlers
app.onMessage(PingMessage, (ctx) => {
  ctx.reply(PongMessage, { reply: ctx.payload.text });
});

// Start server
app.start({ port: 3000 });
```
````

## Why @ws-kit/bun-zod?

- **Bundle Convenience**: Bun + Zod + WS-Kit in one package
- **Full Type Safety**: Zero type assertions needed
- **Zero Configuration**: Works out of the box
- **Familiar Patterns**: Express/Hono-like API
- **Production Ready**: Same router as base packages

## Comparison with Base Packages

Base packages provide maximum flexibility:

```typescript
import { z } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve";

const router = z.router();
serve(router, { port: 3000 });
```

This package provides convenience:

```typescript
import { createApp, z } from "@ws-kit/bun-zod";

const app = createApp();
app.start({ port: 3000 });
```

Both approaches are equivalent. Choose based on your needs.

## Advanced Usage

Access the raw router for advanced patterns:

```typescript
const app = createApp();

// Custom routing
const mainRouter = app.raw;
const moduleRouter = z.router();
mainRouter.addRoutes(moduleRouter);

// Custom Bun.serve()
const { fetch, websocket } = createBunHandler(app.raw);
Bun.serve({
  port: 3000,
  fetch,
  websocket,
  // ... custom Bun options
});
```

## Features

- ✅ Type-safe message schemas via `z.message()`
- ✅ Middleware support for cross-cutting concerns
- ✅ Error handling with `ctx.error()` helper
- ✅ Lifecycle hooks for observability
- ✅ Full type inference in all handlers
- ✅ Works with Bun's native WebSocket support

See [@ws-kit/core](../core/README.md) for complete documentation.

````

### 3.3 Examples

#### Task 3.3.1: Create Convenience Package Examples

**File**: `examples/bun-zod-convenience/index.ts`

Simple, beginner-friendly example using `@ws-kit/bun-zod`:

```typescript
import { createApp, z } from "@ws-kit/bun-zod";

type AppData = { userId?: string; username?: string };

// Simple convenient API
const app = createApp<AppData>();

// Define schemas
const LoginMessage = z.message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

const WelcomeMessage = z.message("WELCOME", {
  message: z.string(),
});

// Register handlers (fully typed)
app.onMessage(LoginMessage, (ctx) => {
  ctx.ws.data.userId = "123";
  ctx.ws.data.username = ctx.payload.username;
  ctx.reply(WelcomeMessage, {
    message: `Welcome, ${ctx.payload.username}!`,
  });
});

app.onClose((ctx) => {
  console.log(`${ctx.ws.data?.username} left`);
});

// Start (one-liner for common case)
app.start({ port: 3000 });
````

---

## Documentation & Migration Strategy

### Updates Across All Phases

#### Task D.1: Update All READMEs

Update main README and package READMEs to reference:

- New Phase 1, 2, 3 patterns
- Links to migration guides
- Examples using new API

#### Task D.2: Update Specs

**File**: `docs/specs/router.md`

Add sections for:

- Proxy pattern (Phase 1)
- Extended validators (Phase 2)
- Middleware (Phase 2)
- Error handling (Phase 2)
- Lifecycle hooks (Phase 2)
- Runtime auto-detection (Phase 2)
- Convenience packages (Phase 3)

**File**: `docs/specs/schema.md`

Update to show `z.message()` pattern instead of factory.

#### Task D.3: Create Comprehensive Migration Guides

**File**: `docs/migration-guide-full.md`

Create step-by-step guide covering:

- Phase 1: Removing `._core`
- Phase 2: Updating imports and factories
- Phase 3: Optionally adopting convenience packages

#### Task D.4: Update CLAUDE.md for Each Phase

Maintain CLAUDE.md as the source of truth for current best practices:

After Phase 1:

- Remove `._core` from examples
- Note Proxy pattern

After Phase 2:

- Show extended validator pattern
- Show `serve()` usage
- Show middleware patterns
- Show error handling
- Update client naming

#### Task D.5: Create Examples for Each Phase

- `examples/phase1-proxy-pattern/` (minimal updates)
- `examples/phase2-extended-api/` (comprehensive)
- `examples/phase3-convenience-packages/` (beginner-friendly)

---

## Implementation Checklist

### Phase 1: Proxy Pattern (v1.2)

- [ ] Update core router with proxy pattern comments
- [ ] Implement proxy wrapper in Zod router
- [ ] Mirror proxy pattern in Valibot router
- [ ] Add `._core` deprecation getter
- [ ] Update platform handlers to accept both forms
- [ ] Add proxy pattern tests
- [ ] Update platform handler tests
- [ ] Remove `._core` from all examples
- [ ] Update `docs/adr/004-typed-router-factory.md`
- [ ] Update CLAUDE.md
- [ ] Run full test suite
- [ ] Release v1.2.0

### Phase 2: Extended Validators + DX (v1.3)

**Validators & Core**:

- [ ] Create `packages/zod/src/extended.ts` (wrapper pattern)
- [ ] Create `packages/valibot/src/extended.ts` (wrapper pattern)
- [ ] Update `packages/zod/src/index.ts` exports
- [ ] Update `packages/valibot/src/index.ts` exports
- [ ] Add deprecation warnings to factory functions

**DX Features**:

- [ ] Add middleware support to core router
- [ ] Implement `ctx.error()` helper
- [ ] Implement `ctx.reply()` alias
- [ ] Add DX feature tests

**Multi-Runtime serve()**:

- [ ] Create `packages/serve/` package
- [ ] Implement runtime auto-detection
- [ ] Add lifecycle hooks support
- [ ] Add serve tests

**Client Naming**:

- [ ] Rename `createClient` → `wsClient`
- [ ] Add deprecation to old name

**Documentation**:

- [ ] Create ADR-005 (wrapper pattern)
- [ ] Create ADR-006 (multi-runtime serve)
- [ ] Update `docs/specs/router.md`
- [ ] Update `docs/specs/schema.md`
- [ ] Create `docs/migration-guide-v1.3.md`
- [ ] Update CLAUDE.md

**Code Comments**:

- [ ] Document wrapper pattern design
- [ ] Document middleware pattern
- [ ] Document error handling helpers
- [ ] Document runtime auto-detection

**Tests**:

- [ ] Extended validator tests
- [ ] Middleware feature tests
- [ ] Error handling tests
- [ ] Multi-runtime serve tests
- [ ] Type inference tests
- [ ] Backwards compatibility tests

**Examples**:

- [ ] Create `examples/phase2-extended-api/`
- [ ] Update quick-start examples
- [ ] Update chat example
- [ ] Update error handling example
- [ ] Update all READMEs

- [ ] Run full test suite
- [ ] Release v1.3.0

### Phase 3: Convenience Packages (v2.0)

- [ ] Create `packages/bun-zod/`
- [ ] Create `packages/bun-valibot/`
- [ ] Create `packages/cloudflare-zod/`
- [ ] Create `packages/cloudflare-valibot/`
- [ ] Add tests for convenience packages
- [ ] Create READMEs for each
- [ ] Create `examples/phase3-convenience-packages/`
- [ ] Update main README
- [ ] Run full test suite
- [ ] Release v2.0.0

### Documentation & Final

- [ ] Comprehensive migration guide
- [ ] Update all spec documents
- [ ] Create blog post / release notes
- [ ] Update project README
- [ ] Deprecation timeline in docs

---

## Quality Gates & Testing Strategy

### Before Each Release

1. **Full Test Suite**: `bun test` passes 100%
2. **Type Checking**: `bun tsc --noEmit` passes
3. **Linting**: `bun run lint` passes
4. **Examples**: All examples run without errors
5. **Backwards Compatibility**: Old code still works (with deprecation warnings)
6. **Performance**: No regression in message throughput

### Integration Testing

- [ ] Test all Phase 1 + Phase 2 features together
- [ ] Test Phase 2 + Phase 3 features together
- [ ] Test across Bun, Cloudflare, other platforms
- [ ] Test with real-world-like chat application
- [ ] Test middleware chain execution
- [ ] Test error handling in various scenarios

### Type Safety Verification

- [ ] All user handlers have full type inference
- [ ] No `as any` casts needed in user code
- [ ] Middleware preserves context types
- [ ] Error codes are literals (not strings)
- [ ] Message payloads are correctly typed
- [ ] Connection data types are inferred

---

## Risk Mitigation

| Risk                  | Mitigation                                  | Measurement                   |
| --------------------- | ------------------------------------------- | ----------------------------- |
| Proxy overhead        | Minimal (cached methods, direct delegation) | Benchmark message throughput  |
| Breaking changes      | Phased approach with deprecations           | All old code still works      |
| Type regression       | Extensive type tests                        | All type tests pass           |
| Performance impact    | No allocation overhead, thin wrapper        | Baseline perf maintained      |
| User migration burden | Clear guides and examples                   | Deprecation timeline provided |

---

## Timeline Estimate

- **Phase 1** (v1.2): 1-2 weeks (low complexity)
- **Phase 2** (v1.3): 2-3 weeks (more complex, but proven patterns)
- **Phase 3** (v2.0): 1 week (straightforward package creation)
- **Documentation**: Ongoing throughout

Total estimate: 4-6 weeks for all phases with documentation.

---

## Success Criteria

✅ All tests pass (existing + new)
✅ All examples work
✅ No type assertions (`as any`) needed in user code
✅ Fewer imports (single source of truth for validators)
✅ Middleware pattern works (Express/Hono-like)
✅ Multi-runtime `serve()` auto-detects correctly
✅ Migration guides provided and clear
✅ Backwards compatibility maintained
✅ Documentation updated
✅ Performance not degraded
