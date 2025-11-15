# ADR-008: Middleware Support (Global and Per-Route)

**Status**: Accepted
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
2. **Per-route middleware** via `router.use(schema, (ctx, next) => { ... })`
3. **Standard `(ctx, next)` signature** — Familiar pattern from Express/Hono
4. **Synchronous and async support** — Both `sync` and `async` middleware work
5. **Execution order** — Global middleware first, then per-route, then handler

### Type Signature

```typescript
type Middleware<TData> = (
  ctx: MessageContext<any, TData>,
  next: () => unknown | Promise<unknown>,
) => unknown | Promise<unknown>;

interface Router<TData> {
  /**
   * Register global middleware (runs for all messages).
   * Executed before per-route middleware and handlers.
   */
  use(middleware: Middleware<TData>): this;

  /**
   * Register per-route middleware (runs only for this message type).
   * Executed after global middleware, before handler.
   */
  use<S extends MessageSchema>(schema: S, middleware: Middleware<TData>): this;
}
```

### Implementation Pattern

```typescript
export class WebSocketRouter<TData> {
  private globalMiddleware: Array<Middleware<TData>> = [];
  private routeMiddleware: Map<string, Array<Middleware<TData>>> = new Map();

  use(middleware: Middleware<TData>): this;
  use<S extends MessageSchema>(schema: S, middleware: Middleware<TData>): this;
  use(schemaOrMiddleware: any, middleware?: any): this {
    if (typeof schemaOrMiddleware === "function") {
      // Global middleware
      this.globalMiddleware.push(schemaOrMiddleware);
    } else {
      // Per-route middleware
      const type = schemaOrMiddleware.shape.type.value;
      if (!this.routeMiddleware.has(type)) {
        this.routeMiddleware.set(type, []);
      }
      this.routeMiddleware.get(type)!.push(middleware);
    }
    return this;
  }

  private async executeMiddlewareChain(
    ctx: MessageContext<any, TData>,
    middleware: Middleware<TData>[],
    handler: () => unknown | Promise<unknown>,
  ): Promise<void> {
    let index = 0;

    const next = async (): Promise<unknown> => {
      if (index < middleware.length) {
        const mw = middleware[index++];
        return mw(ctx, next);
      }
      return handler();
    };

    await next();
  }

  async handleMessage(ctx: MessageContext<any, TData>): Promise<void> {
    const routeMiddleware = this.routeMiddleware.get(ctx.type) || [];
    const allMiddleware = [...this.globalMiddleware, ...routeMiddleware];

    const handler = this.messageHandlers.get(ctx.type)?.handler;
    if (!handler) return; // No handler registered

    await this.executeMiddlewareChain(ctx, allMiddleware, () => handler(ctx));
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

router.use(SendMessage, (ctx, next) => {
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
});

router.on(SendMessage, (ctx) => {
  // Rate limit already checked
  processMessage(ctx.payload);
});
```

### Per-Route Validation Enrichment

```typescript
// Enrich context with validated data before handler
router.use(QueryMessage, (ctx, next) => {
  try {
    ctx.assignData({
      query: parseQuery(ctx.payload.q),
    });
  } catch (err) {
    ctx.error("INVALID_ARGUMENT", "Invalid query syntax");
    return; // Skip handler
  }
  return next();
});

router.on(QueryMessage, (ctx) => {
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

Middleware sees generic `MessageContext<any, TData>`:

```typescript
type Middleware<TData> = (
  ctx: MessageContext<any, TData>, // Generic message type
  next: () => unknown | Promise<unknown>,
) => unknown | Promise<unknown>;
```

**Why generic?** At middleware execution time, we don't know the specific handler's schema type. Per-route middleware gets `next()` routed to the specific handler, but the context type itself remains generic. Handlers get the specific type via their `on()` registration.

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
⚠️ **Type visibility** — Per-route middleware sees `MessageContext<any>`, not specific schema type

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
