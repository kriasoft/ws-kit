# API Reference

Complete API documentation for WS-Kit.

## Core Exports

### `@ws-kit/zod`

```typescript
import { z, message, rpc, createRouter } from "@ws-kit/zod";
```

- **`z`** - Re-exported Zod instance (canonical import source)
- **`message()`** - Create type-safe message schemas
- **`rpc()`** - Create request-response (RPC) schemas
- **`createRouter()`** - Create a type-safe WebSocket router

### `@ws-kit/valibot`

```typescript
import { v, message, rpc, createRouter } from "@ws-kit/valibot";
```

- **`v`** - Re-exported Valibot instance (canonical import source)
- **`message()`** - Create type-safe message schemas
- **`rpc()`** - Create request-response (RPC) schemas
- **`createRouter()`** - Create a type-safe WebSocket router

### `@ws-kit/client/zod` and `@ws-kit/client/valibot`

```typescript
import { wsClient } from "@ws-kit/client/zod";
// or
import { wsClient } from "@ws-kit/client/valibot";
```

- **`wsClient()`** - Create a type-safe WebSocket client

### `@ws-kit/bun`

```typescript
import { serve, createBunHandler } from "@ws-kit/bun";
```

- **`serve()`** - High-level server function
- **`createBunHandler()`** - Low-level handler for custom setups

### Platform & Pub/Sub Adapters

WS-Kit provides pluggable adapters for different deployment platforms and pub/sub implementations.

**Built-in adapters:**

```typescript
// Memory adapter (default, included in @ws-kit/core)
import { MemoryPubSub } from "@ws-kit/core";

// Bun platform adapter (included in @ws-kit/bun)
import { createBunHandler } from "@ws-kit/bun";

// Cloudflare Durable Objects adapter
import { createDurableObjectHandler } from "@ws-kit/cloudflare";
```

**Optional add-ons:**

```typescript
// Redis rate limiter and pub/sub for distributed deployments
import { redisPubSub, redisRateLimiter } from "@ws-kit/redis";

// In-memory pub/sub for local deployments
import { memoryPubSub } from "@ws-kit/memory";

// Middleware helpers for composing adapters and handlers
import {} from /* middleware utilities */ "@ws-kit/middleware";
```

For complete adapter documentation including configuration, guarantees, and platform-specific limits, see [Adapter Responsibilities](/specs/adapters).

---

## Schema Creation

### `message()`

Create a type-safe message schema. Supports both fire-and-forget messages and RPC-style request-response patterns.

**Signatures:**

```typescript
// Simple message (no payload)
function message<T extends string>(type: T): MessageSchema<T>;

// With payload (Zod object or raw shape)
function message<
  T extends string,
  P extends ZodObject<ZodRawShape> | ZodRawShape,
>(type: T, payload: P): MessageSchema<T, P>;

// With payload and custom metadata
function message<
  T extends string,
  P extends ZodObject<ZodRawShape> | ZodRawShape,
  M extends ZodRawShape,
>(type: T, payload: P, meta: M): MessageSchema<T, P, M>;

// Unified API with config object (payload, response, and/or meta)
function message<T extends string>(
  type: T,
  config: { payload?: P; response?: R; meta?: M },
): MessageSchema<T>;
```

**Parameters:**

- `type` - Unique message type identifier (string literal). Must not start with `$ws:` (reserved for internal control messages).
- `payload` - Zod object, raw shape, or config object for payload validation (optional)
- `meta` - Custom metadata schema fields (optional, cannot use reserved keys: clientId, receivedAt)

**Returns:** MessageSchema with full TypeScript inference

**Strict Validation:** All message schemas automatically reject unknown keys at root, meta, and payload levels. This prevents security issues and ensures wire format cleanliness.

**Reserved Message Type Prefix:** Message types starting with `$ws:` are reserved for internal control messages and will throw an error at schema creation time:

```typescript
// ❌ Throws: Reserved prefix "$ws:" not allowed
const BadMessage = message("$ws:custom", { data: z.string() });
```

**Examples:**

```typescript
import { z, message } from "@ws-kit/zod";

// Simple message (no payload)
const PingMessage = message("PING");

// With payload (raw shape)
const ChatMessage = message("CHAT_MESSAGE", {
  text: z.string(),
  roomId: z.string(),
});

// With Zod object
const ChatMessage = message(
  "CHAT_MESSAGE",
  z.object({
    text: z.string(),
    roomId: z.string(),
  }),
);

// With custom metadata
const TrackedMessage = message(
  "TRACKED_ACTION",
  { action: z.string() },
  { traceId: z.string() },
);

// ✅ RECOMMENDED: Unified config-based syntax (RPC/request-response)
const GetUser = message("GET_USER", {
  payload: { id: z.string() },
  response: { user: UserSchema },
});

// RPC with metadata
const TrackedAction = message("TRACKED_ACTION", {
  payload: { action: z.string() },
  response: { result: z.string() },
  meta: { traceId: z.string() },
});

// RPC with response only (no request payload)
const GetTime = message("GET_TIME", {
  response: { timestamp: z.number() },
});
```

**Reserved Meta Keys:** Cannot use `clientId` or `receivedAt` in custom metadata - these are server-controlled fields injected after validation.

### `rpc()`

Create a request-response (RPC) schema that binds request and response types.

**Note:** The `rpc()` function is maintained for backward compatibility. For new code, prefer the unified `message()` API with config object (see examples above). Both approaches work identically at runtime.

**Signature:**

```typescript
function rpc<
  ReqT extends string,
  ReqP extends ZodType | ValibotSchema | undefined,
  ResT extends string,
  ResP extends ZodType | ValibotSchema | undefined,
>(
  requestType: ReqT,
  requestPayload: ReqP,
  responseType: ResT,
  responsePayload: ResP,
): RpcSchema<ReqT, ReqP, ResT, ResP>;
```

**Reserved Prefix Validation:** Both `message()` and `rpc()` will throw an error at schema creation time if the message type starts with `$ws:`, as this prefix is reserved for internal control messages.

**Parameters:**

- `requestType` - Message type for the request
- `requestPayload` - Validation schema for request payload (use `undefined` for no payload)
- `responseType` - Message type for the response
- `responsePayload` - Validation schema for response payload (use `undefined` for no payload)

**Returns:** RPC schema with `.response` property for type inference

**Examples:**

