# ADR-008: Middleware Support (Global and Per-Route)

**Status**: Final
**Date**: 2025-10-29
**Related**: ADR-005 (builder pattern), ADR-007 (export-with-helpers)

## Context

Current implementation only supports message handlers and lifecycle callbacks (`onOpen`, `onClose`). Cross-cutting concerns like authentication, logging, rate limiting, and validation require duplicating code across handlers or using external patterns (context mutation, helper functions).

```typescript
// Current approach: Duplicated auth check in every handler
router.on(LoginMessage, (ctx) => {
  // No auth check needed
});

router.on(SecureMessage, (ctx) => {
  if (!ctx.data?.userId) {
    ctx.send(ErrorMessage, { code: "UNAUTHENTICATED" });
    return;
  }
  // Handle secure message
});

router.on(AnotherSecureMessage, (ctx) => {
  if (!ctx.data?.userId) {
    ctx.send(ErrorMessage, { code: "UNAUTHENTICATED" });
    return;
  }
  // Handle another secure message
});
```

This pattern:

1. **Duplicates logic** across handlers
2. **Breaks DRY principle** — Same auth check repeated everywhere
3. **Harder to test** — Can't test auth logic independently
4. **Scales poorly** — Adding new cross-cutting concern requires touching all handlers

## Decision

Introduce middleware similar to Express/Hono:

1. **Global middleware** via `router.use((ctx, next) => { ... })`
2. **Per-route middleware** via `router.route(schema).use((ctx, next) => { ... }).on(handler)` — builder pattern
3. **Standard `(ctx, next)` signature** — Familiar pattern from Express/Hono
4. **Synchronous and async support** — Both `sync` and `async` middleware work
5. **Execution order** — Global middleware first, then per-route, then handler

### Type Signature

```typescript
type Middleware<TContext extends ConnectionData = ConnectionData> = (
  ctx: MinimalContext<TContext>,
  next: () => Promise<void>,
) => Promise<void>;

interface RouterCore<TContext extends ConnectionData = ConnectionData> {
  /**
   * Register global middleware (runs for all messages).
   * Executed before per-route middleware and handlers.
   */
  use(middleware: Middleware<TContext>): this;

  /**
   * Fluent builder to register per-route middleware.
   * Returns a RouteBuilder for chaining `.use()` calls and `.on(handler)`.
   */
  route<S extends MessageSchema>(schema: S): RouteBuilder<S, TContext>;
}

interface RouteBuilder<
  S extends MessageSchema,
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Register per-route middleware (runs only for this message type).
   * Can be chained multiple times. Executed after global middleware, before handler.
   */
  use(middleware: Middleware<TContext>): this;

  /**
   * Register handler for this route. Executes after all middleware.
   */
  on(
    handler: (ctx: MessageContext<S, TContext>) => void | Promise<void>,
  ): RouterCore<TContext>;
}
```

**Key design choice**: Per-route middleware is **payload-blind** — it sees `MinimalContext<TContext>` with only connection data, not the specific message type. This keeps middleware composable and router-generic-only. Handler `.on()` provides the specific schema type for full payload access.

### Implementation Pattern

```typescript
export class WebSocketRouter<TContext extends ConnectionData = ConnectionData> {
  private globalMiddleware: Array<Middleware<TContext>> = [];
  private routes: Map<string, RouteEntry<any, TContext>> = new Map();

  use(middleware: Middleware<TContext>): this {
    this.globalMiddleware.push(middleware);
    return this;
  }

  route<S extends MessageSchema>(schema: S): RouteBuilder<S, TContext> {
    return new RouteBuilderImpl(this, schema);
  }

  private async executeMiddlewareChain(
    ctx: MinimalContext<TContext>,
    middleware: Middleware<TContext>[],
    handler: () => Promise<void>,
  ): Promise<void> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;

      const mw = middleware[i];
      if (!mw) return handler();

      await mw(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
  }

  async handleMessage(ctx: MessageContext<any, TContext>): Promise<void> {
    const route = this.routes.get(ctx.type);
    if (!route) return;

    const allMiddleware = [...this.globalMiddleware, ...route.middlewares];
    await this.executeMiddlewareChain(ctx, allMiddleware, () =>
      route.handler(ctx),
    );
  }
}
```

## Usage Examples

### Global Authentication Middleware

```typescript
router.use((ctx, next) => {
  if (!ctx.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return; // Skip handler by not calling next()
  }
  return next();
});

router.on(LoginMessage, (ctx) => {
  // Authenticate and set userId
  ctx.assignData({ userId: "123" });
});

router.on(SecureMessage, (ctx) => {
  // Auth already checked by middleware
  // ctx.data.userId is guaranteed to exist
  console.log(`Secure message from ${ctx.data.userId}`);
});
```

### Global Logging Middleware

