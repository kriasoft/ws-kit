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
onOpen(handler: (ws: ServerWebSocket<WebSocketData<TData>>) => void): this
```

**Parameters:**

- `handler` - Function called when a client connects
- `ws` - The WebSocket instance with typed data

**Example:**

```typescript
router.onOpen((ws) => {
  console.log(`Client ${ws.data.clientId} connected`);
});
```

#### `onMessage(schema, handler)`

Register a handler for a specific message type.

```typescript
onMessage<TPayload>(
  schema: MessageSchema<TPayload>,
  handler: (context: MessageContext<TPayload, TData>) => void | Promise<void>
): this
```

**Parameters:**

- `schema` - Message schema created with `messageSchema()`
- `handler` - Function to handle messages of this type

**Example:**

```typescript
router.onMessage(ChatMessage, async (ctx) => {
  await saveMessage(ctx.payload);
  ctx.publish("chat", ChatMessage, ctx.payload);
});
```

#### `onClose(handler)`

Register a handler for disconnections.

```typescript
onClose(
  handler: (
    ws: ServerWebSocket<WebSocketData<TData>>,
    code: number,
    reason: string
  ) => void
): this
```

**Parameters:**

- `handler` - Function called when a client disconnects
- `ws` - The WebSocket instance
- `code` - Close code
- `reason` - Close reason

**Example:**

```typescript
router.onClose((ws, code, reason) => {
  console.log(`Client ${ws.data.clientId} disconnected: ${code} ${reason}`);
});
```

#### `onError(handler)`

Register a global error handler.

```typescript
onError(
  handler: (
    ws: ServerWebSocket<WebSocketData<TData>>,
    error: Error
  ) => void
): this
```

**Parameters:**

- `handler` - Function called on unhandled errors
- `ws` - The WebSocket instance
- `error` - The error object

#### `addRoutes(router)`

Merge routes from another router.

```typescript
addRoutes(router: WebSocketRouter<TData>): this
```

**Parameters:**

- `router` - Router instance to merge routes from

**Example:**

```typescript
const authRouter = new WebSocketRouter();
const chatRouter = new WebSocketRouter();

const mainRouter = new WebSocketRouter()
  .addRoutes(authRouter)
  .addRoutes(chatRouter);
```

#### `handlers()`

Get Bun WebSocket handlers.

```typescript
handlers(): WebSocketHandler<WebSocketData<TData>>
```

**Returns:** Object with WebSocket event handlers for Bun.serve()

**Example:**

```typescript
Bun.serve({
  port: 3000,
  websocket: router.handlers(),
});
```

## createMessageSchema

Factory function that creates message schema utilities using your validator instance. **Required since v0.4.0** to fix discriminated union support.

```typescript
function createMessageSchema(validator: ZodLike | ValibotLike): {
  messageSchema: MessageSchemaFunction;
  createMessage: CreateMessageFunction;
  ErrorMessage: MessageSchema;
  ErrorCode: Enum;
  MessageMetadataSchema: Schema;
};
```

**Parameters:**

- `validator` - Your Zod (`z`) or Valibot (`v`) instance

**Returns:**

- `messageSchema` - Function to create message schemas
- `createMessage` - Helper for client-side message creation
- `ErrorMessage` - Pre-defined error message schema
- `ErrorCode` - Error code enum/picklist
- `MessageMetadataSchema` - Base metadata schema

**Example:**

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema, createMessage, ErrorMessage, ErrorCode } =
  createMessageSchema(z);
```

## messageSchema

Function for creating message schemas (obtained from `createMessageSchema`).

### Overloads

```typescript
// Message without payload
function messageSchema<TType extends string>(
  type: TType,
): MessageSchema<undefined>;

// Message with payload
function messageSchema<TType extends string, TPayload>(
  type: TType,
  schema: Schema<TPayload>,
): MessageSchema<TPayload>;

// Message with payload and custom metadata
function messageSchema<TType extends string, TPayload, TMeta>(
  type: TType,
  schema: Schema<TPayload>,
  options: { meta?: Schema<TMeta> },
): MessageSchema<TPayload>;
```

**Parameters:**

- `type` - Unique message type identifier
- `schema` - Zod or Valibot schema for payload validation
- `options.meta` - Optional schema for custom metadata