```typescript
import { z, rpc } from "@ws-kit/zod";

// Simple RPC
const Ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });

// RPC with no payloads
const Heartbeat = rpc("HEARTBEAT", undefined, "HEARTBEAT_ACK", undefined);

// Complex RPC
const GetUser = rpc("GET_USER", { userId: z.string() }, "USER_RESPONSE", {
  user: UserSchema,
});
```

---

## Router API

### `createRouter()`

Create a type-safe WebSocket router.

**Signature:**

```typescript
function createRouter<TData extends WebSocketData = WebSocketData>(
  options?: WebSocketRouterOptions<ZodAdapter, TData>,
): WebSocketRouter<ZodAdapter, TData>;
```

**Type Parameters:**

- `TData` - Custom connection data type (extends `{ clientId: string }`)

**Options:**

```typescript
interface WebSocketRouterOptions<V, TData> {
  // Core adapters
  validator?: V; // Validator adapter (auto-configured by createRouter)
  platform?: PlatformAdapter; // Platform adapter (optional)
  pubsub?: PubSub; // PubSub implementation (lazy: MemoryPubSub on first use)

  // Lifecycle hooks
  hooks?: {
    onOpen?: OpenHandler<TData>;
    onClose?: CloseHandler<TData>;
    onAuth?: AuthHandler<TData>;
    onError?: ErrorHandler<TData>;
  };

  // Heartbeat configuration (opt-in — NOT initialized by default)
  // Only enable when explicitly configured in options.heartbeat
  heartbeat?: {
    intervalMs?: number; // Default: 30000 (milliseconds between heartbeats)
    timeoutMs?: number; // Default: 5000 (milliseconds to wait for heartbeat response)
    onStaleConnection?: (clientId: string, ws: ServerWebSocket<TData>) => void;
  };

  // Limits and configuration
  limits?: {
    maxPayloadBytes?: number; // Default: 1000000 (1MB)
  };
  socketBufferLimitBytes?: number; // Default: 1000000 (backpressure threshold)
  rpcTimeoutMs?: number; // Default: 30000
  dropProgressOnBackpressure?: boolean; // Default: true
  maxInflightRpcsPerSocket?: number; // Default: 1000
  rpcIdleTimeoutMs?: number; // Default: rpcTimeoutMs + 10000

  // Error handling
  autoSendErrorOnThrow?: boolean; // Default: true
  exposeErrorDetails?: boolean; // Default: false
  warnIncompleteRpc?: boolean; // Default: true (dev mode only)
}
```

**Example:**

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roles?: string[] };

const router = createRouter<AppData>({
  heartbeat: {
    intervalMs: 30000,
    timeoutMs: 5000,
  },
  limits: {
    maxPayloadBytes: 1_000_000,
  },
  autoSendErrorOnThrow: true,
  exposeErrorDetails: false,
});
```

### Router Methods

#### `on(schema, handler)`

Register a handler for fire-and-forget messages or pub/sub events.

```typescript
on<Schema extends MessageSchemaType>(
  schema: Schema,
  handler: EventHandler<Schema, TData>
): this;
```

**Parameters:**

- `schema` - Message schema created with `message()`
- `handler` - Event handler function (receives `EventMessageContext`)

**Returns:** Router instance for chaining

**Example:**

```typescript
router.on(ChatMessage, (ctx) => {
  // ctx.payload is fully typed
  console.log(`Message from ${ctx.data.userId}: ${ctx.payload.text}`);

  // Publish to room subscribers
  ctx.publish(`room:${ctx.payload.roomId}`, ChatMessage, ctx.payload);
});
```

#### `rpc(schema, handler)`

Register a handler for request-response (RPC) messages.

```typescript
rpc<Schema extends MessageSchemaType>(
  schema: Schema,
  handler: RpcHandler<Schema, TData>
): this;
```

**IMPORTANT:** The schema **must have a `.response` field** to be registered with `router.rpc()`. Use the `rpc()` helper function or `message()` with config object to create RPC schemas. For fire-and-forget messaging without a response, use `router.on()` instead.

**Parameters:**

- `schema` - RPC message schema created with `rpc()` or `message()` with `response` field
- `handler` - RPC handler function (receives `RpcMessageContext`)

**Returns:** Router instance for chaining

**Throws:** Error if schema does not have a `.response` field

**Example:**

```typescript
// Using config-based message (recommended)
const GetUser = message("GET_USER", {
  payload: { userId: z.string() },
  response: { user: UserSchema },
});

// Using legacy rpc() helper (still supported)
const GetUser = rpc("GET_USER", { userId: z.string() }, "USER_RESPONSE", {
  user: UserSchema,
});