```typescript
router.use((ctx, next) => {
  const start = performance.now();
  const result = next();
  const duration = performance.now() - start;

  if (result instanceof Promise) {
    return result.then((r) => {
      console.log(`[${ctx.type}] ${duration.toFixed(2)}ms`);
      return r;
    });
  }

  console.log(`[${ctx.type}] ${duration.toFixed(2)}ms`);
  return result;
});
```

### Per-Route Rate Limiting

```typescript
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

router
  .route(SendMessage)
  .use((ctx, next) => {
    const userId = ctx.data?.userId || "anon";
    const now = Date.now();
    const state = rateLimiter.get(userId);

    if (state && state.resetAt > now && state.count >= 10) {
      ctx.error("RESOURCE_EXHAUSTED", "Too many messages");
      return; // Skip handler
    }

    if (!state || state.resetAt <= now) {
      rateLimiter.set(userId, { count: 1, resetAt: now + 60000 });
    } else {
      state.count++;
    }

    return next();
  })
  .on((ctx) => {
    // Rate limit already checked
    processMessage(ctx.payload);
  });
```

### Per-Route Validation Enrichment

```typescript
// Enrich context with validated data before handler
router
  .route(QueryMessage)
  .use((ctx, next) => {
    try {
      ctx.assignData({
        query: parseQuery(ctx.payload.q),
      });
    } catch (err) {
      ctx.error("INVALID_ARGUMENT", "Invalid query syntax");
      return; // Skip handler
    }
    return next();
  })
  .on((ctx) => {
    const query = (ctx.data as any)?.query; // Pre-validated by middleware
    const results = database.search(query);
    ctx.send(QueryResultsMessage, { results });
  });
```

### Async Middleware (External Service Calls)

```typescript
router.use((ctx, next) => {
  return fetch(`/check-feature/${ctx.type}`)
    .then((res) => res.json())
    .then(({ enabled }) => {
      if (!enabled) {
        ctx.error("UNAVAILABLE", "Feature is disabled");
        return;
      }
      return next();
    })
    .catch((err) => {
      console.error("Feature check failed:", err);
      ctx.error("INTERNAL", "Feature check failed");
    });
});
```

## Middleware Semantics

### Execution Order

1. **Global middleware** (in registration order)
2. **Per-route middleware** (in registration order)
3. **Handler** (if all middleware called `next()`)

### Control Flow

**Calling `next()`:** Proceeds to next middleware or handler

```typescript
router.use((ctx, next) => {
  console.log("Before handler");
  const result = next();
  console.log("After handler");
  return result;
});
```

**Skipping handler:** Return without calling `next()`

```typescript
router.use((ctx, next) => {
  if (!isAllowed(ctx)) {
    ctx.error("PERMISSION_DENIED", "Access denied");
    return; // Handler won't run
  }
  return next();
});
```

**Async middleware:** Return Promise that resolves when done

```typescript
router.use(async (ctx, next) => {
  const allowed = await checkPermission(ctx.data?.userId);
  if (!allowed) {
    ctx.error("PERMISSION_DENIED", "Access denied");
    return;
  }
  return next();
});
```

### Context Visibility

Middleware is **payload-blind** — it sees `MinimalContext<TContext>` with only connection data:

```typescript
type Middleware<TContext extends ConnectionData = ConnectionData> = (
  ctx: MinimalContext<TContext>, // Only connection data (TContext), not message payload
  next: () => Promise<void>,
) => Promise<void>;
```

**Why payload-blind?** Middleware operates at the router level, above any specific message type. Per-route middleware doesn't need the specific message schema — it works with generic connection data (e.g., userId, roles). Payload access happens only in handlers via `.on()`, which provides the full `MessageContext<S, TContext>` with typed payload.

This design keeps middleware reusable and router-generic-only, avoiding tight coupling between middleware and message schemas.

### Modifying Context

Middleware can modify `ctx.data` for handlers to access:

```typescript
router.use((ctx, next) => {
  // Compute derived data for handlers
  ctx.assignData({
    startedAt: Date.now(),
  });
  return next();
});

router.on(SomeMessage, (ctx) => {
  const elapsed = Date.now() - (ctx.data as any).startedAt;
  console.log(`Handler took ${elapsed}ms`);
});
```

## Error Handling in Middleware

**Synchronous errors in middleware:**

```typescript
router.use((ctx, next) => {
  try {
    const userId = JSON.parse(ctx.data?.rawUserId);
    ctx.assignData({ userId });
  } catch (err) {
    ctx.error("INVALID_ARGUMENT", "Invalid user ID format");
    return; // Skip handler
  }
  return next();
});
```

**Unhandled async errors:**

