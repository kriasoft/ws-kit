# API Reference

Complete API documentation for Bun WebSocket Router.

## WebSocketRouter

The main class for creating WebSocket routers.

### Constructor

```typescript
new WebSocketRouter<TData = unknown>()
```

**Type Parameters:**

- `TData` - Type of custom data stored in WebSocket connections

### Methods

#### `onOpen(handler)`

Register a handler for new connections.

```typescript
onOpen(handler: (context: OpenHandlerContext<TData>) => void | Promise<void>): this
```

**Parameters:**

- `handler` - Function called when a client connects
- `context.ws` - The WebSocket instance with typed data
- `context.send` - Type-safe send function

**Example:**

```typescript
router.onOpen((ctx) => {
  console.log(`Client ${ctx.ws.data.clientId} connected`);

  // ctx.send() auto-adds timestamp to meta
  ctx.send(WelcomeMessage, { text: "Welcome!" });
});
```

#### `on(schema, handler)`

Register a handler for a specific message type.

```typescript
on<TPayload>(
  schema: MessageSchema<TPayload>,
  handler: (context: MessageContext<TPayload, TData>) => void | Promise<void>
): this
```

**Parameters:**

- `schema` - Message schema created with `messageSchema()`
- `handler` - Function to handle messages of this type

**Example:**

```typescript
import { publish } from "bun-ws-router/zod/publish";

router.on(ChatMessage, async (ctx) => {
  await saveMessage(ctx.payload);

  // publish() validates and auto-adds timestamp before broadcasting
  publish(ctx.ws, "chat", ChatMessage, ctx.payload);
});
```

#### `onClose(handler)`

Register a handler for disconnections.

```typescript
onClose(
  handler: (context: CloseHandlerContext<TData>) => void | Promise<void>
): this
```

**Parameters:**

- `handler` - Function called when a client disconnects
- `context.ws` - The WebSocket instance with typed data
- `context.code` - WebSocket close code
- `context.reason` - Optional close reason string
- `context.send` - Type-safe send function (for cleanup broadcasts only, cannot send to closed connection)

**Example:**

```typescript
router.onClose((ctx) => {
  console.log(
    `Client ${ctx.ws.data.clientId} disconnected: ${ctx.code} ${ctx.reason || "N/A"}`,
  );

  // Clean up user from rooms
  const rooms = getUserRooms(ctx.ws.data.clientId);
  rooms.forEach((roomId) => {
    removeUserFromRoom(ctx.ws.data.clientId, roomId);
  });
});
```

**Note:** The `send` function is provided in the context but can only be used for broadcasting to other clients via `publish()`. Sending directly to the disconnected client (`ctx.ws`) will fail since the connection is closed.

#### `merge(router)`

Merge routes from another router into this one. Merges all handlers, lifecycle hooks, and middleware from the source router.

```typescript
merge(router: WebSocketRouter<TData>): this
```

**Parameters:**

- `router` - Router instance to merge routes from

**Returns:** This router for method chaining

**Example:**

```typescript
import { createRouter } from "@ws-kit/zod";

const authRouter = createRouter();
const chatRouter = createRouter();

const mainRouter = createRouter().merge(authRouter).merge(chatRouter);
```

#### `websocket` (Property)

Get Bun WebSocket handlers.

```typescript
get websocket(): WebSocketHandler<WebSocketData<TData>>
```

**Returns:** Object with WebSocket event handlers for Bun.serve()

**Example:**

```typescript
Bun.serve({
  port: 3000,
  websocket: router.websocket,
});
```

## message()

Create a type-safe WebSocket message schema.

```typescript
function message<TType extends string>(type: TType): MessageSchema<TType>;

function message<TType extends string, TPayload>(
  type: TType,
  payload: Schema<TPayload>,
): MessageSchema<TType, TPayload>;

function message<TType extends string, TPayload, TMeta>(
  type: TType,
  payload: Schema<TPayload>,
  meta: Schema<TMeta>,
): MessageSchema<TType, TPayload, TMeta>;
```

**Parameters:**

- `type` - Unique message type identifier
- `payload` - Zod or Valibot schema for payload validation (optional)
- `meta` - Schema for custom metadata fields (optional)

**Returns:** MessageSchema object with type information

**Examples:**

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

// Simple message without payload
const PingMessage = message("PING");

// With payload
const ChatMessage = message("CHAT_MESSAGE", { text: z.string() });

// With custom metadata
const TrackedMessage = message(
  "TRACKED_ACTION",
  { action: z.string() },
  { roomId: z.string() },
);

// Works with discriminated unions!
const MessageUnion = z.discriminatedUnion("type", [
  PingMessage,
  ChatMessage,
  TrackedMessage,
]);