router.rpc(GetUser, async (ctx) => {
  const user = await db.users.findById(ctx.payload.userId);

  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }

  // Terminal response (one-shot, correlation tracked)
  ctx.reply(GetUser.response, { user });
});
```

#### `off(schema)`

Unregister a handler for a specific message type.

```typescript
off<Schema extends MessageSchemaType>(schema: Schema): this;
```

**Parameters:**

- `schema` - Message schema to unregister

**Returns:** Router instance for chaining

#### `use(middleware)` — Global Middleware

Register middleware that runs for all messages.

```typescript
use(middleware: Middleware<TContext>): this;
```

**Parameters:**

- `middleware` - Middleware function with signature `(ctx, next) => Promise<void>`

**Returns:** Router instance for chaining

**Context Type:**

Middleware receives `MinimalContext<TContext>`:

```typescript
type Middleware<TContext extends ConnectionData = ConnectionData> = (
  ctx: MinimalContext<TContext>,
  next: () => Promise<void>,
) => Promise<void>;
```

Where `MinimalContext<TContext>` includes only connection data (`ctx.data`, `ctx.type`, `ctx.error()`, etc.), not the message payload.

**Examples:**

```typescript
// Global authentication middleware
router.use((ctx, next) => {
  if (!ctx.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
  return next();
});
```

#### `route(schema)` - Per-Route Middleware Registration

Register per-route middleware using the builder pattern.

```typescript
route<S extends MessageSchema>(schema: S): RouteBuilder<S, TContext>;
```

Returns a `RouteBuilder` for fluent registration:

```typescript
interface RouteBuilder<
  S extends MessageSchema,
  TContext extends ConnectionData = ConnectionData,
> {
  use(middleware: Middleware<TContext>): this;
  on(handler: MessageHandler<S, TContext>): this;
}
```

**Examples:**

```typescript
// Per-route rate limiting
router
  .route(SendMessage)
  .use((ctx, next) => {
    if (isRateLimited(ctx.data?.userId)) {
      ctx.error("RESOURCE_EXHAUSTED", "Too many messages");
      return;
    }
    return next();
  })
  .on((ctx) => {
    // Handle message
  });
```

#### `onOpen(handler)`, `onClose(handler)`, `onAuth(handler)`, `onError(handler)`

Register lifecycle hooks.

```typescript
onOpen(handler: OpenHandler<TData>): this;
onClose(handler: CloseHandler<TData>): this;
onAuth(handler: AuthHandler<TData>): this;
onError(handler: ErrorHandler<TData>): this;
```

**Handler Signatures:**

```typescript
type OpenHandler<TData> = (
  ctx: OpenHandlerContext<TData>,
) => void | Promise<void>;
type CloseHandler<TData> = (
  ctx: CloseHandlerContext<TData>,
) => void | Promise<void>;
type AuthHandler<TData> = (
  ctx: MessageContext<any, TData>,
) => boolean | Promise<boolean>;
type ErrorHandler<TData> = (
  error: WsKitError,
  ctx: MessageContext<any, TData>,
) => boolean | void;
```

**Examples:**

```typescript
router.onOpen((ctx) => {
  console.log(`Client ${ctx.clientId} connected`);
  ctx.send(WelcomeMessage, { text: "Welcome!" });
});

router.onClose((ctx) => {
  console.log(`Client ${ctx.clientId} disconnected: ${ctx.code}`);
});

router.onAuth((ctx) => {
  // Return false to reject connection
  return ctx.data?.userId !== undefined;
});

router.onError((error, ctx) => {
  console.error("Error:", error.code, error.message, error.details);
  // Return false to suppress automatic error response
  return false; // Suppress auto-send
});
```

#### `onLimitExceeded(handler)`

Register a handler for limit exceeded events (payload size, rate limiting, etc.).

```typescript
onLimitExceeded(handler: LimitExceededHandler<TData>): this;
```

**Handler Signature:**

```typescript
type LimitExceededHandler<TData> = (
  info: LimitExceededInfo<TData>,
) => void | Promise<void>;

type LimitExceededInfo<TData> =
  | {
      type: "payload";
      clientId: string;
      ws: ServerWebSocket<TData>;
      observed: number; // Actual payload size (bytes)
      limit: number; // Configured max payload size
    }
  | {
      type: "rate";
      clientId: string;
      ws: ServerWebSocket<TData>;
      observed: number; // Attempted cost (tokens)
      limit: number; // Rate limit capacity
      retryAfterMs: number | null; // null = impossible (cost > capacity)
    };
```

**Returns:** Router instance for chaining

**Example:**

```typescript
router.onLimitExceeded((info) => {
  if (info.type === "payload") {
    console.warn(
      `Client ${info.clientId} exceeded payload limit: ` +
        `${info.observed} > ${info.limit} bytes`,
    );
  } else if (info.type === "rate") {
    console.warn(
      `Client ${info.clientId} exceeded rate limit ` +
        `(attempted: ${info.observed}, capacity: ${info.limit})`,
    );
  }
});
```

#### `merge(router)`

Merge routes from another router.

```typescript
merge(router: WebSocketRouter<V, TData>): this;
```

**IMPORTANT:** Merging routers with different validators (e.g., Zod + Valibot) is type-safe but will cause runtime validation errors. Use `createRouter()` from the same package (`@ws-kit/zod` or `@ws-kit/valibot`) for all routers in a merge chain to avoid inconsistent validation.

**Parameters:**

- `router` - Another router to merge (must use same validator)

**Returns:** Router instance for chaining

**Example:**

```typescript
import { createRouter } from "@ws-kit/zod"; // Use same package

const authRouter = createRouter();
authRouter.on(LoginMessage, handleLogin);

const chatRouter = createRouter();
chatRouter.on(MessageMessage, handleMessage);

const mainRouter = createRouter().merge(authRouter).merge(chatRouter);
```

#### `publish(topic, schema, payload, options?)`

Publish a typed message to a topic (broadcasts to all subscribers).

```typescript
publish(
  topic: string,
  schema: MessageSchemaType,
  payload: unknown,
  options?: PublishOptions
): Promise<PublishResult>;
```

**Parameters:**

- `topic` - Topic name (e.g., `"room:123"`, `"user:456"`)
- `schema` - Message schema for validation
- `payload` - Message payload (validated against schema)
- `options` - Publish options (optional)

**Options:**

```typescript
interface PublishOptions {
  excludeSelf?: boolean; // Throws error if true (not yet implemented)
  partitionKey?: string; // For sharding (future use)
}
```

**Note on `excludeSelf`:** This option will raise an error if set to `true`. The feature is not yet implemented and requires pubsub adapter support. Use workarounds like dedicated topics per connection or checking message origin in subscriber handlers. See the `PublishOptions` type definition for details.

**Returns:** `Promise<PublishResult>` with subscriber match count and capability info

**Example:**

```typescript
// Inside a handler
router.on(UserCreated, async (ctx) => {
  const result = await ctx.publish(
    `org:${ctx.payload.orgId}:users`,
    UserListInvalidated,
    { orgId: ctx.payload.orgId },
  );
  if (result.ok && result.matchedLocal !== undefined) {
    console.log(`Notified ${result.matchedLocal} subscribers`);
  }
});

// Outside handlers (cron, queue, lifecycle)
const result = await router.publish("system:announcements", Announcement, {
  text: "Server maintenance at 02:00 UTC",
});
if (result.ok) {
  console.log("Announcement published");
}
```

#### `reset()`

Clear all registered handlers, middleware, and state.

```typescript
reset(): this;
```

**Returns:** Router instance for chaining

**Note:** Useful for resetting the router in tests without creating a new instance. Preserves configuration (validator, platform, limits). Does NOT reset:

- Heartbeat states for active connections
- RPC state (managed by RpcManager, survives router reset)

---

## Context API

Context objects are passed to message handlers and provide type-safe access to the WebSocket connection, payload, and various utility methods.

### Event Message Context

Context for fire-and-forget messages (via `router.on()`).

```typescript
interface EventMessageContext<TSchema, TData> {
  // Connection and message info
  ws: ServerWebSocket<TData>; // WebSocket connection
  type: string; // Message type
  payload?: unknown; // Validated payload (only if schema defines it)
  meta: MessageMeta; // Message metadata
  receivedAt: number; // Server receive timestamp (ms)

  // Type information
  isRpc: false; // Always false for events
  timeRemaining(): number; // Returns Infinity for events

  // Sending messages
  send: SendFunction; // Send message to this connection
  error(code: string, message: string, details?: Record<string, unknown>): void;

  // Connection data management
  assignData(partial: Partial<TData>): void;

  // Pub/sub
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(
    topic: string,
    schema: MessageSchemaType,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<PublishResult>;
}
```

**Note:** For messages without a payload (e.g., `message("PING")`), `ctx.payload` will be `undefined`.

### RPC Message Context (RPC-Only Contexts)

Context for request-response messages (via `router.rpc()`).

```typescript
interface RpcMessageContext<TSchema, TData> {
  // Connection and message info
  ws: ServerWebSocket<TData>; // WebSocket connection
  type: string; // Message type
  payload?: unknown; // Validated payload (only if schema defines it)
  meta: MessageMeta; // Message metadata (includes correlationId)
  receivedAt: number; // Server receive timestamp (ms)

  // Type information
  isRpc: true; // Always true for RPC
  deadline: number; // Request deadline (ms since epoch)
  timeRemaining(): number; // Milliseconds until deadline

  // Sending messages
  send: SendFunction; // Send side-effect messages
  error(code: string, message: string, details?: Record<string, unknown>): void;

  // RPC-specific methods
  reply(
    responseSchema: MessageSchemaType,
    data: unknown,
    options?: Record<string, unknown>,
  ): void;
  progress(data?: unknown): void;
  onCancel(cb: () => void): () => void;
  abortSignal: AbortSignal;

  // Connection data management
  assignData(partial: Partial<TData>): void;

  // Pub/sub
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(
    topic: string,
    schema: MessageSchemaType,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<PublishResult>;
}
```

**RPC Requirements:**

- Must call `ctx.reply()` or `ctx.error()` for terminal response
- Can call `ctx.progress()` multiple times before terminal response
- `correlationId` is auto-synthesized if missing (belt-and-suspenders approach)
- One-shot guarantee: multiple `reply()` calls are guarded (only first succeeds)

### Context Methods

#### `ctx.send(schema, payload, options?)`

Send a validated message to the current client.

```typescript
// Fire-and-forget (sync)
send<T>(schema: Schema<T>, payload: T, opts?: SendOptionsSync): void;

// Backpressure-aware (async)
send<T>(schema: Schema<T>, payload: T, opts: SendOptionsAsync): Promise<boolean>;
```

**Options:**

```typescript
interface SendOptionsBase {
  signal?: AbortSignal;
  meta?: Record<string, any>;
  inheritCorrelationId?: boolean;
}

interface SendOptionsSync extends SendOptionsBase {
  waitFor?: undefined;
}

interface SendOptionsAsync extends SendOptionsBase {
  waitFor: "drain" | "ack";
}

type SendOptions = SendOptionsSync | SendOptionsAsync;
```

**Parameters:**

- `schema` - Message schema
- `payload` - Message payload (validated against schema)
- `options` - Optional configuration
  - Without `waitFor`: returns `void` (fire-and-forget, sync)
  - With `waitFor`: returns `Promise<boolean>` (backpressure-aware, async)

**Auto-injected metadata:**

- `timestamp` - Producer timestamp (milliseconds since epoch)
- Does NOT inject `clientId` or `receivedAt` (outbound messages use client time)

**Example:**

```typescript
// Fire-and-forget
router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: "pong" });
});

