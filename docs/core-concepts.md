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
interface Message<T = unknown> {
  type: string; // Unique identifier for routing
  meta: {
    // Metadata (optional, auto-populated on send)
    timestamp?: number; // Producer time (client clock, UI display only)
    correlationId?: string; // Optional request tracking
  };
  payload?: T; // Optional validated data
}
```

::: tip Server Timestamp Usage
**Server logic must use `ctx.receivedAt`** (authoritative server time), not `meta.timestamp` (client clock, untrusted). See [Timestamp Handling](#timestamp-handling) below for guidance.
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

1. **Capture Timestamp** - `ctx.receivedAt = Date.now()` (before parsing, authoritative server time)
2. **Parse** - JSON.parse() the raw WebSocket message
3. **Type Check** - Ensure `type` field exists
4. **Handler Lookup** - Find registered handler for this message type
5. **Normalize (Security Boundary)** - Strip reserved keys (`clientId`, `receivedAt`) to prevent client spoofing
6. **Validate** - Schema validation on normalized message (strict mode rejects unknown keys)
7. **Handler Execution** - Your handler receives validated message + server context

::: warning Security
Normalization is a **security boundary** that prevents clients from spoofing server-only fields. Handlers receive only validated, normalized messages.
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
  ctx.subscribe("room:123");
  ctx.unsubscribe("room:456");
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

Use `ctx.error()` with standard error codes for consistent error handling:

```typescript
ctx.error("INVALID_ARGUMENT", "Invalid room ID");
```

Available error codes (aligned with gRPC standards):

**Terminal errors** (don't retry):

- `UNAUTHENTICATED`: Auth token missing, expired, or invalid
- `PERMISSION_DENIED`: Authenticated but lacks rights
- `INVALID_ARGUMENT`: Input validation or semantic violation
- `FAILED_PRECONDITION`: State requirement not met
- `NOT_FOUND`: Resource not found
- `ALREADY_EXISTS`: Uniqueness or idempotency violation
- `ABORTED`: Concurrency conflict (race condition)

**Transient errors** (retry with backoff):

- `DEADLINE_EXCEEDED`: RPC timed out
- `RESOURCE_EXHAUSTED`: Rate limit, quota, or backpressure exceeded
- `UNAVAILABLE`: Transient infrastructure error

**Server/evolution**:

- `UNIMPLEMENTED`: Feature not supported or deployed
- `INTERNAL`: Unexpected server error (bug)
- `CANCELLED`: Call cancelled (client disconnect, timeout abort)

See [Error Handling](./specs/error-handling.md) and ADR-015 for complete error code taxonomy.

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
interface MessageContext<TPayload, TData = unknown> {
  ws: ServerWebSocket<TData>; // WebSocket instance
  type: string; // Message type literal
  meta: {
    // Validated metadata
    timestamp?: number; // Client timestamp (optional, for UI only)
    correlationId?: string; // Optional correlation ID
    [key: string]: unknown; // Custom metadata fields
  };
  receivedAt: number; // Server receive timestamp (authoritative)

  // All handlers
  send: SendFunction; // Type-safe send to current connection (1-to-1)
  publish: PublishFunction; // Type-safe publish to topic subscribers (1-to-many)
  error: ErrorFunction; // Type-safe error responses
  assignData: AssignDataFunction; // Merge partial data into ctx.ws.data
  subscribe: SubscribeFunction; // Subscribe to a channel
  unsubscribe: UnsubscribeFunction; // Unsubscribe from a channel
  timeRemaining: () => number; // ms until deadline (Infinity for events)
  isRpc: boolean; // Flag: is this an RPC message?

  payload?: TPayload; // Validated payload (conditional)

  // RPC handlers only (when using router.rpc())
  reply?: (schema: Schema, data: ResponseType) => void; // Terminal reply, one-shot guarded
  progress?: (data?: unknown) => void; // Progress update (non-terminal)
  abortSignal?: AbortSignal; // Fires on client cancel/disconnect
  onCancel?: (cb: () => void) => () => void; // Register cancel callback
  deadline?: number; // Server-derived deadline (epoch ms)
}
```