```typescript
router.use(async (ctx, next) => {
  try {
    const allowed = await checkPermission(ctx.data?.userId);
    if (!allowed) {
      ctx.error("PERMISSION_DENIED", "Access denied");
      return;
    }
  } catch (err) {
    // Log but don't expose internal error
    console.error("Permission check failed:", err);
    ctx.error("INTERNAL", "Could not verify permissions");
    return;
  }
  return next();
});
```

If middleware throws an unhandled error:

- Caught by router
- `onError` hook called (if registered in `serve()` options)
- Handler is NOT executed
- Connection stays open (error sent via `ctx.error()` if available)

## API Shape: Builder vs Overload

### The Decision: Builder Pattern

Per-route middleware uses the **builder pattern**: `router.route(schema).use(mw).on(handler)`

This was chosen over adding a `router.use(schema, mw)` overload.

### Why Builder Pattern?

1. **Single registration path** — All per-route middleware flows through one entry point (the builder), making code easier to trace and maintain
2. **Minimal API surface** — No overload ambiguity (is this global or per-route middleware?)
3. **Fluent, composable** — Chain multiple `.use()` calls before `.on()` with clean syntax
4. **Aligns with router structure** — Mirrors how handlers are registered: `router.route(schema).on(handler)`
5. **Forces explicit ordering** — Builder makes it clear what's global vs per-route

### Why Not Overload?

Adding `router.use(schema, mw)` overload would:

- Create ambiguity: `use(param1, param2)` — is this global with mw param, or per-route?
- Bloat the surface: developers must remember both `use(mw)` and `use(schema, mw)`
- Make per-route middleware look like global (different semantics, same call site)
- Reintroduce overload complexity that builder pattern explicitly avoids

### Trade-off: DX

Builder pattern is slightly more verbose than Express/Hono style:

```typescript
// Express/Hono style (hypothetical)
router.use(SendMessage, (ctx, next) => { ... });

// WS-Kit builder style (actual)
router.route(SendMessage).use((ctx, next) => { ... }).on(handler);
```

**Why acceptable**: The builder pattern is still concise, instantly clear on intent, and aligns with the broader API philosophy (route composition > function overloading). Examples show it's readable and natural once familiar.

## Consequences

### Benefits

✅ **DRY principle** — Write auth, logging, validation once, apply everywhere
✅ **Express/Hono familiarity** — Similar API to industry-standard frameworks
✅ **Clear execution order** — Global → per-route → handler
✅ **Flexible** — Both sync and async supported
✅ **Can skip handler** — Middleware can prevent handler execution by not calling `next()`
✅ **Can enrich context** — Middleware can set data for handlers via `assignData()`
✅ **Testable** — Middleware can be tested independently from handlers

### Trade-offs

⚠️ **Execution overhead** — Each middleware adds a function call (negligible)
⚠️ **Cognitive complexity** — Requires understanding middleware execution order
⚠️ **Error handling** — Unhandled errors in middleware should be caught and logged
⚠️ **Payload-blind middleware** — Middleware doesn't see the specific message type/payload (intentional design; see "API Shape" section)

## Alternatives Considered

### 1. Decorator-Based Middleware

Use decorators (TypeScript experimental feature):

```typescript
@Authenticated
@RateLimited
router.on(SecureMessage, (ctx) => { ... });
```

**Why rejected:**

- Requires TypeScript experimental decorators (not standard)
- Less composable (hard to conditionally apply)
- Harder to order (decorators are "stacked" but order not always clear)
- Smaller ecosystem compared to middleware pattern

### 2. Event Emitter Pattern

Emit events before/after handlers:

```typescript
router.on("before:*", (ctx) => { ... });
router.on("after:*", (ctx) => { ... });
```

**Why rejected:**

- Less control (can't prevent handler execution as naturally)
- Weaker type safety (before/after events have different context)
- Less familiar pattern in JS/TS community

### 3. Handler Composition (Wrapper Functions)

Wrap handlers in middleware:

```typescript
const withAuth = (handler) => (ctx) => {
  if (!ctx.data?.userId) {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
  return handler(ctx);
};

router.on(
  SecureMessage,
  withAuth((ctx) => {
    // Handle secure message
  }),
);
```

**Why rejected:**

- Boilerplate on every protected handler
- Doesn't scale (multiple middleware require nested composition)
- Harder to test

## References

- **ADR-005**: Builder Pattern (router structure supporting middleware)
- **ADR-007**: Export-with-Helpers (uses middleware in examples)
- **ADR-009**: Error Handling and Lifecycle Hooks (related to error flow)
- **Implementation**:
  - `packages/core/src/router.ts` — Router middleware chain implementation
  - `packages/core/test/features/middleware.test.ts` — Comprehensive middleware tests
- **Examples**:
  - `examples/quick-start/index.ts` — Authentication middleware example
  - `examples/*/middleware/*.ts` — Domain-specific middleware examples
- **Related**: CLAUDE.md — Middleware patterns documented in Quick Start
