# Core Concepts

Understanding these core concepts will help you build robust WebSocket applications with Bun WebSocket Router.

::: tip Factory Pattern Required
**Required since v0.4.0** to fix discriminated union support. Use `createMessageSchema()` to create schemas:

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);
```

The old direct `messageSchema` export is deprecated and will be removed in v1.0. See [Message Schemas](./message-schemas.md#factory-pattern-required) for migration details.
:::

## Message-Based Architecture

Bun WebSocket Router uses a message-based architecture where all communication follows a consistent structure. This provides several benefits:

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
import { publish } from "bun-ws-router/zod/publish";

router.onMessage(ChatMessage, (ctx) => {
  // ctx provides everything you need:
  // - ctx.ws: The WebSocket instance
  // - ctx.ws.data.clientId: Client identifier (UUID v7, auto-generated)
  // - ctx.type: Message type literal from schema
  // - ctx.meta: Validated metadata (timestamp, correlationId, custom fields)
  // - ctx.payload: Validated message data (conditional - only if schema defines it)
  // - ctx.receivedAt: Server receive timestamp (Date.now(), authoritative for server logic)
  // - ctx.send: Type-safe send function

  // For broadcasting, use the standalone publish() helper:
  publish(ctx.ws, "chat", ChatMessage, ctx.payload);

  // For subscriptions:
  ctx.ws.subscribe("room:123");
  ctx.ws.unsubscribe("room:456");
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
const UpdateProfileMessage = messageSchema("UPDATE_PROFILE", {
  name: z.string(),
  avatar: z.url().optional(),
});

router.onMessage(UpdateProfileMessage, (ctx) => {
  // TypeScript knows:
  // - ctx.payload.name is string
  // - ctx.payload.avatar is string | undefined
  // - ctx.send() only accepts valid message schemas
});
```

## Error Handling

### Error Boundaries

All handlers are wrapped in error boundaries to prevent crashes:

```typescript
router.onMessage(SomeMessage, (ctx) => {
  throw new Error("Something went wrong");
  // Router catches this and sends an error message to the client
});
```

### Standard Error Codes

Use the built-in `ErrorCode` enum for consistent error handling:

```typescript
const { ErrorCode, ErrorMessage } = createMessageSchema(z);

ctx.send(ErrorMessage, {
  code: ErrorCode.VALIDATION_FAILED,
  message: "Invalid room ID",
});
```

Available error codes:

- `INVALID_MESSAGE_FORMAT`: Message isn't valid JSON or lacks required structure
- `VALIDATION_FAILED`: Message failed schema validation
- `UNSUPPORTED_MESSAGE_TYPE`: No handler registered for message type
- `AUTHENTICATION_FAILED`: Authentication required or token invalid
- `AUTHORIZATION_FAILED`: Insufficient permissions
- `RESOURCE_NOT_FOUND`: Resource not found
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `INTERNAL_SERVER_ERROR`: Server error

## WebSocket Data

The router extends Bun's WebSocket data with typed metadata:

```typescript
interface WebSocketData<T = unknown> {
  clientId: string; // UUID v7, auto-generated by router
} & T
```

Pass custom data during upgrade:

```typescript
server.upgrade(req, {
  data: {
    // Router auto-generates clientId (UUID v7)
    id: "123",
    name: "Alice",
    roles: ["user", "admin"],
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
  send: SendFunction; // Type-safe send function
  payload?: TPayload; // Validated payload (conditional)
}
```

**Key points:**

- Access client ID via `ctx.ws.data.clientId` (not `ctx.clientId`)
- Use `ctx.receivedAt` for server-side logic (rate limiting, ordering, TTL, auditing)
- Use `ctx.meta.timestamp` only for UI display (not authoritative)
- For subscriptions: `ctx.ws.subscribe(topic)` and `ctx.ws.unsubscribe(topic)`
- For publishing: Use standalone `publish()` helper from `bun-ws-router/zod/publish`
- For custom data: Access `ctx.ws.data` directly (no getData/setData methods)

## Broadcasting and PubSub

Leverage Bun's native PubSub for efficient broadcasting:

```typescript
import { publish } from "bun-ws-router/zod/publish";

router.onMessage(JoinRoomMessage, (ctx) => {
  const roomId = ctx.payload.roomId;

  // Subscribe to room topic
  ctx.ws.subscribe(`room:${roomId}`);

  // Broadcast to all subscribers with type-safe publish helper
  publish(ctx.ws, `room:${roomId}`, UserJoinedMessage, {
    username: ctx.payload.username,
  });
});

router.onMessage(LeaveRoomMessage, (ctx) => {
  const roomId = ctx.payload.roomId;

  // Unsubscribe when leaving
  ctx.ws.unsubscribe(`room:${roomId}`);

  // Notify others
  publish(ctx.ws, `room:${roomId}`, UserLeftMessage, {
    username: ctx.payload.username,
  });
});
```

::: tip
The `publish()` helper validates messages before broadcasting. See [API Reference](/api-reference#publish) for complete documentation.
:::

## Timestamp Handling

The router provides two timestamps with different trust levels:

- **`ctx.receivedAt`** - Server receive timestamp (authoritative, `Date.now()` captured before parsing)
  - **Use for:** Rate limiting, ordering, TTL, auditing, all server-side logic
- **`ctx.meta.timestamp`** - Producer time (client clock, untrusted, may be skewed/missing)
  - **Use for:** UI "sent at" display, optimistic ordering, lag calculation

**Rule:** Server logic MUST use `ctx.receivedAt` for all business logic (rate limiting, ordering, TTL, auditing).

```typescript
router.onMessage(ChatMessage, (ctx) => {
  // Rate limiting with server timestamp
  const lastMessageTime = messageLog.get(ctx.ws.data.clientId);
  if (lastMessageTime && ctx.receivedAt - lastMessageTime < 1000) {
    ctx.send(ErrorMessage, {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Please wait before sending another message",
    });
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
- **Error Boundaries**: Handlers are wrapped but with minimal overhead
- **PubSub**: Uses Bun's native implementation for maximum performance