// Use with router
const router = createRouter();
router.on(ChatMessage, (ctx) => {
  console.log(ctx.payload.text); // Fully typed!
});
```

## MessageContext

Context object passed to message handlers.

### Properties

```typescript
interface MessageContext<TPayload, TData = unknown> {
  ws: ServerWebSocket<TData>;
  type: string;
  meta: {
    timestamp?: number;
    correlationId?: string;
    [key: string]: unknown;
  };
  receivedAt: number;
  send: SendFunction;
  payload?: TPayload; // Only present if schema defines payload
}
```

- `ws` - WebSocket instance (always includes `ctx.ws.data.clientId`)
- `type` - Message type literal
- `meta` - Validated metadata (timestamp, correlationId, custom fields)
- `receivedAt` - Server timestamp (authoritative for server logic)
- `send` - Type-safe send function
- `payload` - Validated payload (only exists if schema defines it)

**Key Points:**

- Client ID: `ctx.ws.data.clientId` (UUID v7, always present)
- Server timestamp: `ctx.receivedAt` (use for rate limiting, ordering, TTL)
- Client timestamp: `ctx.meta.timestamp` (use for UI display only)
- Publishing: Use `publish()` helper (see below)
- Subscriptions: `ctx.ws.subscribe(topic)` / `ctx.ws.unsubscribe(topic)`

### Methods

#### `send(schema, payload?, meta?)`

Send a message to the current client.

```typescript
send<T>(schema: MessageSchema<T>, payload?: T, meta?: Record<string, unknown>): void
send(message: Message): void
```

**Examples:**

```typescript
import { message, ErrorMessage } from "@ws-kit/zod";

// Send a typed message
const PongMessage = message("PONG", { reply: z.string() });
ctx.send(PongMessage, { reply: "pong" });

// Send error (type-safe, predefined codes)
ctx.error("NOT_FOUND", "User not found");

// Send error with details
ctx.error("VALIDATION_ERROR", "Invalid input", { field: "email" });
```

## Helper Functions

### `publish()`

Type-safe helper for broadcasting messages to WebSocket topics.

**Import:**

```typescript
import { publish } from "bun-ws-router/zod/publish";
// or
import { publish } from "bun-ws-router/valibot/publish";
```

**Signature:**

```typescript
publish<T>(
  ws: ServerWebSocket,
  topic: string,
  schema: MessageSchema<T>,
  payload: T,
  metaOrOpts?: Partial<MessageMetadata> | { origin?: string; key?: string }
): boolean
```

**Parameters:**

- `ws` - WebSocket instance (usually `ctx.ws`)
- `topic` - Topic name to publish to
- `schema` - Message schema for validation
- `payload` - Message payload data
- `metaOrOpts` - Optional metadata or options object:
  - As metadata: `{ correlationId?: string, ... }` - Custom metadata fields
  - As options: `{ origin?: string, key?: string }` - Sender tracking configuration

**Returns:** `true` if message was validated and published successfully, `false` otherwise

**Examples:**

```typescript
import { publish } from "bun-ws-router/zod/publish";

// Basic publish with type safety
router.on(ChatMessage, (ctx) => {
  publish(ctx.ws, "room:123", ChatMessage, {
    text: "Hello everyone!",
    roomId: "123",
  });
});

// Publish with custom metadata
publish(
  ctx.ws,
  "notifications",
  NotificationMessage,
  { text: "Update available" },
  { correlationId: "req-123" },
);

// Publish with sender tracking (origin option)
// Automatically injects senderId from ws.data.userId
publish(
  ctx.ws,
  "room:123",
  ChatMessage,
  { text: "Hello" },
  { origin: "userId" }, // Looks up ws.data.userId and adds to meta.senderId
);

// Custom sender field name
publish(
  ctx.ws,
  "room:123",
  ChatMessage,
  { text: "Hello" },
  { origin: "userId", key: "authorId" }, // Adds to meta.authorId instead
);
```

**Origin Option:**

The `origin` option enables automatic sender tracking by extracting a value from `ws.data` and injecting it into the message metadata:

- `origin: "userId"` - Reads `ws.data.userId` and adds it to `meta.senderId`
- `key: "authorId"` - Uses `meta.authorId` instead of default `meta.senderId`

This is useful for:

- Tracking who sent a broadcast message
- Filtering messages by sender
- Implementing sender-based permissions

**Why is `publish()` standalone?**

The `publish()` helper is a standalone function (not `ctx.publish()`) because:

- **Validation** - Validates messages against schema before broadcasting (security boundary)
- **Auto-timestamp** - Automatically adds `timestamp` to `meta` (like `ctx.send()`)
- **Type safety** - Full TypeScript inference for payload and meta
- **Return value** - Returns `boolean` for error handling (true if any client received message)

For raw publishing without validation or timestamps, use `ctx.ws.publish()` directly.

## WebSocket Methods

These methods are available on `ctx.ws` (Bun's ServerWebSocket):

### `subscribe()`

Subscribe to topics for receiving broadcasts.

```typescript
ctx.ws.subscribe(...topics: string[]): void
```

**Example:**

```typescript
ctx.ws.subscribe("room:123", "notifications");
```

### `unsubscribe()`

Unsubscribe from a topic.

```typescript
ctx.ws.unsubscribe(...topics: string[]): void
```

**Example:**

```typescript
ctx.ws.unsubscribe("room:123");
```

### Custom Connection Data

Access and modify custom connection data via `ctx.ws.data`:

```typescript
// Access custom data (read)
const userId = ctx.ws.data.userId;
const roles = ctx.ws.data.roles;

