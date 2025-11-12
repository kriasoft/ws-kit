# Core Concepts

Understanding these core concepts will help you build robust WebSocket applications with ws-kit.

::: tip Recommended: Export-with-Helpers Pattern
Use the modern import pattern for optimal tree-shaking and simplicity:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

// Use message() directly - no factory setup needed
const PingMessage = message("PING", { text: z.string() });
```

See [Message Schemas](./message-schemas.md) (ADR-007) for details on the export-with-helpers pattern.
:::

## Message-Based Architecture

ws-kit uses a message-based architecture where all communication follows a consistent structure. This provides several benefits:

- **Type Safety**: Messages are validated against schemas before reaching handlers
- **Predictability**: All messages have the same structure, making debugging easier
- **Routing**: Messages are automatically routed based on their type
- **Traceability**: Built-in metadata helps track message flow

### Message Structure

Every message consists of three parts:

```typescript
// Client-side message (what clients send)
interface ClientMessage<T = unknown> {
  type: string; // Unique identifier for routing
  meta?: {
    // Optional metadata (client-provided, untrusted)
    timestamp?: number; // Producer time (client clock, UI display only)
    correlationId?: string; // Optional request tracking
    [key: string]?: unknown; // Custom metadata fields
  };
  payload?: T; // Optional validated data
}

// Server-side context message (what handlers receive)
// Includes server-injected fields added after validation
interface ServerMessage<T = unknown> extends ClientMessage<T> {
  meta: {
    clientId: string; // ← Server-injected, UUID v7
    receivedAt: number; // ← Server-injected, authoritative timestamp
    timestamp?: number; // ← Client-provided (untrusted, may be missing/skewed)
    correlationId?: string;
    [key: string]?: unknown;
  };
}
```

::: tip Server Timestamp Usage
**Server logic must use `ctx.receivedAt`** (server-injected, authoritative time), not `meta.timestamp` (client clock, untrusted). Client can send any timestamp; server always captures authoritative time before parsing. See [Timestamp Handling](#timestamp-handling) below for guidance.
:::

## Connection Lifecycle

### 1. Connection Opening

When a client connects, the router:

- Generates a unique `clientId` (UUID v7)
- Stores connection metadata in `ws.data`
- Calls your `onOpen` handler

```typescript
router.onOpen((ctx) => {
  // ctx.ws.data.clientId is always available (UUID v7)
  console.log(`Client ${ctx.ws.data.clientId} connected`);
});
```

### 2. Message Handling

When a message arrives, the router processes it through a security-focused pipeline:

1. **Capture Timestamp** — `ctx.receivedAt = Date.now()` (before parsing, authoritative server time)
2. **Parse** — JSON.parse() the raw WebSocket message
3. **Type Check** — Ensure `type` field exists
4. **Handler Lookup** — Find registered handler for this message type
5. **Normalize** — Strip reserved keys (e.g., client-sent `clientId`) to prevent spoofing
6. **Validate** — Schema validation on normalized message (strict mode rejects unknown keys)
7. **Inject Metadata** — Server-controlled fields (`clientId`, `receivedAt`) added **after validation** as security boundary
8. **Handler Execution** — Your handler receives validated message + server context

::: warning Security Boundary
Metadata injection occurs **after validation**, ensuring server values (`clientId`, `receivedAt`) are trusted and immune to client tampering. Handlers receive only validated, normalized messages with authoritative server fields.
:::

```typescript
router.on(ChatMessage, async (ctx) => {
  // ctx provides everything you need:
  // - ctx.ws: The WebSocket instance
  // - ctx.ws.data.clientId: Client identifier (UUID v7, auto-generated)
  // - ctx.type: Message type literal from schema
  // - ctx.meta: Validated metadata (timestamp, correlationId, custom fields)
  // - ctx.payload: Validated message data (conditional - only if schema defines it)
  // - ctx.receivedAt: Server receive timestamp (Date.now(), authoritative for server logic)
  // - ctx.send: Type-safe send function (1-to-1, to current connection)
  // - ctx.publish: Type-safe publish function (1-to-many, to topic subscribers)

  // For broadcasting to topic subscribers:
  await ctx.publish("chat", ChatMessage, ctx.payload);

  // For subscriptions:
  await ctx.topics.subscribe("room:123");
  await ctx.topics.unsubscribe("room:456");
});
```

### 3. Connection Closing

When a client disconnects:

```typescript
router.onClose((ctx) => {
  console.log(
    `Client ${ctx.ws.data.clientId} disconnected: ${ctx.code} ${ctx.reason || "N/A"}`,
  );
  // Clean up resources, notify other clients, etc.
});
```

## Type Safety

The router provides full type inference from schema definition to handler:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const UpdateProfileMessage = message("UPDATE_PROFILE", {
  name: z.string(),
  avatar: z.url().optional(),
});

const router = createRouter();

router.on(UpdateProfileMessage, (ctx) => {
  // TypeScript knows:
  // - ctx.payload.name is string
  // - ctx.payload.avatar is string | undefined
  // - ctx.send() only accepts valid message schemas
});
```