// Backpressure-aware
router.on(StreamMessage, async (ctx) => {
  const sent = await ctx.send(
    DataMessage,
    { chunk: data },
    { waitFor: "drain" },
  );
  if (!sent) {
    // Handle backpressure
  }
});
```

**Note:** For RPC handlers, use `ctx.reply()` for terminal responses instead of `ctx.send()` to ensure one-shot guarantee and proper correlation tracking.

#### `ctx.error(code, message?, details?, options?)`

Send a type-safe error response with optional retry semantics.

```typescript
error(
  code: string | ErrorCode,
  message?: string,
  details?: Record<string, unknown>,
  options?: {
    retryable?: boolean;    // Override auto-inferred retry behavior
    retryAfterMs?: number;  // Backoff hint for transient errors
  }
): void;
```

**Parameters:**

- `code` - Standard error code (see Error Codes section). Auto-infers retry semantics unless explicitly overridden.
- `message` - Optional human-readable error description
- `details` - Optional error context. Must not contain sensitive data; server sanitizes before sending to clients.
- `options` - Optional retry semantics (overrides code-based inference):
  - `retryable` - Explicitly set whether error is retryable (optional; client infers from code if omitted)
  - `retryAfterMs` - Backoff interval hint for transient errors (only valid for retryable errors)

**Examples:**

Non-retryable error with context details:

```typescript
router.on(JoinRoom, (ctx) => {
  if (!roomExists(ctx.payload.roomId)) {
    // Client will auto-infer NOT_FOUND as non-retryable
    ctx.error("NOT_FOUND", "Room not found", { roomId: ctx.payload.roomId });
    return;
  }
});
```

Terminal error (explicit non-retryable):

```typescript
router.on(DeleteResource, (ctx) => {
  if (!userOwnsResource(ctx)) {
    // Explicit retryable: false (though inferred anyway)
    ctx.error("PERMISSION_DENIED", "You do not own this resource", undefined, {
      retryable: false,
    });
    return;
  }
});
```

Transient error with backoff hint:

```typescript
router.on(ProcessPayment, (ctx) => {
  try {
    processPayment(ctx.payload);
  } catch (err) {
    if (isRateLimited(err)) {
      // Client infers RESOURCE_EXHAUSTED as retryable, uses retryAfterMs
      ctx.error("RESOURCE_EXHAUSTED", "Rate limited", undefined, {
        retryAfterMs: 5000, // Client will wait 5s before retrying
      });
    } else if (isTemporaryFailure(err)) {
      // Default: infer retryable from code
      ctx.error("UNAVAILABLE", "Processing service unavailable");
    } else {
      ctx.error("INTERNAL", "Payment processing failed");
    }
  }
});
```

#### `ctx.reply(responseSchema, data, options?)` (RPC only)

Send a terminal reply for an RPC request.

```typescript
reply(responseSchema: MessageSchemaType, data: unknown, options?: Record<string, unknown>): void;
```

**Parameters:**

- `responseSchema` - Response message schema
- `data` - Response data (validated)
- `options` - Optional metadata

**Example:**

```typescript
router.rpc(GetUser, async (ctx) => {
  const user = await db.users.findById(ctx.payload.userId);
  ctx.reply(GetUser.response, { user });
});
```

#### `ctx.progress(data?)` (RPC only)

Send a non-terminal progress update.

```typescript
progress(data?: unknown): void;
```

**Parameters:**

- `data` - Optional progress data

**Example:**

```typescript
router.rpc(LongQuery, async (ctx) => {
  for (const batch of largeBatches) {
    ctx.progress({ processed: batch.count, total: largeBatches.length });
    await processBatch(batch);
  }
  ctx.reply(LongQuery.response, { result: finalResult });
});
```

#### `ctx.onCancel(callback)` (RPC only)

Register a callback for when the RPC is cancelled.

```typescript
onCancel(cb: () => void): () => void;
```

**Parameters:**

- `cb` - Callback invoked on cancellation (client abort or disconnect)

**Returns:** Unregister function

**Example:**

```typescript
router.rpc(LongOperation, async (ctx) => {
  const timer = setTimeout(() => doWork(), 1000);

  ctx.onCancel(() => {
    clearTimeout(timer);
    console.log("Operation cancelled");
  });

  const result = await doWork();
  ctx.reply(LongOperation.response, { result });
});
```

#### `ctx.abortSignal` (RPC only)

Standard AbortSignal that fires when the RPC is cancelled.

```typescript
abortSignal: AbortSignal;
```

**Example:**

```typescript
router.rpc(FetchData, async (ctx) => {
  const response = await fetch(url, { signal: ctx.abortSignal });
  const data = await response.json();
  ctx.reply(FetchData.response, { data });
});
```

#### `ctx.topics.subscribe(topic)` and `ctx.topics.unsubscribe(topic)`

Subscribe/unsubscribe to pub/sub topics.

```typescript
subscribe(topic: string): Promise<void>;
unsubscribe(topic: string): Promise<void>;
```

**Example:**

```typescript
router.on(JoinRoom, async (ctx) => {
  await ctx.topics.subscribe(`room:${ctx.payload.roomId}`);
  ctx.data.currentRoom = ctx.payload.roomId;
});

