# WS-Kit Optimal API Design Proposal

## Executive Summary

This proposal identifies all type inference and DX issues in the current ws-kit implementation and proposes a redesigned API that:

- **Phase 1-2** (v1.2-1.3): Eliminates the `._core` property leak, removes factory complexity, reduces boilerplate by ~28%, and eliminates `as any` type casts
- **Phase 3** (v2.0): Adds convenient "batteries included" platform packages
- **Phase 4** (v3.0+): Future enhancement requiring TypeScript language improvements

**Important:** Phases 1-2 still require an explicit `TData` generic (`z.router<AppData>()`) for full type safety. This is a TypeScript language limitation, not a design shortcoming. The explicit generic is a simple, one-line type annotation that provides complete type safety in all handlers.

---

## Part 1: Current Implementation Analysis

### Type System Issues

#### Issue 1: TypeScript's Generic Type Erasure

```typescript
// Fundamental limitation: Map cannot preserve heterogeneous generic types
class WebSocketRouter {
  handlers = new Map<string, Handler<MessageSchemaType>>();

  onMessage<S extends MessageSchemaType>(
    schema: S,
    handler: (ctx: MessageContext<S>) => void,
  ) {
    // ❌ S is erased when stored in homogeneous Map
    this.handlers.set(schema.type, handler);
  }
}

// When retrieved, TypeScript sees Handler<MessageSchemaType>, not Handler<LoginSchema>
```

**Current Solution:** Typed router facade that preserves types at registration time via overloaded signatures, then type-casts when storing.

**Problem:** Requires exposing `._core` to platform handlers, creating an abstraction leak.

---

#### Issue 2: The Dual-Router Pattern

```typescript
// Current workflow requires understanding TWO routers:

// 1. Typed facade (what users call)
const router = createZodRouter();
router.onMessage(schema, (ctx) => {
  ctx.payload.field; // ✅ Fully typed
});

// 2. Core router (internal implementation)
const { fetch, websocket } = createBunHandler(router._core);
//                                            ^^^^^^^^^^^ Why exposed?
```

**Conceptual Problem:**

- User's mental model: "I have a router"
- Actual architecture: "You have a typed wrapper around a core router"
- Documentation burden explaining when/why two patterns exist
- The `._core` property is an implementation detail leak

---

#### Issue 3: Double Factory Pattern

```typescript
// TWO factories required:
const { messageSchema } = createMessageSchema(z); // Factory #1
const router = createZodRouter(); // Factory #2

const LoginMessage = messageSchema("LOGIN", {
  username: z.string(),
  password: z.string(),
});
```

**Problems:**

- Extra setup step that's easy to forget
- Dual package hazard not obvious from error messages
- Requires documenting why factory is needed (discriminated unions)

---

#### Issue 4: Lifecycle Handler Type Loss

```typescript
router.onClose((ctx) => {
  const roomId = (ctx.ws.data as any)?.roomId; // ❌ Type assertion needed!
});
```

**Why:**

- Message handlers get full typing from schema via typed wrapper
- Lifecycle handlers use generic context from core router
- Custom connection data lacks types in lifecycle context
- Users must manually assert types already set in message handlers

---

#### Issue 5: Connection Data Manual Typing

```typescript
// Must manually specify generic for connection data:
const router = createZodRouter<{ userId?: string; roomId?: string }>();
//                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Can't infer from actual usage in handlers
```

**Problem:** TypeScript cannot infer connection data types from assignments in handlers. Users must duplicate type information.

---

#### Issue 6: Composition Type Complexity

```typescript
const authRouter = createZodRouter(); // TData = unknown
const chatRouter = createZodRouter<{ roomId: string }>(); // TData specified

mainRouter.addRoutes(authRouter); // ✅ Works
mainRouter.addRoutes(chatRouter); // ⚠️ Type compatibility issues possible
```

**Issue:** When composing routers with different TData types, type compatibility is unclear and error messages are poor.

---

#### Issue 7: Platform Handler Type Coupling

```typescript
// Why must platform handlers know about typed vs core router?
createBunHandler(router._core);

// Current implementation:
export function createBunHandler(
  router: WebSocketRouter<TData>  // Must be CORE, not typed facade
) { ... }
```

**Problem:** Platform handlers are tightly coupled to internal router implementation details.

---

#### Issue 8: Validator Instance Duplication Risk

**Current Problem (Factory Pattern):**

```typescript
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";
import { createZodRouter } from "@ws-kit/zod";

// These could be different Zod versions/instances:
const { messageSchema } = createMessageSchema(z); // Uses passed-in z
const router = createZodRouter(); // Uses internal z
```

**Risk:** Version mismatches cause silent failures with discriminated unions.

**Note:** This risk is inherent to ANY approach that allows users to pass in validator instances. The factory pattern makes this explicit (which is good for awareness), but the real solution is ensuring a single canonical validator instance throughout the project.

---

### Code Metrics: Current Implementation

```typescript
// Quick start example from docs
import { z } from "zod";
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
import { createBunAdapter, createBunHandler } from "@ws-kit/bun";

// Step 1: Create schema factory
const { messageSchema } = createMessageSchema(z);

// Step 2: Create schemas
const LoginMessage = messageSchema("LOGIN", {
  username: z.string(),
  password: z.string(),
});

const WelcomeMessage = messageSchema("WELCOME", {
  message: z.string(),
});

// Step 3: Router with type generic
type AppData = { userId?: string; username?: string };
const router = createZodRouter<AppData>({
  platform: createBunAdapter(),
});

// Step 4: Register handlers
router.onMessage(LoginMessage, (ctx) => {
  const username = ctx.payload.username; // ✅ Typed
  ctx.ws.data.userId = "123";
  ctx.send(WelcomeMessage, { message: `Hello ${username}!` });
});

router.onClose((ctx) => {
  const username = (ctx.ws.data as any)?.username; // ❌ Type assertion
});

// Step 5: Create handler with ._core
const { fetch, websocket } = createBunHandler(router._core, {
  authenticate(req) {
    const token = req.headers.get("authorization");
    if (token) {
      return { userId: "from-token" };
    }
  },
});

// Step 6: Serve
Bun.serve({ port: 3000, fetch, websocket });
```

