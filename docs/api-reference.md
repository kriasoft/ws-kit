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

## messageSchema

Factory function for creating message schemas.

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
// Simple message
const PingMessage = messageSchema("PING");

// With payload
const ChatMessage = messageSchema(
  "CHAT_MESSAGE",
  z.object({ text: z.string() }),
);

// With custom metadata
const TrackedMessage = messageSchema(
  "TRACKED_ACTION",
  z.object({ action: z.string() }),
  { meta: z.object({ correlationId: z.string() }) },
);
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
import { publish } from "bun-ws-router";

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

## ErrorCode Enum

Standard error codes for consistent error handling.

```typescript
enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  RATE_LIMIT = "RATE_LIMIT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}
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
