# ADR-009: Error Handling Helpers and Lifecycle Hooks

**Status**: Accepted
**Date**: 2025-10-29
**Related**: ADR-005 (builder pattern), ADR-008 (middleware), ADR-006 (serve)

## Context

Current implementation lacks:

1. **Type-safe error handling** — No standard error messages or codes
2. **Centralized error logging** — Errors buried in handler logic
3. **Lifecycle visibility** — No hooks for connection events beyond `onOpen`/`onClose`
4. **Observability** — Difficult to integrate with external monitoring/telemetry

This forces developers to:

- Implement custom error types/codes
- Duplicate error handling logic across handlers
- Manually forward errors to external services
- Patch WebSocket implementation to track connection metrics

## Decision

Introduce:

1. **`ctx.error(code, message, details)`** — Type-safe error responses to clients
2. **`ctx.send(schema, payload)`** — Send to this client only (request/response or broadcast responses)
3. **Standard `ErrorMessage` schema** — Predefined error message with discriminated union of codes
4. **Lifecycle hooks** in `serve()` — `onError`, `onBroadcast`, `onUpgrade`, `onOpen`, `onClose`

### Type Signatures

```typescript
type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMIT";

interface MessageContext<S extends MessageSchema, TData> {
  /**
   * Send a type-safe error to the client.
   *
   * @param code - Discriminated error code
   * @param message - Human-readable error message
   * @param details - Optional error details (logged, may be sent to client)
   */
  error(code: ErrorCode, message: string, details?: Record<string, any>): void;

  /**
   * Send a message to this client only.
   * Use for request/response patterns or broadcast responses.
   */
  unicast<R extends MessageSchema>(schema: R, payload: InferPayload<R>): void;

  /**
   * Send a message to this client only (alias to unicast).
   */
  send<R extends MessageSchema>(schema: R, payload: InferPayload<R>): void;
}

interface ServeOptions<TData> {
  /**
   * Called when an unhandled error occurs in a handler or middleware.
   * Hook should not throw; errors are logged and swallowed.
   */
  onError?: (error: Error, ctx?: { type: string; userId?: string }) => void;

  /**
   * Called when router.publish() is invoked (before actual send).
   * Hook should not throw; errors are logged and swallowed.
   */
  onBroadcast?: (message: any, scope: string) => void;

  /**
   * Called during WebSocket upgrade (before authentication).
   * Hook should not throw; errors abort the upgrade with 500.
   */
  onUpgrade?: (req: Request) => void;

  /**
   * Called after connection is established and authenticated.
   * Hook should not throw; errors are logged.
   */
  onOpen?: (ctx: OpenContext<TData>) => void;

  /**
   * Called when connection closes (after cleanup).
   * Hook should not throw; errors are logged.
   */
  onClose?: (ctx: CloseContext<TData>) => void;
}
```

## Implementation: Error Handling

### Standard ErrorMessage Schema

```typescript
export const ErrorMessage = message("ERROR", {
  code: z.enum([
    "VALIDATION_ERROR",
    "AUTH_ERROR",
    "INTERNAL_ERROR",
    "NOT_FOUND",
    "RATE_LIMIT",
  ]),
  message: z.string(),
  details: z.record(z.any()).optional(),
});

// Type-safe error codes
export type ErrorCode = z.infer<typeof ErrorMessage>["payload"]["code"];
```

### `ctx.error()` Helper

```typescript
export function error(
  ctx: MessageContext<any, any>,
  code: ErrorCode,
  message: string,
  details?: Record<string, any>,
): void {
  // Send error to client
  ctx.send(ErrorMessage, {
    code,
    message,
    details,
  });

  // Log with context
  console.error(`[${ctx.type}] ${code}: ${message}`, details);
}
```

### Usage Examples

#### Authentication Error

```typescript
router.on(LoginMessage, (ctx) => {
  try {
    const user = authenticate(ctx.payload);
    if (!user) {
      // ✅ Type-safe error code
      ctx.error("AUTH_ERROR", "Invalid credentials", {
        hint: "Check your username and password",
      });
      return;
    }
    ctx.assignData({ userId: user.id });
  } catch (err) {
    ctx.error("INTERNAL_ERROR", "Authentication service unavailable");
  }
});
```

#### Validation Error