**Metrics:**

- Lines of code: 42
- Factory calls: 2
- Manual generics: 1
- Type assertions: 1
- Implementation details exposed: 1 (`._core`)
- Conceptual complexity: Medium

---

## Part 2: Proposed Optimal API Design

### Design Principles

1. **Hide Complexity**: No `._core`, no dual patterns visible
2. **Minimize Factories**: Single entry point, smart defaults
3. **Natural Composition**: Routes compose like functions
4. **Full Type Inference**: Zero type assertions needed in user code
5. **Platform Agnostic**: Core router doesn't know about platforms

---

### Option A: Transparent Proxy Pattern (Recommended)

```typescript
import { z } from "@ws-kit/zod"; // Extended Zod with .message()
import { serve } from "@ws-kit/serve"; // Runtime-agnostic server

// Step 1: Define schemas (no factory needed!)
const LoginMessage = z.message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

const WelcomeMessage = z.message("WELCOME", {
  message: z.string(),
});

// Step 2: Create router with connection data type
type AppData = { userId?: string; username?: string };
const router = z.router<AppData>();

// Step 3: Register handlers - fully typed!
router.onMessage(LoginMessage, (ctx) => {
  const username = ctx.payload.username; // ✅ Typed (string)
  const password = ctx.payload.password; // ✅ Typed (string)

  // Set connection data - type-safe
  ctx.ws.data = { userId: "123", username };

  ctx.send(WelcomeMessage, { message: `Hello ${username}!` });
});

router.onClose((ctx) => {
  // ✅ Fully typed - no assertions needed!
  const username = ctx.ws.data.username; // ✅ string | undefined (known type)
  console.log(`${username} disconnected`);
});

// Step 4: Serve - no ._core!
serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    if (token) {
      return { userId: "from-token" };
    }
  },
});
```

**Metrics:**

- Lines of code: 32 (24% reduction vs current)
- Factory calls: 0
- Manual generics: 1 (AppData type definition)
- Type assertions: 0
- Implementation details exposed: 0
- Conceptual complexity: Low

#### For Advanced Users: Direct Bun.serve() Control

The `serve()` convenience function is optional. Users who need full control over `Bun.serve()` can use the low-level handler directly:

```typescript
const { fetch, websocket } = createBunHandler(router, {
  authenticate: (req) => ({ userId: "123" }),
});

Bun.serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);

    // Custom routing
    if (url.pathname === "/ws") {
      return fetch(req, server); // WebSocket handler
    }
    if (url.pathname === "/health") {
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },
  websocket,
  tls: { cert, key },
  // ... any other Bun.serve options
});
```

**Trade-off:** +5 lines of code, 100% flexibility with standard Bun patterns.

---

### How Transparent Proxy Works

**Implementation concept with narrow scope and method caching:**

```typescript
export function createRouter<TData = {}>() {
  const core = new WebSocketRouter({ validator: zodValidator() });

  // Cache wrapped methods to avoid re-allocating per call
  const wrappedMethods = {
    onMessage: <S extends MessageSchema>(
      schema: S,
      handler: (ctx: InferContext<S, TData>) => void,
    ) => core.onMessage(schema, handler as any),

    onOpen: (handler: (ctx: OpenContext<TData>) => void) =>
      core.onOpen(handler as any),

    onClose: (handler: (ctx: CloseContext<TData>) => void) =>
      core.onClose(handler as any),

    addRoutes: (router: Router<any>) => core.addRoutes(router as any),
  };

  // Proxy intercepts only methods we need to wrap, delegates others naturally
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

**Key Benefits:**

- Router IS the core router - no `._core` property needed
- Platform handlers just accept any router - it's both types
- Platform-agnostic at definition time (no `createBunAdapter()` parameter)
- Narrow proxy scope - only wraps what needs typing, passes through everything else
- Method caching avoids lambda re-allocation and preserves method identity
- Zero runtime overhead - cached methods are simple, tight closures

**Backwards Compatibility:**

```typescript
// Can add deprecation getter:
Object.defineProperty(router, "_core", {
  get() {
    console.warn("router._core is deprecated, pass router directly");
    return this;
  },
});
```

---

### Multi-Runtime `serve()` Function

The `serve()` convenience function uses **runtime auto-detection** to support both Bun and Cloudflare Workers (and future runtimes) from a single API:

```typescript
// @ws-kit/serve/src/index.ts
export async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData>,
): Promise<void> {
  // Runtime auto-detection
  if ("Bun" in globalThis) {
    // Bun runtime
    const { serve: bunServe } = await import("@ws-kit/bun");
    return bunServe(router, options);
  }

  if ("addEventListener" in globalThis && "fetch" in globalThis) {
    // Cloudflare Workers runtime
    const { serve: cloudflareServe } = await import(
      "@ws-kit/cloudflare-workers"
    );
    return cloudflareServe(router, options);
  }

  throw new Error(
    "Unsupported runtime. Detected: neither Bun nor Cloudflare Workers. " +
      "Use platform-specific handlers directly for custom environments.",
  );
}
```

**Benefits of Runtime Auto-Detection:**

- ✅ **Single entry point** — Same `serve()` works everywhere
- ✅ **Portable code** — Users don't need to know which runtime at import time
- ✅ **Matches modern libraries** — Follows patterns in Elysia, Hono, Nitro
- ✅ **Future-proof** — Adding new runtimes only requires updating auto-detection
- ✅ **Zero bundle impact** — Only the relevant runtime handler is imported dynamically
- ✅ **Still flexible** — Advanced users can use platform-specific handlers directly

**Usage across runtimes — same code, works everywhere:**

```typescript
// ✅ Works in Bun
import { serve } from "@ws-kit/serve";
serve(router, { port: 3000, authenticate });