## Middleware

Middleware runs before handlers to provide cross-cutting concerns like authentication, logging, and rate limiting:

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

// Global middleware: runs for all messages
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return; // Skip handler
  }
  return next(); // Continue to handler
});

// Per-route middleware: runs only for specific message
router.use(SendMessage, (ctx, next) => {
  if (isRateLimited(ctx.ws.data?.userId)) {
    ctx.error("RESOURCE_EXHAUSTED", "Too many messages");
    return;
  }
  return next();
});

router.on(SendMessage, (ctx) => {
  // Handler runs if all middleware calls next()
  processMessage(ctx.payload);
});
```

**Key features:**

- **Global middleware** — `router.use(middleware)` runs for all messages
- **Per-route middleware** — `router.use(schema, middleware)` runs only for specific messages
- **Execution order** — Global → per-route → handler
- **Control flow** — Call `next()` to continue; omit to skip handler
- **Context mutation** — Middleware can update `ctx.ws.data` via `ctx.assignData()`
- **Error handling** — Call `ctx.error()` to reject and stop execution

See [Middleware Guide](./middleware.md) and ADR-008 for complete documentation.

## Error Handling

### Error Boundaries

All handlers are wrapped in error boundaries to prevent crashes:

```typescript
router.on(SomeMessage, (ctx) => {
  throw new Error("Something went wrong");
  // Router catches this and sends an error message to the client
});
```

### Standard Error Codes

Use `ctx.error()` with standard error codes for consistent error handling. Clients automatically infer whether errors are retryable:

```typescript
// Non-retryable error (client won't retry)
ctx.error("INVALID_ARGUMENT", "Invalid room ID");