```typescript
router.on(UpdateUserMessage, (ctx) => {
  try {
    const validated = validateEmail(ctx.payload.email);
    ctx.assignData({ email: validated });
  } catch (err) {
    ctx.error("VALIDATION_ERROR", "Invalid email format", {
      field: "email",
      received: ctx.payload.email,
    });
    return;
  }

  // Continue with update
  updateUserInDB(ctx.ws.data?.userId, ctx.payload);
});
```

#### Not Found Error

```typescript
router.on(QueryUserMessage, (ctx) => {
  const user = findUserById(ctx.payload.userId);
  if (!user) {
    ctx.error("NOT_FOUND", "User not found", {
      userId: ctx.payload.userId,
    });
    return;
  }

  ctx.send(UserFoundMessage, user);
});
```

## Implementation: Lifecycle Hooks

### Hook Signatures Reference

Five lifecycle hooks available in `serve()` options:

```typescript
interface ServeOptions<TData> {
  /**
   * Called during WebSocket upgrade (before authentication).
   * Use for logging connection attempts, tracking metrics.
   * Should not throw; errors abort with HTTP 500.
   */
  onUpgrade?(req: Request): void;

  /**
   * Called after connection is established and authenticated.
   * Use for welcome messages, room subscriptions, initializing state.
   * Should not throw; errors are logged.
   */
  onOpen?(ctx: OpenContext<TData>): void;

  /**
   * Called when connection closes (after cleanup).
   * Use for cleanup (unsubscribing from rooms, releasing resources).
   * Should not throw; errors are logged.
   */
  onClose?(ctx: CloseContext<TData>): void;

  /**
   * Called when an unhandled error occurs in a handler or middleware.
   * Use for error tracking (Sentry, DataDog), logging, alerting.
   * Should not throw; errors are logged and swallowed.
   */
  onError?(error: Error, ctx?: { type: string; userId?: string }): void;

  /**
   * Called when router.publish() is invoked (before send).
   * Use for broadcast analytics, message filtering, metrics.
   * Should not throw; errors are logged and swallowed.
   */
  onBroadcast?(message: any, scope: string): void;
}
```

### Hook Signatures in `serve()`

```typescript
serve(router, {
  port: 3000,

  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "123" } : undefined;
  },

  onError(error, ctx) {
    console.error(`Error in ${ctx?.type}:`, error.message);
    // Forward to error tracking service
    Sentry.captureException(error, {
      tags: { messageType: ctx?.type },
      extra: { userId: ctx?.userId },
    });
  },

  onBroadcast(message, scope) {
    console.log(`Broadcast to ${scope}:`, message.type);
    // Track broadcast patterns for analytics
    analytics.track("broadcast", { scope, messageType: message.type });
  },

  onUpgrade(req) {
    console.log(`WebSocket upgrade from ${req.headers.get("user-agent")}`);
    // Track connection sources
  },

  onOpen(ctx) {
    console.log(`Connection opened for userId ${ctx.ws.data?.userId}`);
    // Send welcome message
    ctx.send(WelcomeMessage, { greeting: "Welcome!" });
  },

  onClose(ctx) {
    console.log(`Connection closed for userId ${ctx.ws.data?.userId}`);
    // Cleanup (rooms, subscriptions, etc.)
  },
});
```

### Hook Examples by Use Case

#### `onUpgrade`: Connection Tracking

```typescript
serve(router, {
  onUpgrade(req) {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";
    console.log(`[UPGRADE] ${ip} - ${userAgent}`);

    // Track in metrics
    metrics.increment("websocket.upgrade");
  },
});
```

#### `onOpen`: Welcome Message & Setup

```typescript
serve(router, {
  onOpen(ctx) {
    const userId = ctx.ws.data?.userId;
    console.log(`[OPEN] User ${userId} connected`);

    // Send welcome message
    ctx.send(WelcomeMessage, {
      greeting: "Welcome!",
      timestamp: Date.now(),
    });

    // Subscribe to user's updates
    if (userId) {
      ctx.subscribe(`user:${userId}`);
    }
  },
});
```

#### `onClose`: Cleanup & Metrics

```typescript
serve(router, {
  onClose(ctx) {
    const userId = ctx.ws.data?.userId;
    const duration = Date.now() - (ctx.ws.data as any).connectedAt;
    console.log(`[CLOSE] User ${userId} disconnected after ${duration}ms`);

    // Clean up resources
    cleanupUserSession(userId);

    // Update metrics
    metrics.histogram("websocket.session_duration", duration);
  },
});
```

#### `onError`: Error Tracking Integration