**Returns:** MessageSchema object with type information

**Examples:**

```typescript
// First create the factory
const { messageSchema } = createMessageSchema(z);

// Simple message
const PingMessage = messageSchema("PING");

// With payload
const ChatMessage = messageSchema("CHAT_MESSAGE", { text: z.string() });

// With custom metadata
const TrackedMessage = messageSchema(
  "TRACKED_ACTION",
  { action: z.string() },
  { correlationId: z.string() },
);

// Works with discriminated unions!
const MessageUnion = z.discriminatedUnion("type", [
  PingMessage,
  ChatMessage,
  TrackedMessage,
]);
```

## MessageContext

Context object passed to message handlers.

### Properties

```typescript
interface MessageContext<TPayload, TData = unknown> {
  ws: ServerWebSocket<WebSocketData<TData>>;
  clientId: string;
  payload: TPayload;
}
```

- `ws` - The WebSocket instance
- `clientId` - Unique client identifier
- `payload` - Validated message payload

### Methods

#### `send(schema, payload?)`

Send a message to the current client.

```typescript
send<T>(schema: MessageSchema<T>, payload?: T): void
send(message: Message): void
```

**Examples:**

```typescript
// Using schema
ctx.send(ErrorMessage, {
  code: ErrorCode.NOT_FOUND,
  message: "User not found",
});

// Using raw message
ctx.send({
  type: "PONG",
  meta: { clientId: ctx.clientId, timestamp: Date.now() },
});
```

#### `publish(topic, schema, payload)`

Broadcast a message to all subscribers of a topic.

```typescript
publish<T>(
  topic: string,
  schema: MessageSchema<T>,
  payload: T
): void

publish(topic: string, message: Message): void
```

**Examples:**

```typescript
// Using schema
ctx.publish("room:123", ChatMessage, {
  text: "Hello everyone!",
  roomId: "123",
});

// Using raw message
ctx.publish("notifications", {
  type: "NOTIFICATION",
  payload: { message: "New update available" },
});
```

#### `subscribe(topic)`

Subscribe to a topic.

```typescript
subscribe(...topics: string[]): void
```

**Example:**

```typescript
ctx.subscribe("room:123", "notifications");
```

#### `unsubscribe(topic)`

Unsubscribe from a topic.

```typescript
unsubscribe(...topics: string[]): void
```

**Example:**

```typescript
ctx.unsubscribe("room:123");
```

#### `getData()` / `setData()`

Get or set custom connection data.

```typescript
getData<T = TData>(): T
setData<T = TData>(data: T): void
```

**Example:**

```typescript
// Set user data
ctx.setData({ userId: "123", roles: ["admin"] });

// Get user data
const userData = ctx.getData<{ userId: string; roles: string[] }>();
```

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

## publish() Helper

Standalone function for publishing messages with validation.

```typescript
function publish<T>(
  server: Server,
  topic: string,
  schema: MessageSchema<T>,
  payload: T,
): void;
```

**Parameters:**

- `server` - Bun server instance
- `topic` - Topic to publish to
- `schema` - Message schema for validation
- `payload` - Message payload

**Example:**

```typescript
import { publish } from "bun-ws-router/zod/publish";
// or
import { publish } from "bun-ws-router/valibot/publish";

// In an HTTP endpoint
app.post("/broadcast", (req) => {
  const { message } = await req.json();

  publish(server, "global", AnnouncementMessage, {
    text: message,
    priority: "high",
  });

  return new Response("Broadcasted");
});
```

## ErrorCode and ErrorMessage

Standard error handling utilities (obtained from `createMessageSchema`).

### ErrorCode

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
    clientId: string;
    timestamp: number;
    correlationId?: string;
  };
  payload?: T;
}
```

### WebSocketData

```typescript
interface WebSocketData<T = unknown> {
  clientId: string;
  user?: T;
}
```

### MessageSchema

```typescript
interface MessageSchema<TPayload> {
  type: string;
  schema?: Schema<TPayload>;
}
```

## Next Steps

- Explore [Examples](/examples) for usage patterns
- Learn [Advanced Usage](/advanced-usage) techniques
- Read [Deployment](/deployment) guidelines