router.on(LeaveRoom, async (ctx) => {
  await ctx.topics.unsubscribe(`room:${ctx.data.currentRoom}`);
});
```

#### `ctx.publish(topic, schema, payload, options?)`

Publish a message to a topic (convenience method, delegates to `router.publish()`).

```typescript
publish(topic: string, schema: MessageSchemaType, payload: unknown, options?: PublishOptions): Promise<PublishResult>;
```

**Example:**

```typescript
router.on(SendMessage, async (ctx) => {
  const result = await ctx.publish(`room:${ctx.payload.roomId}`, ChatMessage, {
    text: ctx.payload.text,
    roomId: ctx.payload.roomId,
  });
  if (result.ok) {
    console.log(`Published to ${result.matchedLocal ?? "?"} subscribers`);
  }
});
```

#### `ctx.getData(key)`

Access connection data fields with type safety.

```typescript
getData<K extends keyof TData>(key: K): TData[K];
```

**Parameters:**

- `key` - Property name from your custom connection data type

**Returns:** Value of the property, or `undefined` if not set

**Example:**

```typescript
type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

router.on(SecureMessage, (ctx) => {
  const userId = ctx.getData("userId"); // Type: string | undefined
  const roles = ctx.getData("roles"); // Type: string[] | undefined

  if (!userId) {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
});
```

#### `ctx.assignData(partial)`

Merge partial data into connection data.

```typescript
assignData(partial: Partial<TData>): void;
```

**Example:**

```typescript
router.on(LoginMessage, (ctx) => {
  const user = authenticate(ctx.payload);
  ctx.assignData({ userId: user.id, roles: user.roles });
});
```

---

## Client API

### `wsClient()`

Create a type-safe WebSocket client.

**Signature:**

```typescript
function wsClient<TRouter = unknown>(options: ClientOptions): WebSocketClient;
```

**Options:**

```typescript
interface ClientOptions {
  url: string | URL; // WebSocket URL
  protocols?: string | string[]; // WebSocket subprotocols

  // Reconnection
  reconnect?: {
    enabled?: boolean; // Default: true
    maxAttempts?: number; // Default: Infinity
    initialDelayMs?: number; // Default: 300
    maxDelayMs?: number; // Default: 10000
    jitter?: "full" | "none"; // Default: "full" (randomize delay to prevent thundering herd)
  };

  // Queue configuration
  queue?: "drop-oldest" | "drop-newest" | "off"; // Default: "drop-newest"
  queueSize?: number; // Default: 1000 (pending messages while offline)

  // Behavior
  autoConnect?: boolean; // Default: false
  pendingRequestsLimit?: number; // Default: 1000

  // Authentication
  auth?: {
    attach?: "query" | "protocol"; // Default: "query"
    queryParam?: string; // Default: "access_token"
    protocolPrefix?: string; // Default: "bearer."
    protocolPosition?: "prepend" | "append"; // Default: "append"
    getToken?: () => string | Promise<string> | null | Promise<null>;
  };

  // Advanced
  wsFactory?: (url: string | URL, protocols?: string | string[]) => WebSocket; // For dependency injection in tests
}
```

**Returns:** `WebSocketClient` instance

**Example:**

```typescript
import { wsClient } from "@ws-kit/client/zod";

const client = wsClient({
  url: "ws://localhost:3000",
  reconnect: {
    enabled: true,
    maxAttempts: 10,
  },
  auth: {
    attach: "query",
    getToken: () => localStorage.getItem("token"),
  },
});
```

### Client Methods

#### `client.connect()`

Manually connect to the server.

```typescript
connect(): Promise<void>;
```

**Returns:** Promise that resolves when connected

#### `client.close(options?)`

Close the connection.

```typescript
close(options?: { code?: number; reason?: string }): Promise<void>;
```

**Parameters:**

- `options.code` - WebSocket close code (default: 1000)
- `options.reason` - Close reason string

**Returns:** Promise that resolves when closed

#### `client.on(schema, handler)`

Register a message handler.

```typescript
on<S extends MessageSchema>(schema: S, handler: (payload: InferPayload<S>) => void): () => void;
```

**Parameters:**

- `schema` - Message schema
- `handler` - Message handler function

**Returns:** Unregister function

**Example:**

```typescript
const RoomUpdated = message("ROOM_UPDATED", {
  roomId: z.string(),
  users: z.number(),
});

client.on(RoomUpdated, (payload) => {
  console.log(`Room ${payload.roomId} has ${payload.users} users`);
});
```

#### `client.send(schema, payload, options?)`

Send a fire-and-forget message.

```typescript
send<S extends MessageSchema>(
  schema: S,
  payload: InferPayload<S>,
  options?: { meta?: Record<string, unknown>; correlationId?: string }
): boolean;
```

**Parameters:**

- `schema` - Message schema
- `payload` - Message payload
- `options` - Optional metadata

**Returns:** `true` if sent immediately, `false` if queued

**Example:**

```typescript
const success = client.send(ChatMessage, {
  text: "Hello!",
  roomId: "general",
});
```

#### `client.request(schema, payload, options?)`

Send a request and wait for response (RPC).

**RPC-style overload (recommended):**

```typescript
request<S extends RpcSchema>(
  schema: S,
  payload?: InferPayload<S>,
  options?: RequestOptions
): Promise<InferMessage<S["response"]>>;
```

**Traditional style overload (explicit response schema):**

```typescript
request<S extends MessageSchema, R extends MessageSchema>(
  schema: S,
  payload: InferPayload<S>,
  reply: R,
  options?: RequestOptions
): Promise<InferMessage<R>>;
```

**Options:**

```typescript
interface RequestOptions {
  timeoutMs?: number; // Default: 30000
  meta?: Record<string, unknown>; // Custom metadata (correlationId auto-generated if not provided)
  correlationId?: string; // Explicit correlation ID (auto-generated if not provided)
  signal?: AbortSignal; // Cancellation signal
}
```

**Returns:** Promise resolving to the full response message object `{type, meta, payload}` with the response type and validated payload

**Behavior:**

- Auto-generates `correlationId` if not provided
- Strips reserved meta keys (`clientId`, `receivedAt`) from user meta
- Auto-connects if `autoConnect: true` and never attempted
- Queues request if disconnected (unless `queue: "off"`)
- Rejects with `ValidationError` if outbound validation fails
- Rejects with timeout error if no response within `timeoutMs`

**Examples:**

**RPC-style with auto-detected response (recommended):**

```typescript
const GetUser = message("GET_USER", {
  payload: { id: z.string() },
  response: { user: UserSchema },
});

const response = await client.request(GetUser, { id: "123" });
// response.payload is fully typed: { user: UserSchema }
console.log(response.payload.user.name);

// Or using legacy rpc() helper
const Ping = rpc("PING", { text: z.string() }, "PONG", { reply: z.string() });
const response = await client.request(Ping, { text: "hello" });
console.log(response.payload.reply); // Fully typed
```

**Traditional style with explicit response schema:**

```typescript
const response = await client.request(
  PingMessage,
  { text: "hello" },
  PongMessage,
  { timeoutMs: 5000 },
);
console.log(response.payload.reply);
```

**With custom metadata and auto-correlation:**

```typescript
const response = await client.request(
  GetUser,
  { id: "123" },
  {
    timeoutMs: 10000,
    meta: { source: "ui" },
    // correlationId auto-generated if not provided
  },
);
```

**With AbortSignal for cancellation:**

```typescript
const controller = new AbortController();
const promise = client.request(
  GetUser,
  { id: "123" },
  {
    signal: controller.signal,
  },
);
setTimeout(() => controller.abort(), 1000); // Cancel after 1s
```

#### `client.onState(callback)`

Register a state change listener.

```typescript
onState(callback: (state: ClientState) => void): () => void;
```

**States:**

- `"closed"` - Connection is closed (initial state)
- `"connecting"` - Connection attempt in progress
- `"open"` - Connected and ready
- `"closing"` - Close initiated, waiting for close event
- `"reconnecting"` - Reconnect attempt scheduled or in progress

**Returns:** Unregister function

#### `client.onceOpen()`

Wait for the next "open" state.

```typescript
onceOpen(): Promise<void>;
```

**Returns:** Promise that resolves when connected

#### `client.onUnhandled(callback)`

Register a handler for unhandled messages.

```typescript
onUnhandled(callback: (msg: AnyInboundMessage) => void): () => void;
```

**Returns:** Unregister function

#### `client.onError(callback)`

Register an error handler.

```typescript
onError(callback: (error: Error, context: ErrorContext) => void): () => void;
```

**Error Context:**

```typescript
interface ErrorContext {
  type: "parse" | "validation" | "overflow" | "unknown";
  details?: unknown;
}
```

**Returns:** Unregister function

### Client Properties

```typescript
client.state: ClientState;           // Current connection state
client.isConnected: boolean;         // True if state === "open"
client.protocol: string;             // Selected WebSocket subprotocol
```

---

## Platform Adapters

### Bun Adapter

#### `serve(router, options)`

High-level server function for Bun.

```typescript
function serve<TData extends { clientId: string }>(
  router: WebSocketRouter<any, TData>,
  options?: ServeOptions<TData>,
): Promise<void>;
```

**Options:**

```typescript
interface ServeOptions<TData> {
  port?: number; // Default: 3000
  authenticate?: (
    req: Request,
  ) => TData | Promise<TData> | undefined | Promise<undefined>;
  onError?: (error: Error, ctx: MessageContext) => void;
  onBroadcast?: (message: unknown, topic: string) => void;
  onUpgrade?: (req: Request, ws: ServerWebSocket<TData>) => void;
  onOpen?: (ws: ServerWebSocket<TData>) => void;
  onClose?: (ws: ServerWebSocket<TData>, code: number, reason: string) => void;
  context?: Record<string, unknown>;
  clientIdHeader?: string;
}
```

**Example:**

```typescript
import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();

serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    return token ? { userId: "123", roles: ["admin"] } : undefined;
  },
});
```

#### `createBunHandler(router, options)`

Low-level handler creation for custom setups.

```typescript
function createBunHandler<TData extends { clientId: string }>(
  router: WebSocketRouter<any, TData>,
  options?: BunHandlerOptions<TData>,
): { fetch: FetchHandler; websocket: WebSocketHandler<TData> };
```

**Returns:** Object with `fetch` and `websocket` handlers for `Bun.serve()`

**Example:**

```typescript
import { createBunHandler } from "@ws-kit/bun";