**Key points:**

- Access client ID via `ctx.ws.data.clientId` (not `ctx.clientId`)
- Use `ctx.receivedAt` for server-side logic (rate limiting, ordering, TTL, auditing)
- Use `ctx.meta.timestamp` only for UI display (not authoritative)
- **Subscriptions**: `ctx.subscribe(topic)` and `ctx.unsubscribe(topic)`
- **Publishing**: `await ctx.publish(topic, schema, payload)` (1-to-many) or `await router.publish()` outside handlers
- **Sending**: `ctx.send(schema, payload)` (1-to-1, to current connection)
- **Custom data**: Access `ctx.ws.data` directly or use `ctx.assignData()` to merge partial updates
- **RPC**: Use `ctx.reply(schema, data)` for terminal responses, `ctx.progress(data)` for streaming updates (only available in `router.rpc()` handlers)

## Request-Response Pattern (RPC)

ws-kit provides first-class support for request-response messaging with automatic correlation tracking. Use `router.rpc()` for handlers that need guaranteed responses:

```typescript
import { z, rpc, createRouter } from "@ws-kit/zod";

// Define RPC schema - binds request to response type
const GetUser = rpc("GET_USER", { id: z.string() }, "USER_RESPONSE", {
  user: UserSchema,
});

const router = createRouter();

// Use router.rpc() for RPC handlers
router.rpc(GetUser, async (ctx) => {
  const user = await db.users.findById(ctx.payload.id);

  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }

  // Terminal reply (type-safe to response schema)
  ctx.reply(GetUser.response, { user });
});
```

**Key RPC features:**

- **`ctx.reply(schema, data)`** — Terminal response, one-shot guarded (only called once)
- **`ctx.progress(data)`** — Optional streaming updates before terminal reply
- **`ctx.abortSignal`** — AbortSignal for cancellation (integrates with fetch, etc.)
- **`ctx.onCancel(cb)`** — Register cleanup callbacks for cancellation
- **Automatic correlation** — No manual tracking needed; client requests match responses

**Client-side usage:**

```typescript
import { wsClient } from "@ws-kit/client/zod";

const client = wsClient({ url: "ws://localhost:3000" });

// Make RPC call
const call = client.request(GetUser, { id: "123" });

// Optional: listen to progress updates
for await (const p of call.progress()) {
  console.log("Progress:", p);
}

// Wait for terminal response
const { user } = await call.result();
```

See [RPC Guide](./rpc.md) and ADR-015 for complete RPC documentation.

## Broadcasting and PubSub

Use type-safe publishing for efficient broadcasting to topic subscribers:

```typescript
router.on(JoinRoomMessage, async (ctx) => {
  const roomId = ctx.payload.roomId;

  // Subscribe to room topic
  ctx.subscribe(`room:${roomId}`);

  // Broadcast to all subscribers with type-safe publish
  await ctx.publish(`room:${roomId}`, UserJoinedMessage, {
    username: ctx.payload.username,
  });
});

router.on(LeaveRoomMessage, async (ctx) => {
  const roomId = ctx.payload.roomId;

  // Unsubscribe when leaving
  ctx.unsubscribe(`room:${roomId}`);

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

Both `ctx.publish()` and `router.publish()` return `Promise<number>` (recipient count).

See [Broadcasting](./specs/broadcasting.md) and ADR-018/ADR-019 for complete documentation.

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

## Performance Considerations

- **Message Parsing**: Messages are parsed once and cached
- **Validation**: Schema validation happens before handler execution
- **Error Boundaries**: Handlers are wrapped with minimal overhead
- **PubSub**: Uses platform-native implementations (Bun, Cloudflare DO, etc.) for maximum performance
- **Type Safety**: Zero runtime overhead—all type checking happens at compile time
- **Modular Design**: Tree-shakeable imports ensure minimal bundle size

For platform-specific optimizations, see the adapter documentation for your target platform.