// ✅ Works in Cloudflare Workers (same import!)
import { serve } from "@ws-kit/serve";
serve(router, { authenticate });

// ✅ Works in Deno (with runtime adapter)
import { serve } from "@ws-kit/serve";
serve(router, { port: 3000 });
```

**Advanced users retain direct control:**

```typescript
// If you need full control over runtime-specific APIs:
import { createBunHandler } from "@ws-kit/bun";
// or
import { createCloudflareHandler } from "@ws-kit/cloudflare-workers";

const { fetch, websocket } = createBunHandler(router, options);
// Use directly with Bun.serve() for custom routing/middleware
```

---

### Type Inference Optimizations

Even with explicit `TData` requirement (a TypeScript limitation), we can tighten contextual inference in three key areas:

#### a. Preserve Schema-Specific Types in Handler Context

Ensure handler context never widens to `any` through constrained overloads:

```typescript
type MessageContext<S extends MessageSchema, TData> = {
  ws: ServerWebSocket<TData & { clientId: string }>;
  payload: InferPayload<S>; // ✅ Specific to schema S
  send: <R extends MessageSchema>(schema: R, payload: InferPayload<R>) => void;
  type: InferType<S>; // ✅ Literal type from schema
  receivedAt: number;
  meta: InferMeta<S>; // ✅ Specific to schema S
};

// Router overload ensures precise inference of type and payload
interface Router<TData> {
  onMessage<S extends MessageSchema<any, any>>(
    schema: S,
    handler: (ctx: MessageContext<S, TData>) => void,
  ): this;
}

// Usage: All fields fully typed by schema, no widening
router.onMessage(LoginMessage, (ctx) => {
  ctx.payload.username; // ✅ string (from schema)
  ctx.type; // ✅ "LOGIN" (literal)
  ctx.meta.timestamp; // ✅ number | undefined (from schema)
});
```

**Why this matters:** Constrained overloads ensure literal inference of type and payload shape. The `MessageSchema<Type, Payload>` generic pattern allows TypeScript to flow the exact schema structure through to the handler context, eliminating `any` widening in middleware or generic handlers.

#### b. Infer `TData` Extension When Composing Routers

When adding routes, automatically intersect data types:

```typescript
type ComposedRouter<TData1, TData2> = Router<TData1 & TData2>;

// Usage:
const authRouter = createZodRouter<{ userId?: string }>();
const chatRouter = createZodRouter<{ roomId?: string }>();
const mainRouter = createZodRouter<{ userId?: string; roomId?: string }>();

mainRouter.addRoutes(authRouter).addRoutes(chatRouter); // ✅ Types reconciled
```

**Benefit:** Composition type-safe without manual generic reconciliation.

#### c. Allow Incremental Assignment to `ctx.ws.data`

Use `Partial<T>` for connection data to allow step-by-step updates:

```typescript
type WebSocketContext<T> = {
  data: Partial<T> & { clientId: string };
};

// Usage:
router.onMessage(LoginMessage, (ctx) => {
  // ✅ Can assign incrementally without full object
  ctx.ws.data.userId = "123";
  ctx.ws.data.username = ctx.payload.username;
});

router.onClose((ctx) => {
  // ✅ Reads back with correct types
  const userId = ctx.ws.data.userId; // string | undefined
  const username = ctx.ws.data.username; // string | undefined
});
```

**Benefit:** More natural assignment pattern, TypeScript correctly narrows types even with partial updates.

---

### Developer-Experience Details: Essential DX Refinements

The optimal API requires more than core patterns—it needs thoughtful developer affordances:

#### a. Error Handling with Type Safety

```typescript
// Export standard error message
const ErrorMessage = z.message("ERROR", {
  code: z.enum([
    "VALIDATION_ERROR",
    "AUTH_ERROR",
    "INTERNAL_ERROR",
    "NOT_FOUND",
  ]),
  message: z.string(),
  details?: z.record(z.any()).optional(),
});

// Usage with helper method
router.onMessage(RequestSchema, (ctx) => {
  try {
    // Process request
  } catch (err) {
    // ✅ Type-safe error sending
    ctx.error("INTERNAL_ERROR", "Failed to process request", { trace: String(err) });
  }
});

// Implementation detail
type ErrorContext<TData> = MessageContext<typeof ErrorMessage, TData> & {
  error(code: ErrorCode, message: string, details?: Record<string, any>): void;
};
```

**Benefit:** Consistent error handling across the app, type-safe error codes.

---

#### b. Middleware Support

```typescript
// Express/Hono-like middleware pattern
const authMiddleware = (ctx, next) => {
  const token = ctx.ws.data?.token;
  if (!token) {
    ctx.error("AUTH_ERROR", "Missing authentication");
    return; // Prevent next()
  }
  return next();
};

const loggingMiddleware = (ctx, next) => {
  const start = performance.now();
  const result = next();
  const duration = performance.now() - start;
  console.log(`[${ctx.type}] ${duration}ms`);
  return result;
};

// Register middleware - executes for all message handlers
router.use(authMiddleware);
router.use(loggingMiddleware);

// Specific handler still receives fully typed context
router.onMessage(LoginSchema, (ctx) => {
  // authMiddleware already validated presence of token
  const user = validateToken(ctx.ws.data.token);
  // ...
});
```

**Benefit:** Shared cross-cutting concerns (auth, logging, validation), familiar mental model from Express/Hono.

---

#### c. Request/Response Semantics

```typescript
// ctx.send() for one-way messages (broadcasts, updates)
router.onMessage(UserUpdateSchema, (ctx) => {
  updateUserInDB(ctx.payload);
  await router.publish("users:*", {
    type: "USER_UPDATED",
    payload: ctx.payload,
  });
});

