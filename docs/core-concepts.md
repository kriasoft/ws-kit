# Core Concepts

Understanding these core concepts will help you build robust WebSocket applications with Bun WebSocket Router.

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
    // Metadata (auto-populated)
    clientId: string; // UUID v7 for client identification
    timestamp: number; // Unix timestamp
    correlationId?: string; // Optional request tracking
  };
  payload?: T; // Optional validated data
}
```

## Connection Lifecycle

### 1. Connection Opening

When a client connects, the router:

- Generates a unique `clientId` (UUID v7)
- Stores connection metadata in `ws.data`
- Calls your `onOpen` handler

```typescript
router.onOpen((ws) => {
  // ws.data.clientId is automatically available
  console.log(`Client ${ws.data.clientId} connected`);

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "WELCOME",
      meta: {
        clientId: ws.data.clientId,
        timestamp: Date.now(),
      },
      payload: { message: "Connected successfully" },
    }),
  );
});
```

### 2. Message Handling

When a message arrives:

1. **Parsing**: Raw message is parsed as JSON
2. **Validation**: Message structure is validated
3. **Routing**: Message is routed based on type
4. **Schema Validation**: Payload is validated against schema
5. **Handler Execution**: Your handler receives typed context

```typescript
router.onMessage(ChatMessage, (ctx) => {
  // ctx provides everything you need:
  // - ctx.ws: The WebSocket instance
  // - ctx.clientId: Client identifier
  // - ctx.payload: Validated message data
  // - ctx.send(): Send messages back
  // - ctx.publish(): Broadcast to topics
});
```

### 3. Connection Closing

When a client disconnects:

```typescript
router.onClose((ws, code, reason) => {
  console.log(`Client ${ws.data.clientId} disconnected`);
  // Clean up resources, notify other clients, etc.
});
```

## Type Safety

The router provides full type inference from schema definition to handler:

```typescript
const UpdateProfileMessage = messageSchema(
  "UPDATE_PROFILE",
  z.object({
    name: z.string(),
    avatar: z.string().url().optional(),
  }),
);

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
import { ErrorCode } from "bun-ws-router";

ctx.send({
  type: "ERROR",
  payload: {
    code: ErrorCode.VALIDATION_ERROR,
    message: "Invalid room ID",
  },
});
```

Available error codes:

- `VALIDATION_ERROR`: Invalid message or payload
- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `RATE_LIMIT`: Too many requests
- `INTERNAL_ERROR`: Server error

## WebSocket Data

The router extends Bun's WebSocket data with typed metadata:

```typescript
interface WebSocketData<T = unknown> {
  clientId: string; // Always present
  user?: T; // Your custom data
}
```

Pass custom data during upgrade:

```typescript
server.upgrade(req, {
  data: {
    clientId: crypto.randomUUID(),
    user: {
      id: "123",
      name: "Alice",
      roles: ["user", "admin"],
    },
  },
});
```

## Context Object

Handler contexts provide a rich API for message handling:

```typescript
interface MessageContext<T> {
  ws: ServerWebSocket<WebSocketData>; // WebSocket instance
  clientId: string; // Client identifier
  payload: T; // Validated payload

  // Send message to current client
  send(message: Message): void;

  // Subscribe to topics
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;

  // Publish to topics
  publish(topic: string, message: Message): void;

  // Get/set connection data
  getData<T>(): T;
  setData<T>(data: T): void;
}
```

## Broadcasting and PubSub

Leverage Bun's native PubSub for efficient broadcasting:

```typescript
// Subscribe to a room
ctx.subscribe(`room:${roomId}`);

// Broadcast to all subscribers
ctx.publish(`room:${roomId}`, ChatMessage, {
  text: "Hello everyone!",
  roomId: roomId,
});

// Unsubscribe when leaving
ctx.unsubscribe(`room:${roomId}`);
```

## Performance Considerations

- **Message Parsing**: Messages are parsed once and cached
- **Validation**: Schema validation happens before handler execution
- **Error Boundaries**: Handlers are wrapped but with minimal overhead
- **PubSub**: Uses Bun's native implementation for maximum performance

## Next Steps

- Learn about [Message Schemas](/message-schemas) for complex validation
- See [Examples](/examples) for real-world patterns
- Explore [Advanced Usage](/advanced-usage) for authentication and composition
