# WebSocket Router Specification

**Status**: ✅ Implemented

## Overview

Type-safe message routing for Bun WebSocket servers with automatic validation.

## Section Map

Quick navigation for AI tools:

- [#Basic-Setup](#basic-setup) — Minimal router example
- [#Router-API](#router-api) — Handler registration, middleware, and context types
- [#Message-Routing](#message-routing) — Type-based dispatch and validation flow
- [#Type-Safe-Sending](#type-safe-sending) — One-way and request/response patterns
- [#Subscriptions-&-Publishing](#subscriptions--publishing) — Type-safe pub/sub with cleanup rules
- [#Custom-Connection-Data](#custom-connection-data) — Typed connection state
- [#Modifying-Connection-Data](#modifying-connection-data) — Update connection data with ctx.assignData()
- [#Error-Handling](#error-handling) — Type-safe errors with ctx.error()
- [#Lifecycle-Hooks](#lifecycle-hooks) — Observability with onOpen, onClose, onError, onBroadcast, onUpgrade

## Basic Setup

**Recommended: Platform-Specific Entrypoint** (zero detection overhead)

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve/bun";

type AppData = { userId?: string };
const router = createRouter<AppData>();

const PingMessage = message("PING", { value: z.number() });
const PongMessage = message("PONG", { reply: z.number() });

router.onMessage(PingMessage, (ctx) => {
  console.log("Ping from:", ctx.ws.data.clientId);
  console.log("Received at:", ctx.receivedAt);
  // ✅ ctx.payload is fully typed - no 'as any' needed!
  ctx.reply(PongMessage, { reply: ctx.payload.value * 2 });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "user-123" } : undefined;
  },
});
```

This pattern is recommended because:

- ✅ Zero runtime detection overhead
- ✅ Optimal tree-shaking (imports only your target platform)
- ✅ Explicit deployment target (impossible to misconfigure)
- ✅ Works for all platforms (Bun, Cloudflare, Deno, testing)

**Alternative: Explicit Runtime Selection** (multi-target code)

For code that deploys to multiple runtimes, use explicit `runtime` option:

```typescript
import { serve } from "@ws-kit/serve";

serve(router, {
  port: 3000,
  runtime: "bun", // Required in production; optional in development for auto-detection
  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "user-123" } : undefined;
  },
});
```

Or set the `WSKIT_RUNTIME` environment variable: `WSKIT_RUNTIME=bun bun start`

## Creating a Router

Use `createRouter<TData>()` with an explicit generic for full type safety:

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();
```

**Why explicit?** TypeScript cannot infer connection data types from handler assignments. The explicit generic ensures all handlers and lifecycle callbacks are fully typed:

```typescript
router.onMessage(SomeMessage, (ctx) => {
  // ✅ ctx.ws.data is fully typed as AppData
  const userId = ctx.ws.data.userId; // string | undefined
  const roles = ctx.ws.data.roles; // string[] | undefined
});

router.onClose((ctx) => {
  // ✅ Still correctly typed
  const userId = ctx.ws.data.userId; // string | undefined
});
```

This is a **TypeScript language limitation** (not a design shortcoming). The one-line generic annotation provides complete type safety throughout your application.

### Ambient AppData (Optional: Large Applications)

For large applications with many routers across modules, use TypeScript declaration merging to set a global default and avoid repetition:

```typescript
// types/app-data.d.ts
declare module "@ws-kit/core" {
  interface AppDataDefault {
    userId?: string;
    roles?: string[];
  }
}

// Now createRouter() uses AppDataDefault without repeating the type:
import { createRouter } from "@ws-kit/zod";

const router = createRouter(); // ✅ Automatically uses AppDataDefault
```

This is optional and most useful in large monorepos with shared auth context.

### Structured Logging (Optional)

For production deployments, configure a logger for observability with Winston, Pino, Datadog, or custom integrations:

```typescript
import { createRouter } from "@ws-kit/zod";
import { createLogger, LOG_CONTEXT } from "@ws-kit/core";

// Create custom logger
const logger = createLogger({
  minLevel: "info", // Only log info/warn/error, skip debug
  log: (level, context, message, data) => {
    // Send to logging service (e.g., Datadog, Splunk)
    logService.send({
      level,
      context,
      message,
      ...data,
    });
  },
});

const router = createRouter({
  logger, // Pass to router options
});
```

**Available contexts** (via `LOG_CONTEXT`):

- `CONNECTION` — Connection lifecycle (open, close, errors)
- `HEARTBEAT` — Heartbeat / stale connection detection
- `MESSAGE` — Message routing
- `MIDDLEWARE` — Middleware execution
- `AUTH` — Authentication events
- `VALIDATION` — Schema validation failures
- `ERROR` — Unhandled errors

If not provided, the router logs to console by default. See ADR-011 for design rationale.

### Router Design (Builder Pattern)

The router is implemented as a **plain JavaScript object** that forwards method calls to an internal core router. This transparent builder pattern ensures:

- ✅ **Zero overhead** — Plain object method forwarding, no Proxy traps in production
- ✅ **Type preservation** — Full inference from schema through handlers
- ✅ **Clean stack traces** — No Proxy indirection
- ✅ **Platform agnostic** — Router accepts any platform adapter directly

**In production** (`NODE_ENV === "production"`), the router is always a materialized plain object with zero introspection overhead.

**In development**, an optional Proxy wrapper can provide runtime assertions and typo detection (off by default).

### Advanced: Symbol Escape Hatch

> **⚠️ Use with caution**: This is an internal implementation detail. The public API never requires it.

For advanced introspection (rare; prefer `router.debug()` for most use cases), access the core router via Symbol:

```typescript
const core = (router as any)[Symbol.for("ws-kit.core")];

// Uncommon use cases:
// - Custom meta-programming tooling
// - Advanced middleware inspection
// - Framework integration requiring router internals
```

**Why a Symbol?**

- Follows industry standards (`React.for("react.element")`)
- Signals internal/private API to TypeScript and developers
- Prevents accidental namespace collisions

**When NOT to use:**

- Regular message handling → Use `router.onMessage()`
- Publishing messages → Use `router.publish()`
- Debugging → Use `router.debug()`
- Middleware registration → Use `router.use()`

**When it's appropriate:**

- Building custom tooling that inspects route definitions
- Framework integration requiring low-level metadata access
- Advanced testing utilities with assertions on internal state

### Debug/Assertions

**Development Mode (Optional Proxy Wrapper)**

In development (`NODE_ENV !== "production"`), you can enable an optional Proxy wrapper around the router for runtime assertions and typo detection:

```typescript
import { createRouter } from "@ws-kit/zod";

// Enable assertions in development
const router = createRouter<AppData>({
  debug: true, // Opt-in; off by default
});

// The Proxy catches common mistakes:
router.onMesssage(schema, handler); // ❌ Throws: "Did you mean onMessage?"
router.onMessage(schema, handler); // ✅ Works
```

The debug Proxy **is never used in production** — code always uses a plain object with zero overhead. This provides development convenience without impacting performance. Assertions include typo detection for method names, missing handlers, and invalid message type registration. To disable assertions in development, omit `debug: true` or set it to `false`.

### Static Method Calls (Required)

Always use static method calls on the router. Dynamic property access defeats type preservation:

```typescript
// ✅ SAFE: Static method calls
router.onMessage(LoginSchema, handler);
router.use(middleware);

// ❌ UNSAFE: Dynamic property access
const m = "onMessage";
(router as any)[m](schema, handler); // Bypasses type safety
```

## Router API

### Message Handlers

```typescript
router.onMessage<Schema extends MessageSchemaType>(
  schema: Schema,
  handler: MessageHandler<Schema, Data>
): WebSocketRouter<Data>
```

**Handler Context**:

```typescript
type MessageContext<Schema, Data> = {
  ws: ServerWebSocket<Data>; // Connection (ws.data.clientId always present)
  type: Schema["shape"]["type"]["value"]; // Message type literal
  meta: z.infer<Schema["shape"]["meta"]>; // Validated client metadata
  payload: z.infer<Schema["shape"]["payload"]>; // Only if schema defines it
  receivedAt: number; // Server receive timestamp (Date.now())
  send: SendFunction; // Type-safe send function (broadcast/one-way)
  reply: ReplyFunction; // Semantic alias to send() for request/response patterns
  error: ErrorFunction; // Type-safe error responses (see ADR-009)
  assignData: AssignDataFunction; // Merge partial data into ctx.ws.data
  subscribe: SubscribeFunction; // Subscribe to a channel
  unsubscribe: UnsubscribeFunction; // Unsubscribe from a channel
};
```

**Server-provided context fields**:

- `ctx.ws.data.clientId`: Connection identity (UUID v7, generated during upgrade)
- `ctx.receivedAt`: Server receive timestamp (milliseconds since epoch)

**Type Safety**: `ctx.payload` exists only when schema defines it:

```typescript
const WithPayload = messageSchema("WITH", { id: z.number() });
const WithoutPayload = messageSchema("WITHOUT");

router.onMessage(WithPayload, (ctx) => {
  const id = ctx.payload.id; // ✅ Typed as number
});

router.onMessage(WithoutPayload, (ctx) => {
  const p = ctx.payload; // ❌ Type error
});
```

### Middleware

Middleware runs before handlers and can modify context or skip execution:

```typescript
// Global middleware (runs for all messages)
router.use((ctx, next) => {
  // Runs before any handler
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return; // Skip handler
  }
  return next(); // Continue to handler
});

// Per-route middleware (runs only for specific message type)
router.use(SendMessage, (ctx, next) => {
  // Rate limiting
  if (isRateLimited(ctx.ws.data?.userId)) {
    ctx.error("RATE_LIMIT", "Too many messages");
    return; // Skip handler
  }
  return next();
});

router.onMessage(SendMessage, (ctx) => {
  // Handler runs if all middleware calls next()
  processMessage(ctx.payload);
});
```

**Middleware Semantics:**

- **Execution Order**: Global middleware first, then per-route middleware, then handler
- **Skipping Handlers**: If middleware doesn't call `next()` (or calls `ctx.error()`), the handler is skipped
- **Context Mutation**: Middleware may mutate `ctx.ws.data` (via `ctx.assignData()`) and handlers see updates
- **Asynchronous**: Both sync and async middleware are supported
- **Error Handling**: Middleware can call `ctx.error()` to reject messages or throw to trigger `onError` hook
- **Same Context**: Middleware sees the same context type and fields as handlers

**Example: Authentication + Authorization Middleware**

```typescript
type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

// Global middleware: require authentication
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && !["LOGIN", "REGISTER"].includes(ctx.type)) {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return; // Handler is skipped
  }
  return next();
});

// Per-route middleware: admin-only check for dangerous operations
router.use(DeleteMessage, (ctx, next) => {
  if (!ctx.ws.data?.roles?.includes("admin")) {
    ctx.error("AUTH_ERROR", "Admin access required");
    return;
  }
  return next();
});

router.onMessage(DeleteMessage, (ctx) => {
  // Only reached if both middleware called next()
  deleteItem(ctx.payload.id);
});
```

### Connection Lifecycle

```typescript
router.onOpen((ctx) => {
  // ctx: { ws, send, subscribe, unsubscribe }
  console.log("Client connected:", ctx.ws.data.clientId);
});

router.onClose((ctx) => {
  // ctx: { ws, code, reason, send, subscribe, unsubscribe }
  console.log(
    "Client disconnected:",
    ctx.ws.data.clientId,
    ctx.code,
    ctx.reason,
  );
});
```

### WebSocket Upgrade

```typescript
router.upgrade(req, {
  server,
  data: { userId: "123" },  // Custom connection data
  headers: { ... }
});

// Connection data type
type WebSocketData<T> = {
  clientId: string;  // Auto-generated UUID v7
} & T;
```

**Connection identity**:

- `clientId` is generated during upgrade (UUID v7, time-ordered)
- Accessible via `ctx.ws.data.clientId` in all handlers
- NOT included in message `meta` (connection state, not message state)

### Route Composition

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = { userId?: string };

const authRouter = createRouter<AppData>();
authRouter.onMessage(LoginMessage, handleLogin);

const chatRouter = createRouter<AppData>();
chatRouter.onMessage(SendMessage, handleChat);

const mainRouter = createRouter<AppData>()
  .addRoutes(authRouter)
  .addRoutes(chatRouter);
```

**Type System Note**: All routers should define the same `TData` type for composition to work correctly. Type compatibility is enforced at compile time.

## Message Routing

### Type-Based Routing

Messages route by `type` field. Last registered handler wins:

```typescript
router.onMessage(TestMessage, handler1);
router.onMessage(TestMessage, handler2); // ⚠️ Overwrites handler1
// Console: Handler for "TEST" is being overwritten
```

### Validation Flow

```text
Client Message → JSON Parse → Type Check → Handler Lookup → Normalize → Validation → Handler
```

**CRITICAL**: Normalization is a **security boundary**. Handlers MUST NEVER receive un-normalized input. Reserved keys (`clientId`, `receivedAt`) are stripped before validation to prevent spoofing.

- Parse error → Logged, ignored
- Missing type → Logged, ignored
- No handler → Logged, ignored
- Normalization → Strip reserved keys (security boundary)
- Validation error → Logged, handler not called
- Handler error → Logged, connection stays open

## Type-Safe Sending

### One-Way Messages (Broadcast/Notify)

```typescript
const ResponseMsg = message("RESPONSE", { result: z.string() });

router.onMessage(SomeMessage, (ctx) => {
  ctx.send(ResponseMsg, { result: "ok" }); // ✅ Broadcast/notify semantics
  ctx.send(ResponseMsg, { result: 123 }); // ❌ Type error
});
```

### Request/Response Pattern

Use `ctx.reply()` for semantic clarity when responding to a request:

```typescript
const QueryMessage = message("QUERY", { id: z.string() });
const QueryResponse = message("QUERY_RESPONSE", { result: z.any() });

router.onMessage(QueryMessage, (ctx) => {
  const result = database.query(ctx.payload.id);
  ctx.reply(QueryResponse, { result }); // ✅ Semantically clear: responding to a request
});
```

**Note**: `ctx.reply()` and `ctx.send()` are identical at runtime; use `reply()` to clarify intent in request/response patterns.

**Outbound metadata**: Both `ctx.send()` and `ctx.reply()` automatically add `timestamp` to `meta` (producer time for UI display; **server logic MUST use `ctx.receivedAt`**, not `meta.timestamp` — see @schema.md#Which-timestamp-to-use).

**For broadcasting to multiple clients**, see @broadcasting.md for multicast patterns using Bun's native pubsub.

## Subscriptions & Publishing

Use type-safe publish/subscribe to send messages to multiple connections via named topics:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roomId?: string };

const RoomMessage = message("ROOM_MESSAGE", { text: z.string() });
const UserTyping = message("USER_TYPING", { userId: z.string() });

const router = createRouter<AppData>();

// Subscribe to a room when joining
router.onMessage(JoinRoom, (ctx) => {
  const roomId = ctx.payload.roomId;
  ctx.assignData({ roomId });
  ctx.subscribe(`room:${roomId}`); // Subscribe to room topic
});

// Publish to room when sending a message
router.onMessage(RoomMessage, (ctx) => {
  const roomId = ctx.ws.data?.roomId;
  if (!roomId) return;

  // Type-safe publish: schema enforces payload structure at compile time
  router.publish(`room:${roomId}`, RoomMessage, {
    text: ctx.payload.text,
  });
});

// Unsubscribe when client leaves room
router.onMessage(LeaveRoom, (ctx) => {
  const roomId = ctx.ws.data?.roomId;
  if (roomId) {
    ctx.unsubscribe(`room:${roomId}`);
    ctx.assignData({ roomId: undefined });
  }
});

// Automatic cleanup on disconnect
router.onClose((ctx) => {
  const roomId = ctx.ws.data?.roomId;
  if (roomId) {
    // Cleanup: notify room that user left
    router.publish(`room:${roomId}`, UserLeft, {
      userId: ctx.ws.data?.userId || "anonymous",
    });
  }
});
```

**API:**

- `ctx.subscribe(topic)` — Subscribe to a topic; messages published to this topic are sent to the connection
- `ctx.unsubscribe(topic)` — Unsubscribe from a topic
- `router.publish<Schema>(topic, schema, payload)` — Type-safe publish; payload validated by schema at compile time

**Critical Rules:**

1. **Validation Before Broadcast**: Payloads are validated at compile time (schema type inference). Runtime validation occurs before message transmission to ensure integrity
2. **Cleanup on Disconnect**: Always unsubscribe in `onClose()` or via `ctx.unsubscribe()` to prevent memory leaks. For most cases, the connection closing automatically removes subscriptions
3. **No Handler Trigger**: `router.publish()` does NOT trigger handlers on the publishing connection; it broadcasts to subscribers only
4. **Topic Scoping**: Topics are arbitrary strings; use naming conventions like `room:123`, `user:456:notifications` for clarity
5. **Ordering**: Messages published to a topic are delivered in order to all subscribers at the time of publish

## Custom Connection Data

Define your connection data shape and pass it as a generic to `createRouter()`:

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = {
  userId: string;
  roles: string[];
};

const router = createRouter<AppData>();

router.onMessage(SecureMessage, (ctx) => {
  const userId = ctx.ws.data.userId; // ✅ Typed (string)
  const roles = ctx.ws.data.roles; // ✅ Typed (string[])
  const clientId = ctx.ws.data.clientId; // ✅ Always present (auto-added)
  const receivedAt = ctx.receivedAt; // ✅ Server timestamp
});

// Initialize connection data during serve()
serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    if (!token) return undefined;

    const decoded = decodeToken(token);
    return {
      userId: decoded.id,
      roles: decoded.roles,
    };
  },
});
```

**Note**: `clientId` is automatically generated and added to `ctx.ws.data` during WebSocket upgrade—you don't need to include it in your type definition.

## Modifying Connection Data

Use `ctx.assignData()` to merge partial updates into connection state:

```typescript
type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

router.onMessage(LoginMessage, (ctx) => {
  const user = authenticate(ctx.payload);
  // Merge new fields into ctx.ws.data
  ctx.assignData({ userId: user.id, roles: user.roles });
});

router.onMessage(SecureMessage, (ctx) => {
  // Later handlers see the updated data
  const userId = ctx.ws.data.userId; // ✅ Now available
  const roles = ctx.ws.data.roles; // ✅ Now available
});
```

**Write-Partial Pattern**: `ctx.assignData()` merges partial updates; you don't need to provide all fields. This enables middleware and handlers to incrementally build connection context.

## Error Handling

Use `ctx.error()` for type-safe, discriminated error responses (see ADR-009 for design rationale):

```typescript
router.onMessage(LoginMessage, (ctx) => {
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
  } catch (error) {
    ctx.error("INTERNAL_ERROR", "Authentication service unavailable");
  }
});

router.onMessage(QueryMessage, (ctx) => {
  try {
    const result = queryDatabase(ctx.payload);
    ctx.reply(QueryResponse, result);
  } catch (error) {
    ctx.error("INTERNAL_ERROR", "Database query failed", {
      reason: String(error),
    });
  }
});
```

**Standard Error Codes**:

- `VALIDATION_ERROR` — Invalid payload or schema mismatch
- `AUTH_ERROR` — Authentication failed
- `INTERNAL_ERROR` — Server error
- `NOT_FOUND` — Resource not found
- `RATE_LIMIT` — Rate limit exceeded

**Error Propagation**: If a handler throws an unhandled error, the router catches it and calls the `onError` lifecycle hook (if registered). See [Lifecycle Hooks](#lifecycle-hooks) for details.

## Lifecycle Hooks

Register lifecycle hooks in `serve()` options for observability and side effects:

```typescript
serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "123" } : undefined;
  },

  onUpgrade(req) {
    // Called during WebSocket upgrade (before authentication)
    console.log(`Connection from ${req.headers.get("user-agent")}`);
  },

  onOpen(ctx) {
    // Called after connection is authenticated
    console.log(`User ${ctx.ws.data?.userId} connected`);
    ctx.send(WelcomeMessage, { greeting: "Welcome!" });
  },

  onClose(ctx) {
    // Called after connection closes
    console.log(`User ${ctx.ws.data?.userId} disconnected (code: ${ctx.code})`);
  },

  onError(error, ctx) {
    // Called when unhandled error occurs in handler or middleware
    console.error(`Error in ${ctx?.type || "connection"}:`, error.message);
    // Forward to error tracking service
    Sentry.captureException(error, {
      tags: { messageType: ctx?.type },
      extra: { userId: ctx?.userId },
    });
  },

  onBroadcast(message, scope) {
    // Called when router.publish() is invoked
    console.log(`Broadcast to ${scope}:`, message.type);
    // Track broadcast patterns for analytics
    analytics.track("broadcast", { scope, messageType: message.type });
  },
});
```

**Hook Execution Order**:

1. `onUpgrade()` — Connection upgrade initiated (before authentication)
2. `authenticate()` — Set initial connection data
3. `onOpen()` — After authenticated (safe to send messages)
4. [Handler executes]
5. `onClose()` — After connection closes
6. `onError()` — When unhandled error occurs in handler or middleware

**Hook Guarantees**:

- Hooks are called even if they throw; exceptions logged, never rethrown
- `onError`, `onBroadcast` called after the action completes
- `onUpgrade`, `onOpen`, `onClose` called after state change
- Hooks can observe and trigger side effects, but cannot modify operations

## Production Runtime Selection

Always explicitly specify your deployment target in production. Two recommended approaches:

### Primary: Platform-Specific Entrypoint

```typescript
import { serve } from "@ws-kit/serve/bun";
// or: import { serve } from "@ws-kit/serve/cloudflare-do";
// or: import { serve } from "@ws-kit/serve/deno";