const { fetch, websocket } = createBunHandler(router, {
  authenticate(req) {
    // Custom auth logic
  },
});

Bun.serve({
  port: 3000,
  fetch,
  websocket,
});
```

---

## Error Handling

### Standard Error Codes

13 standard error codes aligned with gRPC conventions (from `ErrorCode` enum):

**Terminal errors (do NOT retry):**

- `UNAUTHENTICATED` - Not authenticated / auth token missing, expired, or invalid
- `PERMISSION_DENIED` - Permission denied / authenticated but lacks rights (authZ)
- `INVALID_ARGUMENT` - Invalid argument / input validation or semantic violation
- `FAILED_PRECONDITION` - Failed precondition / state requirement not met
- `NOT_FOUND` - Not found / target resource absent
- `ALREADY_EXISTS` - Already exists / uniqueness or idempotency replay violation
- `ABORTED` - Aborted / concurrency conflict (race condition)
- `CANCELLED` - Cancelled / call cancelled (client disconnect, timeout abort)

**Transient errors (retry with backoff):**

- `DEADLINE_EXCEEDED` - Deadline exceeded / RPC timed out
- `RESOURCE_EXHAUSTED` - Resource exhausted / rate limit, quota, or buffer overflow
- `UNAVAILABLE` - Unavailable / transient infrastructure error

**Server/evolution:**

- `UNIMPLEMENTED` - Unimplemented / feature not supported or deployed
- `INTERNAL` - Internal / unexpected server error (bug)

#### Client Inference Rules for Retry Semantics

The client automatically infers whether to retry based on the error code. If the server omits the `retryable` field, the client uses these rules:

| Error Code            | Retryable | Notes                                         |
| --------------------- | --------- | --------------------------------------------- |
| `DEADLINE_EXCEEDED`   | ✅ Yes    | Transient timeout                             |
| `RESOURCE_EXHAUSTED`  | ✅ Yes    | Rate limit or quota, may have `retryAfterMs`  |
| `UNAVAILABLE`         | ✅ Yes    | Transient infrastructure issue                |
| `ABORTED`             | ✅ Yes    | Concurrency conflict, safe to retry           |
| `UNAUTHENTICATED`     | ❌ No     | Fix auth, then retry                          |
| `PERMISSION_DENIED`   | ❌ No     | Insufficient privileges, don't retry          |
| `INVALID_ARGUMENT`    | ❌ No     | Fix input, then retry                         |
| `FAILED_PRECONDITION` | ❌ No     | Server state issue, don't retry               |
| `NOT_FOUND`           | ❌ No     | Resource absent, don't retry                  |
| `ALREADY_EXISTS`      | ❌ No     | Duplicate, don't retry                        |
| `UNIMPLEMENTED`       | ❌ No     | Feature not available, don't retry            |
| `INTERNAL`            | ❌ No     | Server bug, don't retry without investigation |
| `CANCELLED`           | ❌ No     | Request cancelled, don't auto-retry           |

**Server Behavior:** If the server explicitly sends `retryable: true` or `retryable: false`, the client uses the server's value instead of inferring from the code.

#### `retryAfterMs` Validation Rules

| Error Code           | `retryAfterMs` Status | When Used            | Example                     |
| -------------------- | --------------------- | -------------------- | --------------------------- |
| `RESOURCE_EXHAUSTED` | Should include        | Rate limiting, quota | `{ retryAfterMs: 5000 }`    |
| `DEADLINE_EXCEEDED`  | Optional              | Long operations      | Omit or use default backoff |
| `UNAVAILABLE`        | Optional              | Service degradation  | Omit or suggest delay       |
| Terminal errors      | Forbidden             | N/A                  | Must NOT include            |
| Other transient      | Optional              | Custom delays        | Omit for default            |

**Validation:** Server rejects `retryAfterMs` for terminal errors (codes marked "do NOT retry" above).

### Error Response Methods

Send a type-safe error response using `ctx.error()` with automatic retry inference:

```typescript
error(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>,
  options?: { retryable?: boolean; retryAfterMs?: number }
): void;
```

Clients automatically infer whether errors are retryable based on the error code. Use `retryAfterMs` to provide backoff hints for transient errors.

**Non-retryable error:**

```typescript
router.on(JoinRoom, (ctx) => {
  if (!roomExists(ctx.payload.roomId)) {
    ctx.error("NOT_FOUND", "Room not found", { roomId: ctx.payload.roomId });
    return;
  }
});
```

**Transient error with backoff:**

```typescript
router.on(QueryData, (ctx) => {
  if (isSaturated()) {
    ctx.error("RESOURCE_EXHAUSTED", "Server busy", undefined, {
      retryable: true,
      retryAfterMs: 1000,
    });
  }
});
```

### `WsKitError`

Standardized error object for structured error handling. Follows WHATWG Error standard with `cause` for error chaining.

```typescript
class WsKitError extends Error {
  // Public properties
  name: "WsKitError";
  code: string;
  override message: string;
  details: Record<string, unknown>;
  override cause?: unknown; // WHATWG standard: original error