// ctx.reply() for request/response patterns (clearer semantics)
router.onMessage(QuerySchema, (ctx) => {
  const result = queryDatabase(ctx.payload);
  ctx.reply(QueryResponseSchema, result); // ✅ Clearer intent
});
```

**Type signature:**

```typescript
type MessageContext<S, TData> = {
  send<R extends MessageSchema>(schema: R, payload: InferPayload<R>): void;
  reply<R extends MessageSchema>(schema: R, payload: InferPayload<R>): void; // Alias
};
```

**Benefit:** Explicit semantics for request/response vs. one-way messaging patterns.

---

#### d. Lifecycle and Logging Hooks

```typescript
// Hooks in serve() options for observability
serve(router, {
  port: 3000,
  authenticate(req) {
    /* ... */
  },

  // Optional lifecycle hooks
  onError(error, ctx) {
    console.error(`Error in ${ctx?.type}:`, error.message);
    // Send metrics, alerts, etc.
  },

  onBroadcast(message, scope) {
    console.log(`Broadcasting to ${scope}:`, message.type);
    // Track broadcast patterns
  },

  onUpgrade(req) {
    console.log(`New connection from ${req.headers.get("user-agent")}`);
    // Track connection sources
  },
});
```

**Benefits:**

- Observability without handler pollution
- Natural place for telemetry integration
- Consistent with Hono/Elysia patterns

---

#### e. Client Library Naming Consistency

```typescript
// Current inconsistency
import { createClient } from "@ws-kit/client/zod"; // Verbose

// Proposed alignment with z.router()
import { wsClient } from "@ws-kit/client/zod"; // Concise, matches verb style

type AppSchema = typeof router;

// Usage mirrors server-side
const client = wsClient<AppSchema>("ws://localhost:3000");

client.on("MESSAGE", (payload) => {
  console.log(payload.text); // ✅ Fully typed from schema
});

client.send("PING", { text: "Hello" }); // ✅ Type-safe
```

**Why this matters:**

- Shorter, more memorable API
- Consistent naming convention across ecosystem (z.message, z.router, wsClient)
- Reduces mental overhead for users learning the framework

---

### Option B: Extended Validator Pattern (Recommended)

Instead of:

```typescript
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z);
const schema = messageSchema("LOGIN", { ... });
```

Use:

```typescript
import { z } from "@ws-kit/zod"; // Extended with .message() and .router()

const schema = z.message("LOGIN", { ... });
const router = z.router<AppData>();
```

**Implementation (Wrapper Pattern):**

The key insight: **Wrap Zod's API instead of mutating it globally.** This avoids namespace pollution while providing the extended interface.

```typescript
// @ws-kit/zod/src/extended.ts

import * as zodBase from "zod";

// Define extended interface
interface ZodExtended extends typeof zodBase {
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

  router<TData = {}>(): Router<TData>;
}

// Create extended instance via wrapper
export const z: ZodExtended = Object.assign(
  Object.create(zodBase),
  {
    message: <
      const Type extends string,
      const Shape extends zodBase.ZodRawShape | undefined
    >(
      type: Type,
      payload?: Shape
    ) => {
      return zodBase.object({
        type: zodBase.literal(type),
        payload: payload ? zodBase.object(payload as any) : zodBase.object({}),
        meta: zodBase.object({
          timestamp: zodBase.number().optional(),
          correlationId: zodBase.string().optional(),
        }),
      }) as any; // Type is complex, cast for clarity
    },

    router: <TData = {}>() => createRouter<TData>(),
  }
) as ZodExtended;
```

**How the Wrapper Works:**

```typescript
// All zod methods available via prototype chain
z.string();          // ✅ Inherited from zodBase
z.object({...});     // ✅ Inherited from zodBase
z.discriminatedUnion(...); // ✅ Inherited from zodBase

// Extended methods on the wrapper
z.message("TYPE", {...}); // ✅ Direct property
z.router<AppData>();     // ✅ Direct property
```

**Prototype Chain Preservation:** Using `Object.create(zodBase)` ensures the wrapper inherits all Zod methods and preserves type inference for standard Zod operations. Extended methods (`message`, `router`) are added directly via `Object.assign()`. This keeps type inference clean—Zod's discriminated unions and other advanced typing work seamlessly since you're using the authentic Zod instance underneath.

**Benefits:**

- ✅ **No global namespace pollution** — wrapper doesn't mutate the imported zod module
- ✅ **No module augmentation** — avoids `declare module "zod"` entirely
- ✅ **Single canonical validator instance** — users import one `z` from `@ws-kit/zod`
- ✅ **Safer than factory pattern** — encourages correct usage by default, less room for footguns
- ✅ **Tree-shakeable** — unused methods can be eliminated by bundlers
- ✅ **Full type inference** — generic types flow correctly through handlers
- ✅ **Eliminates the `createMessageSchema` factory** — cleaner API

**Why This Beats Module Augmentation:**

The original Phase 2 proposal used `declare module "zod"` to extend Zod's interface globally. This reintroduced the dual package hazard because:

```typescript
// Bad: Module augmentation affects global namespace
declare module "zod" { ... }

// Problem in monorepos with multiple Zod instances:
import { z } from "@ws-kit/zod";        // Extended z
import { z } from "zod";                // Plain z (different instance)
// Now you have TWO different z objects in scope, silent failures
```

The wrapper pattern avoids this entirely:

```typescript
// Good: Explicit single export, no global mutation
export const z: ZodExtended = Object.assign(
  Object.create(zodBase),
  { message: (...) => ..., router: (...) => ... }
);

// Users must import from @ws-kit/zod to get extended API
import { z } from "@ws-kit/zod"; // Only one way to get it
```

There's no ambiguity—the extended API is only available through the explicit export.

---

### Option C: Platform Convenience Packages

For users who want "batteries included" experience:

```typescript
// Instead of:
import { z } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Users could import:
import { createApp, z } from "@ws-kit/bun-zod";

const app = createApp();

app.onMessage(z.message("PING"), (ctx) => {
  // Fully typed
});