// Access clientId (always present, UUID v7)
const clientId = ctx.ws.data.clientId;

// Modify custom data (write)
ctx.ws.data.isAuthenticated = true;
ctx.ws.data.lastActivity = Date.now();
```

**Note:** The `clientId` field is automatically generated (UUID v7) by the router during WebSocket upgrade and is always present in `ws.data`.

## createMessage() Helper

Helper function for creating validated WebSocket messages on the client side (obtained from `createMessageSchema`).

```typescript
function createMessage<T extends MessageSchemaType>(
  schema: T,
  payload: T["shape"]["payload"] extends ZodType
    ? z.infer<T["shape"]["payload"]>
    : undefined,
  meta?: Partial<z.infer<T["shape"]["meta"]>>,
): SafeParseReturnType;
```

**Parameters:**

- `schema` - Message schema created with `messageSchema()`
- `payload` - Message payload (type inferred from schema)
- `meta` - Optional metadata to include

**Returns:**

A Zod/Valibot `SafeParseReturnType` with either:

- `{ success: true, data: Message }` - Valid message
- `{ success: false, error: ZodError }` - Validation errors

**Example:**

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema, createMessage } = createMessageSchema(z);

const JoinMessage = messageSchema("JOIN", {
  roomId: z.string(),
});

// Client-side usage
const message = createMessage(JoinMessage, { roomId: "general" });

if (message.success) {
  ws.send(JSON.stringify(message.data));
} else {
  console.error("Validation failed:", message.error);
}

// With metadata
const tracked = createMessage(
  RequestMessage,
  { action: "fetch" },
  { correlationId: "req-123" },
);
```

## ErrorCode and ErrorMessage

Standard error handling utilities (obtained from `createMessageSchema`).

### ErrorCode

Standard error codes for consistent error handling across your application.

```typescript
// Zod version
const ErrorCode = z.enum([
  "INVALID_MESSAGE_FORMAT",
  "VALIDATION_FAILED",
  "UNSUPPORTED_MESSAGE_TYPE",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
]);

// Valibot version
const ErrorCode = v.picklist([
  "INVALID_MESSAGE_FORMAT",
  "VALIDATION_FAILED",
  "UNSUPPORTED_MESSAGE_TYPE",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
]);
```

**Error Code Reference:**

| Code                       | Description                                          | Common Use Cases                   |
| -------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `INVALID_MESSAGE_FORMAT`   | Message isn't valid JSON or lacks required structure | Malformed messages, parsing errors |
| `VALIDATION_FAILED`        | Message failed schema validation                     | Invalid payload data               |
| `UNSUPPORTED_MESSAGE_TYPE` | No handler registered for message type               | Unknown message types              |
| `AUTHENTICATION_FAILED`    | Authentication required or token invalid             | Login failures, expired tokens     |
| `AUTHORIZATION_FAILED`     | Insufficient permissions                             | Access control violations          |
| `RESOURCE_NOT_FOUND`       | Resource not found                                   | Missing users, rooms, items        |
| `RATE_LIMIT_EXCEEDED`      | Too many requests                                    | Rate limiting, spam prevention     |
| `INTERNAL_SERVER_ERROR`    | Server error                                         | Unexpected errors, bugs            |

### ErrorMessage

Pre-defined error message schema:

```typescript
const ErrorMessage = messageSchema("ERROR", {
  code: ErrorCode,
  message: z.string().optional(), // or v.optional(v.string())
  context: z.record(z.string(), z.any()).optional(),
});
```

**Usage:**

```typescript
const { ErrorMessage, ErrorCode } = createMessageSchema(z);

ctx.send(ErrorMessage, {
  code: "VALIDATION_FAILED",
  message: "Invalid input",
  context: { field: "email" },
});
```

## TypeScript Types

### Message

```typescript
interface Message<T = unknown> {
  type: string;
  meta: {
    timestamp?: number;
    correlationId?: string;
  };
  payload?: T;
}
```

### WebSocketData

```typescript
interface WebSocketData<T = unknown> {
  clientId: string; // UUID v7, auto-generated by router
} & T
```

### MessageSchema

```typescript
interface MessageSchema<TPayload> {
  type: string;
  schema?: Schema<TPayload>;
}
```