  // Convenience accessor
  get originalError(): Error | undefined;

  // Static factory methods
  static from(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): WsKitError;

  static wrap(
    error: unknown,
    code: string,
    message?: string,
    details?: Record<string, unknown>,
  ): WsKitError;

  static isWsKitError(value: unknown): value is WsKitError;

  // Serialization methods
  toJSON(): {
    code: string;
    message: string;
    details: Record<string, unknown>;
    stack: string | undefined;
    cause?:
      | { name: string; message: string; stack: string | undefined }
      | string;
  };

  toPayload(): ErrorPayload;
}
```

**Static Methods:**

- `from()` - Create a new WsKitError
- `wrap()` - Wrap an existing error (preserves as cause). If already a WsKitError, returns as-is
- `isWsKitError()` - Type guard to check if a value is a WsKitError

**Instance Methods:**

- `toJSON()` - Serialize to plain object for structured logging (includes cause and stack)
- `toPayload()` - Create error payload for client transmission (excludes cause and stack)

**Example:**

```typescript
router.on(CreateUser, async (ctx) => {
  try {
    const user = await db.users.create(ctx.payload);
    ctx.send(UserCreated, user);
  } catch (err) {
    throw WsKitError.wrap(err, "INTERNAL", "Failed to create user", {
      email: ctx.payload.email,
    });
  }
});
```

**Error Handler Example:**

```typescript
router.onError((error, ctx) => {
  // Error is always a WsKitError (wrapped if needed)
  logger.error({
    code: error.code,
    message: error.message,
    details: error.details,
    cause: error.originalError, // Access wrapped error
    clientId: ctx.data?.clientId,
  });
});
```

---

## Type Utilities

### Infer Types from Schemas

```typescript
import type { InferPayload, InferMessage } from "@ws-kit/zod";