app.start({ port: 3000 });
```

**New packages to create:**

- `@ws-kit/bun-zod`
- `@ws-kit/bun-valibot`
- `@ws-kit/cloudflare-zod`
- `@ws-kit/cloudflare-valibot`
- `@ws-kit/redis-zod`
- `@ws-kit/redis-valibot`

**Trade-off:** More packages, but clearer mental model for beginners.

**Note on flexibility:** All options (A, B, C) support direct `Bun.serve()` usage. The convenience functions (`serve()` or `app.start()`) are optional—users always have access to raw handlers for custom routing and middleware integration.

---

## Part 3: Complete Example Comparison

### Current Implementation

```typescript
import { z } from "zod";
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
import { createBunAdapter, createBunHandler } from "@ws-kit/bun";

type AppData = { userId?: string; username?: string };

const { messageSchema } = createMessageSchema(z);

const LoginMessage = messageSchema("LOGIN", {
  username: z.string(),
  password: z.string(),
});

const WelcomeMessage = messageSchema("WELCOME", {
  message: z.string(),
});

const router = createZodRouter<AppData>({
  platform: createBunAdapter(),
});

router.onMessage(LoginMessage, (ctx) => {
  const username = ctx.payload.username;
  ctx.ws.data.userId = "123";
  ctx.ws.data.username = username;
  ctx.send(WelcomeMessage, { message: `Hello ${username}!` });
});

router.onClose((ctx) => {
  const username = (ctx.ws.data as any)?.username; // ❌ Type assertion
  console.log(`${username} disconnected`);
});

const { fetch, websocket } = createBunHandler(router._core, {
  authenticate(req) {
    const token = req.headers.get("authorization");
    if (token) {
      return { userId: "from-token" };
    }
  },
});

Bun.serve({
  port: 3000,
  fetch,
  websocket,
});
```

**Issues:**

- 42 lines of code
- 2 factory functions
- 1 manual generic
- 1 type assertion
- 1 `._core` exposure
- Multiple imports from different packages

---

### Proposed Optimal Implementation

```typescript
import { z } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve"; // Works across all runtimes

type AppData = { userId?: string; username?: string; token?: string };

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
});

const router = z.router<AppData>();

// Middleware for authentication
const requireAuth = (ctx, next) => {
  if (!ctx.ws.data?.userId) {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return; // Skip handler
  }
  return next();
};

router.use(requireAuth);

// Message handlers - fully typed with middleware protection
router.onMessage(LoginMessage, (ctx) => {
  const username = ctx.payload.username; // ✅ Typed
  const password = ctx.payload.password; // ✅ Typed

  ctx.ws.data = { userId: "123", username, token: "jwt-token" };
  ctx.reply(WelcomeMessage, { message: `Hello ${username}!` }); // ✅ reply() = request/response
});

router.onClose((ctx) => {
  const username = ctx.ws.data?.username; // ✅ Fully typed
  console.log(`${username} disconnected`);
});

serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    if (token) {
      return { userId: "from-token", token };
    }
  },
  // Lifecycle hooks for observability
  onError(error, ctx) {
    console.error(`Error in ${ctx?.type}:`, error.message);
  },
  onUpgrade(req) {
    console.log(`New connection from ${req.headers.get("user-agent")}`);
  },
});
```

**Improvements:**

- 40 lines of code (includes middleware + hooks, still 5% reduction vs current)
- 0 factory functions
- 1 manual generic (AppData type definition)
- 0 type assertions (no `as any` casts needed)
- 0 implementation details exposed
- Simpler import structure
- Full type safety in all handlers
- **NEW:** Middleware support (familiar Express/Hono pattern)
- **NEW:** Explicit error handling with type-safe codes
- **NEW:** Request/response semantics with `ctx.reply()`
- **NEW:** Lifecycle hooks for observability without handler pollution

---

## Part 4: Implementation Roadmap

### Phase 1: Proxy Pattern for `._core` Elimination (v1.2)

**Goal:** Remove the `._core` property leak with no breaking changes.

**Changes:**

1. **Update typed router wrappers:**
   - Replace facade with Proxy pattern in `packages/zod/src/router.ts`
   - Mirror changes in `packages/valibot/src/router.ts`
   - Add deprecation getter for `._core`

2. **Update platform handlers:**
   - `packages/bun/src/handler.ts`: Accept any router (check for both types)
   - `packages/cloudflare-do/src/handler.ts`: Same
   - `packages/redis-pubsub/src/handler.ts`: Same

3. **Update documentation & examples:**
   - Remove `._core` from all examples
   - Update quick-start guide
   - Add deprecation notice

**Benefits:**

- Immediately improves DX
- No breaking changes (.\_core still works)
- Simplifies conceptual model

**Backwards Compatibility:** ✅ Full (with deprecation path)

---

### Phase 2: Extended Validator Pattern, DX Features & Multi-Runtime `serve()` (v1.3)

**Goal:** Eliminate `createMessageSchema` factory, provide `z.message()` and `z.router()` via a safe wrapper pattern. Introduce multi-runtime `serve()` function for portable code. Add developer-experience refinements: middleware, error handling helpers, request/response semantics, lifecycle hooks, and consistent client naming.

**Implementation Approach: Wrapper Pattern (Not Module Augmentation)**

The critical lesson: **Avoid global namespace pollution.** Instead of `declare module "zod"`, use a wrapper:

```typescript
// @ws-kit/zod/src/index.ts
import * as zodBase from "zod";

interface ZodExtended extends typeof zodBase {
  message<const Type extends string, const Shape extends zodBase.ZodRawShape | undefined>(
    type: Type,
    payload?: Shape extends zodBase.ZodRawShape ? {...} : undefined
  ): MessageSchemaType;

  router<TData = {}>(): Router<TData>;
}

export const z: ZodExtended = Object.assign(
  Object.create(zodBase),
  {
    message: (type, payload) => zodBase.object({
      type: zodBase.literal(type),
      payload: payload ? zodBase.object(payload) : zodBase.object({}),
      meta: zodBase.object({...}),
    }),
    router: <TData = {}>() => createRouter<TData>(),
  }
) as ZodExtended;