```typescript
import * as Sentry from "@sentry/node";

serve(router, {
  onError(error, ctx) {
    console.error(`[ERROR] ${ctx?.type || "unknown"}: ${error.message}`);

    // Send to error tracking service
    Sentry.captureException(error, {
      tags: {
        messageType: ctx?.type,
        userId: ctx?.userId,
      },
      level: "error",
    });
  },
});
```

#### `onBroadcast`: Broadcast Analytics

```typescript
serve(router, {
  onBroadcast(message, scope) {
    console.log(`[BROADCAST] ${scope} <- ${message.type}`);

    // Track broadcast patterns
    analytics.track("broadcast", {
      scope,
      messageType: message.type,
      payloadSize: JSON.stringify(message).length,
    });
  },
});
```

### Hook Execution Flow

**Connection Upgrade:**

1. `onUpgrade()` called (before authentication)
2. `authenticate()` called (set initial data)
3. `onOpen()` called (after authenticated)
4. Message handlers execute
5. `onClose()` called (after disconnect)

**Message Handling:**

1. Middleware executes
2. Handler executes
3. If unhandled error: `onError()` called
4. `onBroadcast()` called (if `router.publish()` invoked)

### Hook Guarantees

- **`onError, onBroadcast`:** Called after the action (handler error, broadcast sent)
- **`onUpgrade`:** Called before authentication (can log but not prevent)
- **`onOpen, onClose`:** Called after state change (connection open/closed)
- **All hooks** are called even if they throw; exceptions logged, never rethrown
- **Hooks cannot modify operations** — Can observe, log, or trigger side effects only

## Request/Response Semantics

### Disambiguate One-Way vs. Request/Response

```typescript
// One-way message (broadcast, notification)
router.on(RoomUpdateMessage, (ctx) => {
  updateRoom(ctx.payload);
  ctx.send(RoomUpdatedMessage, { roomId: ctx.payload.roomId });
});

// Request/response pattern (query, update with response)
router.on(QueryUserMessage, (ctx) => {
  const user = findUserById(ctx.payload.userId);
  // ✅ reply() explicitly signals response to request
  ctx.send(QueryUserResponseMessage, user);
});
```

**Implementation:**

```typescript
// reply() is an alias to send(); semantically clearer
interface MessageContext<S extends MessageSchema, TData> {
  send<R extends MessageSchema>(schema: R, payload: InferPayload<R>): void;
  reply<R extends MessageSchema>(schema: R, payload: InferPayload<R>): void;
}

// In router implementation:
const ctx = {
  send(schema, payload) {
    this.ws.send(encodeMessage({ type: schema.shape.type.value, payload }));
  },
  reply(schema, payload) {
    // Same as send(), but with clearer intent for request/response
    this.send(schema, payload);
  },
};
```

## Error Handling Flow

### In Handlers

```typescript
router.on(ProcessMessage, (ctx) => {
  try {
    const result = processData(ctx.payload);
    ctx.send(ProcessedMessage, result);
  } catch (err) {
    // Caught error in handler
    ctx.error("INTERNAL_ERROR", "Processing failed", {
      reason: String(err),
    });
    // onError hook is called with the error
  }
});
```

### In Middleware

```typescript
router.use((ctx, next) => {
  try {
    const allowed = checkAccess(ctx.ws.data?.userId);
    if (!allowed) {
      ctx.error("AUTH_ERROR", "Access denied");
      return; // Skip handler
    }
  } catch (err) {
    // Caught error in middleware
    console.error("Access check failed:", err);
    ctx.error("INTERNAL_ERROR", "Could not verify access");
    // onError hook is called
    return;
  }
  return next();
});
```

### Uncaught Errors

If an error escapes handlers or middleware:

```typescript
router.on(BadMessage, (ctx) => {
  throw new Error("Unexpected error");
  // Router catches this error
  // Calls onError hook with error object
  // Sends generic error to client (don't expose internal details)
});
```

**onError hook receives:**

```typescript
onError(error, ctx) {
  // error: The thrown Error object
  // ctx.type: Message type that caused error (if from handler)
  // ctx.userId: Connection userId (if authenticated)
}
```

## Error Propagation Examples

### Handler Error

```typescript
router.on(QueryMessage, (ctx) => {
  // Throws error
  throw new Error("Database connection failed");
});

// Flow:
// 1. Router catches error
// 2. onError hook called: onError(error, { type: "QUERY", userId: "123" })
// 3. Generic error sent to client: { code: "INTERNAL_ERROR", message: "..." }
// 4. Handler return early (connection stays open)
```