// Infer payload type
type ChatPayload = InferPayload<typeof ChatMessage>;

// Infer full message type
type ChatMsg = InferMessage<typeof ChatMessage>;
```

### Connection Data Type (Declaration Merging)

Declare default connection data type once using TypeScript declaration merging:

```typescript
// types/connection-data.d.ts
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
    roles?: string[];
    tenant?: string;
  }
}

// Now in any module (no generic needed):
const router = createRouter(); // Automatically uses ConnectionData

router.on(SecureMessage, (ctx) => {
  // ctx.data is properly typed with userId, roles, tenant
  const userId = ctx.data?.userId;
});
```

---

## Message Metadata

All messages include a `meta` object with standard fields:

```typescript
interface MessageMeta {
  // Server-controlled (injected after validation)
  clientId: string; // Client identifier (UUID v7)
  receivedAt: number; // Server ingress timestamp (ms)

  // Client-provided (validated, not trusted for server logic)
  timestamp?: number; // Client timestamp (for UI display)
  correlationId?: string; // Request/response correlation
  timeoutMs?: number; // RPC timeout

  // Custom metadata (via schema)
  [key: string]: unknown;
}
```

**Which timestamp to use:**

- **Server logic** (rate limiting, ordering, TTL): Use `ctx.receivedAt` (authoritative, server time)
- **UI display** (relative timestamps): Use `ctx.meta.timestamp` (client time, for display only)

**Reserved meta keys:** `clientId` and `receivedAt` are server-controlled and injected after validation. Never trust client-provided values for these fields.

---

## WebSocket Connection Data

Every connection has a `data` object with custom application data:

```typescript
interface WebSocketData<T = unknown> {
  clientId: string; // Auto-generated UUID v7 (always present)
} & T
```

**Access via `ctx.data`:**

```typescript
router.on(SecureMessage, (ctx) => {
  const userId = ctx.data?.userId;
  const clientId = ctx.clientId; // Always present
});
```

**Modify via `ctx.assignData()`:**

```typescript
router.on(LoginMessage, (ctx) => {
  ctx.assignData({ userId: "123", roles: ["admin"] });
});
```

---

## Reserved Message Type Prefix

Message types starting with `$ws:` are reserved for internal control messages and cannot be registered with `router.on()` or `router.rpc()`.

**Reserved types:**

- `$ws:rpc-progress` - RPC progress updates (sent by `ctx.progress()`)
- `$ws:abort` - RPC abort signal (sent by client to cancel RPC)

**Enforcement:**

- Design-time: `message()` and `rpc()` throw if message type uses reserved prefix
- Runtime: Messages with reserved prefix are handled internally, never dispatched to user handlers

**Example (will throw):**

```typescript
// ❌ Throws: Reserved prefix "$ws:" not allowed
const BadMessage = message("$ws:custom", { data: z.string() });
const BadRpc = rpc("$ws:query", payload, "$ws:response", response);
```

---

## Best Practices

### Type Safety

```typescript
// ✅ Use message() for full type inference
const ChatMessage = message("CHAT_MESSAGE", {
  text: z.string(),
  roomId: z.string(),
});

router.on(ChatMessage, (ctx) => {
  // ctx.payload.text is typed as string
  console.log(ctx.payload.text);
});

// ✅ Use rpc() for request-response patterns
const GetUser = rpc("GET_USER", { userId: z.string() }, "USER_RESPONSE", {
  user: UserSchema,
});

router.rpc(GetUser, async (ctx) => {
  const user = await db.users.findById(ctx.payload.userId);
  ctx.reply(GetUser.response, { user }); // Fully typed
});
```

### Error Handling Patterns

```typescript
// ✅ Use standard error codes
ctx.error("NOT_FOUND", "User not found", { userId });

// ✅ Wrap exceptions with WsKitError
try {
  await db.users.create(data);
} catch (err) {
  throw WsKitError.wrap(err, "INTERNAL", "Database error");
}

// ✅ Register error handlers for observability
router.onError((error, ctx) => {
  logger.error({
    code: error.code,
    message: error.message,
    details: error.details,
    clientId: ctx.data?.clientId,
  });
});
```

### Middleware Patterns

```typescript
// ✅ Global authentication middleware
router.use((ctx, next) => {
  if (!ctx.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
  return next();
});

// ✅ Per-route rate limiting (builder pattern)
const rateLimiter = new Map<string, number>();
router
  .route(SendMessage)
  .use((ctx, next) => {
    const userId = ctx.data?.userId || "anon";
    const count = (rateLimiter.get(userId) || 0) + 1;
    if (count > 10) {
      ctx.error("RESOURCE_EXHAUSTED", "Too many messages");
      return;
    }
    rateLimiter.set(userId, count);
    return next();
  })
  .on((ctx) => {
    // Handle message
  });
```

### Broadcasting

```typescript
// ✅ Use ctx.publish() for ergonomics
router.on(SendMessage, (ctx) => {
  ctx.publish(`room:${ctx.payload.roomId}`, ChatMessage, ctx.payload);
});

// ✅ Use router.publish() outside handlers
await router.publish("system:announcements", Announcement, {
  text: "Server maintenance at 02:00 UTC",
});
```

### Client Patterns

```typescript
// ✅ Use RPC for request-response
const response = await client.request(GetUser, { userId: "123" });

// ✅ Use send() for fire-and-forget
client.send(ChatMessage, { text: "Hello!", roomId: "general" });

// ✅ Handle connection states
client.onState((state) => {
  if (state === "open") {
    console.log("Connected!");
  } else if (state === "reconnecting") {
    console.log("Reconnecting...");
  }
});

// ✅ Use AbortSignal for cancellation
const controller = new AbortController();
const promise = client.request(
  LongQuery,
  { query: "..." },
  {
    signal: controller.signal,
  },
);
setTimeout(() => controller.abort(), 5000);
```