// Critical: Router interface with constrained overloads for type inference
interface Router<TData = {}> {
  // Ensures literal inference of Type and Payload through generic S
  onMessage<S extends MessageSchema<any, any>>(
    schema: S,
    handler: (ctx: MessageContext<S, TData>) => void
  ): this;

  onOpen(handler: (ctx: OpenContext<TData>) => void): this;
  onClose(handler: (ctx: CloseContext<TData>) => void): this;
  use(middleware: (ctx: MessageContext<any, TData>, next: () => void) => void): this;
  addRoutes(router: Router<any>): this;
}
```

**Type Inference Pattern:** The `<S extends MessageSchema<any, any>>` constraint ensures TypeScript captures the exact schema structure and flows it through to `MessageContext<S, TData>`, giving you literal `type` inference and precise `payload` typing without any widening.

**Why Wrapper Pattern?**

- ✅ No `declare module "zod"` — no global namespace pollution
- ✅ Single canonical instance — users import one `z`, no ambiguity
- ✅ Safer than factory — encourages correct usage by default
- ✅ Still backwards compatible — factory pattern remains available

**Changes:**

1. **Implement wrapper pattern for Zod:**
   - Create extended interface `ZodExtended extends typeof zod`
   - Export `z: ZodExtended` that wraps zodBase
   - Include `message()` and `router()` methods
   - Same for `@ws-kit/valibot`

2. **Add core DX features to `MessageContext`:**
   - Add `ctx.error(code, message, details?)` helper for type-safe error sending
   - Add `ctx.reply(schema, payload)` as semantically clearer alias to `ctx.send()`
   - Export standard `ErrorMessage` schema with discriminated union of error codes
   - Implement middleware support via `router.use((ctx, next) => { ... })`

3. **Create `@ws-kit/serve` package:**
   - Export `serve()` function with runtime auto-detection
   - Detects Bun, Cloudflare Workers, and Deno (if adapter exists)
   - Dynamically imports platform-specific handler
   - Add lifecycle hook support: `onError`, `onBroadcast`, `onUpgrade`
   - Throws clear error for unsupported runtimes
   - Maintains backwards compatibility with direct handler imports

4. **Update client library naming:**
   - Rename `createClient` → `wsClient` in `@ws-kit/client/*` packages
   - Maintains consistent verb style with `z.router()`, `z.message()`
   - Ensure TypeScript inference from server schema works correctly

5. **Keep factory as deprecated:**
   - `createMessageSchema` still works
   - Add deprecation warning
   - Link to migration guide mentioning wrapper pattern

6. **Update examples:**
   - Use `z.message()` instead of factory
   - Use `z.router()` instead of `createZodRouter()`
   - Use `serve()` from `@ws-kit/serve` instead of platform-specific imports
   - Demonstrate middleware, error handling, and lifecycle hooks
   - Update client examples to use `wsClient`

**Benefits:**

- ✅ Single canonical validator instance throughout the project
- ✅ Eliminates dual package hazard (no global augmentation)
- ✅ More intuitive API (feels like Zod/Valibot)
- ✅ No room for accidental validator instance mismatches
- ✅ Tree-shakeable (via prototype chain)

**Backwards Compatibility:** ✅ Full (with deprecation path)

---

### Phase 3: Platform Convenience Packages (v2.0)

**Goal:** Provide "batteries included" packages for common use cases.

**Note:** With multi-runtime `serve()` from Phase 2, the base API already works across platforms. These packages add convenience wrappers and templates for specific platform + validator combinations.

**New packages:**

- `@ws-kit/bun-zod`: Bundle Bun + Zod with starter templates
- `@ws-kit/bun-valibot`: Bundle Bun + Valibot with starter templates
- `@ws-kit/cloudflare-zod`: Bundle Cloudflare DO + Zod with starter templates
- `@ws-kit/cloudflare-valibot`: Bundle Cloudflare DO + Valibot with starter templates

**Usage:**

```typescript
import { createApp, z } from "@ws-kit/bun-zod";

const app = createApp();
app.onMessage(z.message("PING"), (ctx) => { ... });
app.start({ port: 3000 });
```

**Benefits:**

- Single import for common setups
- Clear mental model
- Excellent onboarding

**Trade-off:** Modest package proliferation (6-8 vs 5 packages)

---

### Phase 4: Automatic Type Inference from Assignments (v3.0+)

**Goal:** Automatically infer `TData` type from handler assignments without explicit generic.

**Current (requires explicit generic):**

```typescript
type AppData = { userId?: string };
const router = z.router<AppData>(); // ✅ Must specify type

router.onMessage(schema, (ctx) => {
  ctx.ws.data = { userId: "123" }; // Validated against AppData
});

router.onClose((ctx) => {
  ctx.ws.data.userId; // ✅ Typed as string | undefined
});
```

**Future possibility (TypeScript 5.5+):**

```typescript
const router = z.router(); // No generic needed

router.onMessage(schema, (ctx) => {
  ctx.ws.data = { userId: "123" }; // Type recorded from assignment
});

router.onClose((ctx) => {
  ctx.ws.data.userId; // ✅ Auto-inferred as string (from assignment)
});
```

**Why not now:** TypeScript cannot track object literal types through assignments across function boundaries. This requires language-level support for "inferred generics from usage patterns," which is on the TypeScript roadmap but not yet implemented.

**Status:** Monitor TypeScript roadmap. Phases 1-2 deliver real value today; Phase 4 is a nice-to-have for the future.

---

## Part 5: Decision Matrix

| Aspect                     | Current  | Phase 1     | Phase 2                  | Phase 4    |
| -------------------------- | -------- | ----------- | ------------------------ | ---------- |
| `._core` visibility        | Exposed  | Hidden      | Hidden                   | Hidden     |
| `createMessageSchema`      | Required | Required    | Deprecated               | Deprecated |
| `createZodRouter()` call   | Required | Required    | Optional                 | Optional   |
| Platform-specific imports  | Required | Required    | Optional (multi-runtime) | Optional   |
| Manual TData generic       | Required | Required    | Required                 | Not needed |
| Type assertions (`as any`) | 1        | 0           | 0                        | 0          |
| Lines to setup             | ~42      | ~30         | ~30                      | ~25        |
| Factory calls              | 2        | 2           | 0                        | 0          |
| Multi-runtime support      | No       | No          | Yes (auto-detect)        | Yes        |
| Beginner-friendly          | Medium   | Medium-High | High                     | Very High  |
| Migration effort           | -        | Low         | Low                      | Medium     |
| Breaking changes           | -        | None        | None                     | Minimal    |

**Notes on Type Safety:**

- Phases 1-2 eliminate `as any` type casts, but still require explicit `TData` generic declaration
- Phase 4 achieves true automatic type inference (requires future TypeScript language features)

---

## Part 5.5: Wrapper vs. Factory Pattern Comparison

The proposal evolved from the original Phase 2 (module augmentation) to the **wrapper pattern** based on critical architectural analysis. Here's why:

| Aspect                         | Factory Pattern                                 | Module Augmentation             | Wrapper Pattern               |
| ------------------------------ | ----------------------------------------------- | ------------------------------- | ----------------------------- |
| **Global namespace pollution** | ❌ None                                         | ⚠️ Affects `"zod"` globally     | ❌ None                       |
| **Dual package hazard**        | Explicit (user can see mistake)                 | ⚠️ Reintroduced silently        | ✅ Prevented by design        |
| **User footguns**              | Higher (must pass correct z)                    | Higher (easy to import wrong z) | Lowest (single import source) |
| **API surface**                | `createMessageSchema(z)` then `messageSchema()` | `z.message()` directly          | `z.message()` directly        |
| **Implementation complexity**  | Simple function                                 | Affects global types            | Prototype chain wrapper       |
| **Tree-shakeable**             | Yes                                             | Yes                             | Yes                           |
| **Type inference**             | ✅ Full                                         | ✅ Full                         | ✅ Full                       |
| **Recommended for Phase 2**    | ⚠️ Current standard                             | ❌ Architecturally flawed       | ✅ Best choice                |

**Why Wrapper Pattern Wins:**

1. **Safety by Default:** Users import `z` from one place and get the extended API. No room for mistakes.

2. **No Ambient Types:** Wrapper doesn't pollute global namespace like `declare module "zod"` does.

3. **Backwards Compatible:** Factory pattern still available via deprecation path.

4. **Simpler Mental Model:** Users understand they're using an extended version of Zod, not "Zod with ambient changes."

5. **Works in all monorepo scenarios:**
   - Workspace with single Zod version ✅
   - Workspace with different Zod versions ✅ (users import `@ws-kit/zod` which has its own zod instance)
   - Dual package hazard eliminated by design

---

## Part 6: Migration Guide (For Each Phase)

### Phase 1: Proxy Pattern Migration

**Before:**

```typescript
const router = createZodRouter();
const { fetch, websocket } = createBunHandler(router._core);
```

**After:**

```typescript
const router = createZodRouter();
const { fetch, websocket } = createBunHandler(router); // Just pass router
```

**Compatibility:** The `._core` property still works with deprecation warning.

---

### Phase 2: Extended Validator & Multi-Runtime Migration

**Before (Factory Pattern + Platform-Specific):**

```typescript
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun"; // Platform-specific import

const { messageSchema } = createMessageSchema(z);
const schema = messageSchema("PING", { text: z.string() });
const router = createZodRouter<AppData>();

serve(router, { port: 3000 });
```

**After (Wrapper Pattern + Multi-Runtime):**

```typescript
import { z } from "@ws-kit/zod"; // Extended with .message() and .router()
import { serve } from "@ws-kit/serve"; // Works on any runtime!

const schema = z.message("PING", { text: z.string() });
const router = z.router<AppData>();

serve(router, { port: 3000 }); // Auto-detects runtime
```

**Why This Is Better:**

- ✅ Single import source (`@ws-kit/zod` instead of dual imports)
- ✅ Single serve import that works everywhere (Bun, Cloudflare, Deno)
- ✅ No module augmentation (wrapper uses `Object.create()` + `Object.assign()`)
- ✅ Safer by design (users can't accidentally mix validator instances)
- ✅ Simpler API (direct methods instead of factory + factory call)
- ✅ **Portable code** — same code runs on different platforms without changes

**Compatibility:** Old factory still works with deprecation notice. Platform-specific imports still available for advanced users.

**Important Note:** This combines the extended validator pattern with the multi-runtime `serve()` function. The wrapper pattern avoids the dual package hazard entirely, and multi-runtime `serve()` provides true portability.

---

### Phase 3: Platform Packages Migration

**Option 1: Keep using base packages (no change required)**

```typescript
import { z } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

const router = z.router();
serve(router, { port: 3000 });
```

**Option 2: Switch to convenience package (recommended for new projects)**

```typescript
import { createApp, z } from "@ws-kit/bun-zod";

const app = createApp();
app.onMessage(z.message("PING"), (ctx) => { ... });
app.start({ port: 3000 });
```

---

## Part 7: Alternatives Considered

### Alternative: Builder Pattern

```typescript
const router = z
  .router()
  .data<{ userId: string }>() // Explicit type
  .onMessage(schema, handler)
  .onClose(handler);
```

**Verdict:** ❌ More verbose, no clear benefit over proposed API.

---

### Alternative: Symbol-Based Internal Protocol

```typescript
const CORE = Symbol.for("@ws-kit/core");
export interface TypedRouter {
  [CORE]: WebSocketRouter;
}
```

**Verdict:** ⚠️ Hides complexity but doesn't eliminate dual-router pattern. Proxy is cleaner.

---

### Alternative: Inheritance Over Composition

```typescript
class TypedRouter extends WebSocketRouter {
  onMessage<S>(schema: S, handler: (ctx: InferContext<S>) => void) {
    return super.onMessage(schema, handler as any);
  }
}
```

**Verdict:** ❌ Doesn't work well—property access still shows parent methods. Proxy is better.

---

### Alternative: Macro-based Code Generation

```typescript
// Like Solid.js or Svelte use macros
const router = createRouter();
$message(schema, (ctx) => {
  /* ... */
}); // Compiler plugin
```

**Verdict:** ❌ Adds build-time complexity, non-standard tooling.

---

## Part 8: Risk Assessment

### Risk 1: Proxy Performance

**Severity:** Low
**Mitigation:** Proxies have minimal overhead in modern engines; only intercept `onMessage`, pass through everything else.
**Measurability:** Benchmark message throughput before/after.

---

### Risk 2: Package Proliferation (Phase 3)

**Severity:** Medium
**Mitigation:** Keep base packages (core, zod, valibot, bun, cloudflare-do), add convenience packages as optional.
**Measurability:** Monitor maintenance burden, deprecate if unpopular.

---

### Risk 3: TypeScript Compatibility

**Severity:** Low
**Mitigation:** All proposed patterns work with TS 4.7+. Proxy usage is standard.
**Measurability:** Run test suite on multiple TS versions.

---

### Risk 4: Breaking Changes

**Severity:** Low with phased approach
**Mitigation:** All phases maintain backwards compatibility during transition.
**Measurability:** Deprecation warnings, migration guides.

---

## Recommendations

### Immediate (Next Release: v1.2)

✅ Implement Phase 1 (Proxy pattern)

- **Benefit**: Hides `._core` implementation detail
- **Effort**: Low
- **Breaking changes**: None (deprecation path available)
- **What it fixes**: Simplifies API, eliminates abstraction leak

### Short-term (v1.3-1.4)

✅ Implement Phase 2 (Extended validators + DX features + Multi-runtime `serve()`)

- **Benefits**:
  - Eliminates `createMessageSchema()` factory while avoiding dual package hazard
  - Adds middleware support (familiar Express/Hono pattern)
  - Adds type-safe error handling with `ctx.error()` helper
  - Adds request/response semantics with `ctx.reply()` alias
  - Introduces multi-runtime `serve()` for true code portability (Bun/Cloudflare/Deno with auto-detection)
  - Adds lifecycle hooks for observability (`onError`, `onBroadcast`, `onUpgrade`)
  - Consistent client naming with `wsClient()` instead of `createClient()`
- **Effort**: Medium (more substantial than core API, but all proven patterns)
- **Breaking changes**: None (old factory and APIs still work with deprecation)
- **Key implementation**:
  - Use `Object.assign(Object.create(zod), { message, router })`—not module augmentation
  - Export `serve()` from new `@ws-kit/serve` package with runtime auto-detection
  - Add middleware support to router via `router.use((ctx, next) => {})`
  - Export standard `ErrorMessage` with discriminated union of error codes
  - Add lifecycle hooks to serve options
- **What it fixes**: Fewer imports, more intuitive API, safer instance management, portable code across platforms, familiar middleware patterns, built-in observability, consistent naming conventions
- **Reference**: Part 5.5 for architectural comparison; Option B for validator implementation; "Multi-Runtime `serve()` Function" section for implementation details; "Developer-Experience Details" section for DX features

### Medium-term (v2.0)

✅ Implement Phase 3 (Platform packages)

- **Benefit**: Convenient "batteries included" bundles for common use cases
- **Effort**: Medium
- **Breaking changes**: None (optional packages, base packages remain)
- **What it fixes**: Lower barrier to entry for beginners

### Long-term (Monitor – v3.0+)

⏳ Phase 4 (Automatic type inference)

- **Limitation**: Requires TypeScript language-level support
- **Current workaround**: Explicit `TData` generic (simple one-liner)
- **Not urgent**: Phases 1-2 eliminate 90% of boilerplate today
- **Action**: Monitor TypeScript roadmap for "inferred generics from usage" patterns

---

## Conclusion

The proposed changes represent an evolutionary refinement rather than a revolution. Each phase is:

- **Backward compatible** (with deprecations)
- **Optional** (users can adopt gradually)
- **Low-risk** (simple, proven patterns)
- **Achievable today** (Phases 1-3 use existing TypeScript capabilities)
- **High-impact** (measurable DX improvements)

### What Phases 1-2 Actually Deliver

Phases 1-2 eliminate approximately **30% of boilerplate** and **100% of type assertions** while maintaining full type safety:

- **Phase 1**: Removes `._core` exposure (eliminates abstraction leak)
- **Phase 2**: Removes `createMessageSchema()` factory using **wrapper pattern** (streamlines imports and mental model) + introduces multi-runtime `serve()` (code runs on Bun, Cloudflare, Deno without changes)
- **Trade-off**: Still requires one explicit `TData` generic—this is a TypeScript limitation, not a design choice

This is not a compromise; the explicit generic is a single, clearly-scoped type annotation that provides full type safety in all handlers. It's the right balance between automation and clarity.

**Multi-runtime `serve()` is particularly valuable** because:

- Same code works on Bun, Cloudflare Workers, and other runtimes
- Runtime auto-detection is transparent to users
- Reduces friction for deployment across different platforms
- Follows successful patterns in Elysia, Hono, and Nitro

### Critical Architectural Insight: Wrapper Pattern (Not Module Augmentation)

The original Phase 2 proposal used `declare module "zod"` for global type augmentation. **This reintroduces the dual package hazard** the proposal itself identified (Issue 8).

The refined approach uses a **wrapper pattern** instead:

- ✅ `Object.assign(Object.create(zod), { message: (...) => ..., router: (...) => ... })`
- ✅ No global namespace pollution
- ✅ Single canonical validator instance
- ✅ Safer than factory pattern
- ✅ Full backwards compatibility

This architectural refinement is essential for Phase 2 to be sound. See **Part 5.5: Wrapper vs. Factory Pattern Comparison** for detailed analysis.

### Phase 4: A Future Enhancement

Phase 4 (automatic type inference) represents a genuine improvement but requires future TypeScript language features. Monitor the TypeScript roadmap, but don't let this block implementation of Phases 1-2 today—they deliver substantial value immediately.
