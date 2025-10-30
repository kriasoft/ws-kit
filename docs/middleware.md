# Middleware Guide

Middleware provides a clean way to handle cross-cutting concerns like authentication, logging, rate limiting, and validation. Think of it as a series of gates that messages pass through before reaching handlers.

## How Middleware Works

Middleware runs in a specific order:

1. Global middleware (in registration order)
2. Per-route middleware (in registration order)
3. Handler (only if all middleware calls `next()`)

Each piece of middleware receives the message context and a `next()` function. Call `next()` to proceed to the next middleware or handler. Skip calling `next()` to prevent the handler from executing.

## Global Middleware

Global middleware runs for all messages. Use it for cross-cutting concerns that apply everywhere:

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = { userId?: string };
const router = createRouter<AppData>();

// Authentication check for all messages except login
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return; // Skip handler
  }
  return next();
});

// Log all message handling
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

## Per-Route Middleware

Per-route middleware runs only for specific messages. Register it by passing a schema as the first argument:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { userId?: string };
const router = createRouter<AppData>();

const SendMessage = message("SEND_MESSAGE", { text: z.string() });

// Rate limiting for SendMessage only
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

router.use(SendMessage, (ctx, next) => {
  const userId = ctx.ws.data?.userId || "anon";
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
  // Rate limiting already checked by middleware
  console.log(`Message from ${ctx.ws.data?.userId}: ${ctx.payload.text}`);
});
```

## Common Patterns

### Authentication & Authorization

Check user status in a global middleware and attach user data to context:

```typescript
type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

// Global: authentication check
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
  return next();
});

// Per-route: role-based authorization
const AdminMessage = message("ADMIN_ACTION", { action: z.string() });

router.use(AdminMessage, (ctx, next) => {
  if (!ctx.ws.data?.roles?.includes("admin")) {
    ctx.error("PERMISSION_DENIED", "Admin access required");
    return;
  }
  return next();
});

router.on(AdminMessage, (ctx) => {
  console.log(`Admin action: ${ctx.payload.action}`);
});
```

### Data Enrichment

Middleware can compute and attach data to the context for handlers to use:

```typescript
router.use((ctx, next) => {
  // Enrich context with request metadata
  ctx.assignData({
    requestId: crypto.randomUUID(),
    receivedTime: Date.now(),
  });
  return next();
});

router.on(SomeMessage, (ctx) => {
  const requestId = (ctx.ws.data as any).requestId;
  const receivedTime = (ctx.ws.data as any).receivedTime;
  console.log(`Request ${requestId} received at ${receivedTime}`);
});
```

### Validation Enrichment

Validate and transform payload data before the handler sees it:

```typescript
router.use(QueryMessage, (ctx, next) => {
  try {
    // Parse and validate complex structures
    ctx.assignData({
      query: parseSearchQuery(ctx.payload.q),
    });
  } catch (err) {
    ctx.error("INVALID_ARGUMENT", "Invalid query syntax");
    return;
  }
  return next();
});

router.on(QueryMessage, (ctx) => {
  // Query is pre-validated
  const query = (ctx.ws.data as any).query;
  const results = database.search(query);
  ctx.send(QueryResultsMessage, { results });
});
```

### Async Operations (Feature Flags, External Checks)

Middleware supports async operations for external service calls:

```typescript
// Check if feature is enabled before processing
router.use(async (ctx, next) => {
  try {
    const res = await fetch(`/api/features/${ctx.type}`);
    const { enabled } = await res.json();

    if (!enabled) {
      ctx.error("UNAVAILABLE", "Feature is disabled");
      return;
    }
  } catch (err) {
    console.error("Feature check failed:", err);
    ctx.error("INTERNAL", "Feature check failed");
    return;
  }

  return next();
});
```

## Context Mutation

Middleware can modify `ctx.ws.data` using `ctx.assignData()`. This is useful for:

- Attaching computed values (request IDs, timestamps)
- Parsing and validating complex structures
- Setting up state for multiple handlers

```typescript
router.use((ctx, next) => {
  ctx.assignData({
    requestId: crypto.randomUUID(),
  });
  return next();
});

// In any handler, ctx.ws.data.requestId is available
router.on(SomeMessage, (ctx) => {
  const { requestId } = ctx.ws.data as any;
});
```

**Important**: `ctx.assignData()` does a shallow merge. Use it to add top-level properties to your connection data.

## Error Handling in Middleware

### Synchronous Errors

Handle synchronous errors with try-catch:

```typescript
router.use((ctx, next) => {
  try {
    const data = JSON.parse(ctx.ws.data?.rawData || "{}");
    ctx.assignData(data);
  } catch (err) {
    ctx.error("INVALID_ARGUMENT", "Malformed data");
    return;
  }
  return next();
});
```

### Asynchronous Errors

Catch async errors to prevent unhandled rejections:

```typescript
router.use(async (ctx, next) => {
  try {
    const allowed = await checkPermission(ctx.ws.data?.userId);
    if (!allowed) {
      ctx.error("PERMISSION_DENIED", "Access denied");
      return;
    }
  } catch (err) {
    // Log internal error but don't expose details
    console.error("Permission check failed:", err);
    ctx.error("INTERNAL", "Could not verify permissions");
    return;
  }
  return next();
});
```

If middleware throws an unhandled error, the router will:

1. Catch it
2. Call the `onError` hook (if registered in serve options)
3. Skip the handler
4. Keep the connection open

## Middleware Execution Order

When multiple middleware are registered, they execute in the order they were registered:

```typescript
router.use("global-1", () => {
  /* runs first */
});
router.use("global-2", () => {
  /* runs second */
});

router.use(Message, "route-1", () => {
  /* runs third */
});
router.use(Message, "route-2", () => {
  /* runs fourth */
});

router.on(Message, () => {
  /* runs last */
});
```

**Global middleware runs first** (in registration order), then **per-route middleware** (in registration order), then the **handler**.

## Testing Middleware

Middleware is easier to test independently:

```typescript
// Create a test router with just the middleware and handler
const testRouter = createRouter<AppData>();

testRouter.use((ctx, next) => {
  if (!ctx.ws.data?.userId) {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
  return next();
});

// Mock context and test
const mockContext = {
  ws: { data: { userId: undefined } },
  error: vi.fn(),
};

// Verify middleware rejects unauthenticated requests
// ... test assertions here
```

## Architecture Decision

For the design rationale and alternative patterns considered, see [ADR-008](./adr/008-middleware-support.md).