### Middleware Error

```typescript
router.use((ctx, next) => {
  // Throws error
  throw new Error("Permission check failed");
});

// Flow:
// 1. Router catches error during middleware execution
// 2. onError hook called: onError(error, { type: message type, userId: "..." })
// 3. Generic error sent to client
// 4. Handler NOT executed (middleware error prevents it)
```

### Error in onError Hook Itself

```typescript
onError(error, ctx) {
  // Throws error
  throw new Error("Failed to log error");
  // This error is caught, logged to console
  // Never rethrown (don't create cascading failures)
}
```

## Consequences

### Benefits

✅ **Type-safe errors** — Discriminated union of error codes enforced by TypeScript
✅ **Consistent error format** — All errors sent via standard `ErrorMessage` schema
✅ **Centralized error logging** — `onError` hook for one place to handle errors
✅ **Observability** — Lifecycle hooks provide visibility into connection and message events
✅ **Request/response clarity** — `reply()` makes intent explicit
✅ **Familiar pattern** — Express/Hono-style hooks are well-known
✅ **No cascading failures** — Hook errors are caught and logged, never rethrown

### Trade-offs

⚠️ **Error codes are fixed** — Limited to predefined set (though can be extended via user schemas)
⚠️ **Hook ordering matters** — Developers need to understand execution flow
⚠️ **Details leak risk** — Must be careful not to expose internal error details to client
⚠️ **Hook responsibilities** — Hooks should not throw; developers must wrap in try/catch

## Extending Error Codes

Applications can extend standard error codes:

```typescript
// types/app-errors.d.ts
declare module "@ws-kit/core" {
  interface ErrorCodes {
    DUPLICATE_EMAIL: true;
    RATE_LIMIT_EXCEEDED: true;
    CUSTOM_DOMAIN_ERROR: true;
  }
}

// Usage
ctx.error("DUPLICATE_EMAIL", "Email already registered");
ctx.error("RATE_LIMIT_EXCEEDED", "Too many requests", { retryAfter: 60 });
ctx.error("CUSTOM_DOMAIN_ERROR", "Custom error from application");
```

## Alternatives Considered

### 1. Custom Error Message Per Handler

Let developers define custom error schemas:

```typescript
const CustomError = message("CUSTOM_ERROR", {
  code: z.string(),
  message: z.string(),
});

router.on(SomeMessage, (ctx) => {
  ctx.send(CustomError, { code: "MY_ERROR", message: "..." });
});
```

**Why not instead:** Doesn't reduce boilerplate; doesn't provide standard error codes; no centralized logging hook.

### 2. Exception-Based Error Handling

Throw exceptions; router catches and converts to error messages:

```typescript
class ValidationError extends Error {
  code = "VALIDATION_ERROR";
}

router.on(ValidateMessage, (ctx) => {
  if (!isValid(ctx.payload)) {
    throw new ValidationError("Invalid input");
  }
});

// Router catches and sends to client
```

**Why not instead:** Less ergonomic than `ctx.error()`; requires exception overhead; harder to pass error details.

### 3. Response Union Type

Handler returns result or error:

```typescript
type HandlerResult<T> = { ok: true; data: T } | { ok: false; error: ErrorCode };

router.on(SomeMessage, (ctx): HandlerResult<Response> => {
  if (!isValid(ctx.payload)) {
    return { ok: false, error: "VALIDATION_ERROR" };
  }
  return { ok: true, data: /* ... */ };
});
```

**Why not instead:** Cumbersome return types; doesn't integrate with standard messaging; error sending is implicit.

## References

- **ADR-005**: Builder Pattern (supports `ctx.error()` method)
- **ADR-008**: Middleware Support (error handling in middleware chain)
- **ADR-006**: Multi-Runtime `serve()` (hooks passed to serve)
- **Implementation**:
  - `packages/core/src/router.ts` — Error hook execution and lifecycle
  - `packages/core/src/messages.ts` — Standard `ErrorMessage` schema
  - `packages/zod/src/index.ts` — Exports standard error codes and `ErrorMessage`
  - `packages/valibot/src/index.ts` — Mirror for Valibot
- **Examples**:
  - `examples/quick-start/index.ts` — Error handling examples
  - `examples/*/error-handling/*.ts` — Domain-specific error patterns
- **Related**: CLAUDE.md — Error handling patterns in Quick Start