// Transient error with backoff hint (client retries after 2s)
ctx.error("RESOURCE_EXHAUSTED", "Server busy", undefined, {
  retryable: true,
  retryAfterMs: 2000,
});
```

Available error codes (aligned with gRPC standards):

**Terminal errors** (non-retryable):

- `UNAUTHENTICATED`: Auth token missing, expired, or invalid
- `PERMISSION_DENIED`: Authenticated but lacks rights
- `INVALID_ARGUMENT`: Input validation or semantic violation
- `FAILED_PRECONDITION`: State requirement not met
- `NOT_FOUND`: Resource not found
- `ALREADY_EXISTS`: Uniqueness or idempotency violation
- `UNIMPLEMENTED`: Feature not supported or deployed
- `CANCELLED`: Call cancelled (client disconnect, timeout abort)

**Transient errors** (automatically retryable):

- `DEADLINE_EXCEEDED`: RPC timed out
- `RESOURCE_EXHAUSTED`: Rate limit, quota, or backpressure exceeded
- `UNAVAILABLE`: Transient infrastructure error
- `ABORTED`: Concurrency conflict (race condition)

**Mixed (app-specific)**:

- `INTERNAL`: Unexpected server error (server decides retryability)

#### Retry Behavior

Clients infer retryability using these rules:

1. **If `retryable` field is present**: Use its value
2. **If `retryable` field is absent**:
   - Transient codes (`DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `ABORTED`): infer `true`
   - Terminal codes (all others): infer `false`
   - `INTERNAL`: infer `false` (conservative: assume bug, don't retry)

Use `retryAfterMs` to provide backoff hints for transient errors:

```typescript
// Backoff hints are optional but recommended for rate-limited scenarios
ctx.error("RESOURCE_EXHAUSTED", undefined, undefined, {
  retryAfterMs: 5000, // Client waits 5 seconds before retrying
});
```

See [Error Handling Spec](./specs/error-handling.md) and ADR-015 for complete error code taxonomy and semantics.

## WebSocket Data

The router extends Bun's WebSocket data with typed metadata:

```typescript
interface WebSocketData<T = unknown> {
  clientId: string; // UUID v7, auto-generated by router
} & T
```

Pass custom data during upgrade:

```typescript
// During WebSocket upgrade (using platform adapter)
// Router auto-generates clientId (UUID v7)
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

## Context Object

Handler contexts provide access to message data and WebSocket operations:

```typescript
// Event message context (fire-and-forget messaging)
interface EventMessageContext<TPayload, TData = unknown> {
  ws: ServerWebSocket<TData>; // WebSocket instance
  type: string; // Message type literal
  meta: {
    // Server-injected metadata (after validation)
    clientId: string; // Connection ID (UUID v7, always present)
    receivedAt: number; // Server receive timestamp (authoritative, always present)
    timestamp?: number; // Client timestamp (optional, for UI only—untrusted)
    correlationId?: string; // Optional correlation ID
    [key: string]: unknown; // Custom metadata fields
  };
  receivedAt: number; // Server receive timestamp (authoritative)

  // All handlers
  send(schema: Schema, data: unknown): void; // Type-safe send to current connection (1-to-1)
  publish(
    topic: string,
    schema: Schema,
    payload: unknown,
  ): Promise<PublishResult>; // Broadcast to subscribers (1-to-many)
  error(
    code: ErrorCode,
    message?: string,
    data?: unknown,
    options?: ErrorOptions,
  ): void; // Send typed error
  assignData(partial: Partial<TData>): void; // Merge partial data into ctx.ws.data
  topics: {
    subscribe(topic: string): Promise<void>; // Subscribe to a topic
    unsubscribe(topic: string): Promise<void>; // Unsubscribe from a topic
  };
  timeRemaining(): number; // ms until deadline (Infinity for events)
  isRpc: false; // Discriminant: false for event messages

  payload?: TPayload; // Validated payload (conditional)
}

// RPC message context (request-response with guaranteed correlation)
interface RpcMessageContext<TPayload, TData = unknown>
  extends Omit<EventMessageContext<TPayload, TData>, "isRpc"> {
  isRpc: true; // Discriminant: true for RPC messages

  // RPC-specific methods
  reply(schema: Schema, data: unknown, options?: Record<string, unknown>): void; // Terminal response (one-shot)
  progress(data?: unknown): void; // Non-terminal progress update
  abortSignal: AbortSignal; // Fires on client cancel/disconnect
  onCancel(cb: () => void): () => void; // Register cancel callback
  deadline: number; // Server-derived deadline (epoch ms)
}

// Union type for handler context (discriminated by isRpc)
type MessageContext<TPayload, TData = unknown> =
  | EventMessageContext<TPayload, TData>
  | RpcMessageContext<TPayload, TData>;
```

**Key points:**

- **Type safety**: Use `if (ctx.isRpc)` to discriminate between event and RPC handlers and access RPC-specific methods
- **Client identity**: Access via `ctx.ws.data.clientId` (auto-generated UUID v7, not `ctx.clientId`)
- **Metadata injection**: `ctx.meta.clientId` and `ctx.meta.receivedAt` are server-injected after validation (security boundary—prevents client spoofing)
- **Timestamps**: Use `ctx.receivedAt` for server logic (rate limiting, ordering, TTL, auditing); use `ctx.meta.timestamp` only for UI display (untrusted client clock)
- **Subscriptions**: `await ctx.topics.subscribe(topic)` and `await ctx.topics.unsubscribe(topic)` for PubSub
- **Publishing**: `await ctx.publish(topic, schema, payload)` broadcasts to subscribers (1-to-many), or use `await router.publish()` outside handlers
- **Sending**: `ctx.send(schema, payload)` sends to current connection only (1-to-1)
- **Custom data**: Access `ctx.ws.data` directly, or use `ctx.assignData()` to merge partial updates
- **RPC only** (`ctx.isRpc === true`): Use `ctx.reply(schema, data)` for terminal response, `ctx.progress(data)` for non-terminal updates, `ctx.abortSignal` for cancellation

## Request-Response Pattern (RPC)

ws-kit provides first-class support for request-response messaging with automatic correlation tracking and optional streaming progress updates. RPC handlers guarantee a single terminal response with full type safety.

### Server-Side Setup

**Modern (Recommended)** — Unified message API with config object:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

// Define RPC schema with response shape
const GetUser = message("GET_USER", {
  payload: { id: z.string() },
  response: { user: UserSchema },
});

const router = createRouter();

// Register with router.on() — handler type is inferred from schema
router.on(GetUser, async (ctx) => {
  // ctx has RPC-specific methods because schema includes response
  const user = await db.users.findById(ctx.payload.id);

  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }

  // ctx.progress and ctx.reply are type-safe
  ctx.progress?.({ stage: "validating" });
  ctx.reply({ user }); // Type-safe to response schema
});
```

**Legacy (Supported)** — Separate `rpc()` function with positional args:

```typescript
import { z, rpc, createRouter } from "@ws-kit/zod";

const GetUser = rpc("GET_USER", { id: z.string() }, "USER_RESPONSE", {
  user: UserSchema,
});

const router = createRouter();

// Legacy: use router.rpc() entry point
router.rpc(GetUser, async (ctx) => {
  const user = await db.users.findById(ctx.payload.id);
  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }
  ctx.reply(GetUser.response, { user });
});
```

### Server-Side Features

- **`ctx.reply(data)`** — Terminal response (type-safe to response schema, one-shot guarded)
- **`ctx.progress(data)`** — Optional non-terminal updates (streamed before reply)
- **`ctx.abortSignal`** — Cancellation signal (integrates with fetch, AbortController, etc.)
- **`ctx.onCancel(cb)`** — Register cleanup callbacks on client cancel/disconnect
- **`ctx.deadline`** — Server-derived deadline (epoch ms) for timeout logic
- **Automatic correlation** — No manual ID tracking needed; client requests auto-match responses

### Client-Side Usage

Use the dual-surface API to handle progress and terminal response separately:

```typescript
import { wsClient } from "@ws-kit/client/zod";

const client = wsClient({ url: "ws://localhost:3000" });

// Make RPC call
const call = client.request(GetUser, { id: "123" });

// Optional: listen to progress updates (if server sends them)
for await (const progress of call.progress()) {
  console.log("Progress:", progress);
}

// Wait for terminal response
const response = await call.result();
const { user } = response.payload;
```

**Progress updates** (server-side) are streamed without blocking the terminal response. The client consumes them via `for await (const p of call.progress())` before awaiting `call.result()`.

See [RPC Guide](./rpc.md) and ADR-015 for complete RPC documentation.

## Broadcasting and PubSub

Use type-safe publishing for efficient broadcasting to topic subscribers:

```typescript
router.on(JoinRoomMessage, async (ctx) => {
  const roomId = ctx.payload.roomId;

  // Subscribe to room topic
  await ctx.topics.subscribe(`room:${roomId}`);

  // Broadcast to all subscribers with type-safe publish
  await ctx.publish(`room:${roomId}`, UserJoinedMessage, {
    username: ctx.payload.username,
  });
});

router.on(LeaveRoomMessage, async (ctx) => {
  const roomId = ctx.payload.roomId;

  // Unsubscribe when leaving
  await ctx.topics.unsubscribe(`room:${roomId}`);

  // Notify others
  await ctx.publish(`room:${roomId}`, UserLeftMessage, {
    username: ctx.payload.username,
  });
});
```

**Key Distinction:**

- **`ctx.send(schema, data)`** — Sends to single connection (1-to-1)
- **`ctx.publish(topic, schema, data)`** — Broadcasts to topic subscribers (1-to-many)
- **`router.publish(topic, schema, data)`** — Use outside handlers (cron jobs, system events)

Both `ctx.publish()` and `router.publish()` return `Promise<PublishResult>` with subscription capability and matched count.

See [Pub/Sub](./specs/pubsub.md) and ADR-022 for complete documentation.

## Timestamp Handling

The router provides two timestamps with different trust levels:

- **`ctx.receivedAt`** - Server receive timestamp (authoritative, `Date.now()` captured before parsing)
  - **Use for:** Rate limiting, ordering, TTL, auditing, all server-side logic
- **`ctx.meta.timestamp`** - Producer time (client clock, untrusted, may be skewed/missing)
  - **Use for:** UI "sent at" display, optimistic ordering, lag calculation

**Rule:** Server logic MUST use `ctx.receivedAt` for all business logic (rate limiting, ordering, TTL, auditing).

```typescript
router.on(ChatMessage, (ctx) => {
  // Rate limiting with server timestamp
  const lastMessageTime = messageLog.get(ctx.ws.data.clientId);
  if (lastMessageTime && ctx.receivedAt - lastMessageTime < 1000) {
    ctx.error(
      "RESOURCE_EXHAUSTED",
      "Please wait before sending another message",
    );
    return;
  }
  messageLog.set(ctx.ws.data.clientId, ctx.receivedAt);

  // Store both for different purposes
  await saveMessage({
    text: ctx.payload.text,
    sentAt: ctx.meta.timestamp, // UI display
    receivedAt: ctx.receivedAt, // Business logic
  });
});
```

## Heartbeat (Connection Health Checks)

Heartbeat is **opt-in** and allows the server to detect stale or unresponsive connections. When enabled, the router periodically pings clients and disconnects if they don't respond within the timeout window:

```typescript
const router = createRouter({
  heartbeat: {
    intervalMs: 30_000, // Send ping every 30 seconds (default)
    timeoutMs: 5_000, // Wait 5 seconds for pong (default)
    onStaleConnection(clientId, ws) {
      // Cleanup: connection failed to respond to heartbeat
      console.log(`Stale connection: ${clientId}`);
      ws.close(1000, "Heartbeat timeout");
    },
  },
});
```

**When to enable:**

- Long-lived connections with idle periods
- Applications where dead connection detection is important
- When you need to clean up resources for unresponsive clients

**Overhead**: Minimal when disabled (zero); when enabled, one ping per `intervalMs` per connection.

## Message Validation & Security

The router processes messages through a security-focused pipeline:

1. **Capture Timestamp** — `ctx.receivedAt = Date.now()` (server clock, authoritative)
2. **Parse** — JSON.parse() the WebSocket message
3. **Type Check** — Verify `type` field exists
4. **Handler Lookup** — Find registered handler
5. **Normalize** — Strip reserved keys (`clientId` if present) to prevent spoofing
6. **Validate** — Run schema validation (strict mode rejects unknown keys)
7. **Inject Metadata** — Add server-controlled fields (`clientId`, `receivedAt`) **after validation**
8. **Handler Execution** — Handler receives validated, normalized message + context

**Security Boundary**: Metadata injection occurs **after validation**, ensuring server values are trusted and not subject to client tampering.

## Performance Considerations

- **Message Parsing**: Messages are parsed once and cached
- **Validation**: Schema validation happens before handler execution
- **Error Boundaries**: Handlers are wrapped with minimal overhead
- **PubSub**: Lazily initialized—zero overhead for applications that don't use broadcasting. Uses platform-native implementations (Bun, Cloudflare DO, etc.) for maximum performance when enabled
- **Heartbeat**: Opt-in feature—disabled by default, zero overhead when not configured
- **Type Safety**: Zero runtime overhead—all type checking happens at compile time
- **Modular Design**: Tree-shakeable imports ensure minimal bundle size

For platform-specific optimizations, see the adapter documentation for your target platform.