serve(router, {
  port: 3000,
  authenticate(req) {
    /* ... */
  },
});
```

**Benefits:**

- ✅ Zero runtime detection — No capability checks, deterministic behavior
- ✅ Optimal tree-shaking — Only imports your target platform handler
- ✅ Fast — No detection overhead or error handling
- ✅ Explicit — Deployment target clear in source code
- ✅ Safe — Impossible to misconfigure

This is the **recommended approach** for all production deployments.

### Alternative: Explicit `runtime` Option

For code that deploys to multiple targets from the same source:

```typescript
import { serve } from "@ws-kit/serve";

serve(router, {
  port: 3000,
  runtime: "bun", // Explicit in production; optional in development for auto-detection
  authenticate(req) {
    /* ... */
  },
});
```

**Runtime options**: `"bun"` | `"cloudflare-do"` | `"deno"`

You can also set `WSKIT_RUNTIME=bun` as an environment variable at deployment time.

### Development: Auto-Detection (Optional)

In development only, `serve()` can auto-detect via capability checks (disabled in production):

```typescript
import { serve } from "@ws-kit/serve";

// Auto-detected in development only (convenience)
serve(router, { port: 3000 });
```

**Recommendation**: Even in development, use an explicit approach to catch configuration errors early and ensure your deployment process is always correct.

## Key Constraints

> See @rules.md for complete rules. Critical for routing:

1. **Connection identity** — Access via `ctx.ws.data.clientId`, never `ctx.meta` (see @rules.md#state-layering)
2. **Server timestamp** — Use `ctx.receivedAt` for authoritative time (see @schema.md#Which-timestamp-to-use)
3. **Payload typing** — `ctx.payload` exists only when schema defines it (see ADR-001)
4. **Type-safe errors** — Use `ctx.error()` with discriminated union error codes (see ADR-009 for design rationale)
5. **Connection data updates** — Use `ctx.assignData()` to merge partial updates (write-partial pattern)
6. **Middleware execution** — Global runs first, then per-route, then handler (see ADR-008)
7. **Validation flow** — Trust schema validation; never re-validate in handlers (see @rules.md#validation-flow)
8. **Broadcasting** — For multicast messaging, see @broadcasting.md (not covered in this spec)
9. **Runtime selection** — Use explicit `runtime` option or platform-specific entrypoint in production (see ADR-006)
