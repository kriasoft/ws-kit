# Bun WebSocket Router

Type-safe WebSocket router for Bun with Zod or Valibot validation. Routes messages to handlers based on message type.

## Architecture

### Core Design

- **Adapter Pattern**: Core logic in `shared/`, with thin Zod/Valibot adapters
- **Modular Design**: Separated routing, connection handling, and message processing
- **Message-First Design**: All communication follows a consistent message structure with type-based routing
- **Type Safety**: Full type inference from schema definition to handler context

### Key Components

- **WebSocketRouter**: Core class managing message routing and WebSocket lifecycle
- **Validation Adapters**: Support for both Zod and Valibot validators
- **Integration**: Extends (not replaces) Bun's native WebSocket features like PubSub

### Behavior

- **Error Boundaries**: All handlers wrapped to prevent crashes
- **Client Identity**: Each connection gets a unique UUID v7
- **Default Export**: Zod adapter for backward compatibility
- **Async Support**: Both synchronous and asynchronous handlers fully supported

## Message Structure

All messages follow this pattern:

```typescript
{
  type: string,              // Message type for routing (e.g., "JOIN_ROOM")
  meta: {                    // Metadata (auto-populated)
    clientId?: string,       // UUID v7 generated on connection
    timestamp?: number,      // Unix timestamp
    correlationId?: string   // Optional request tracking
  },
  payload?: any             // Optional message data (validated by schema)
}
```

## Type System Patterns

- **Complex Conditionals**: messageSchema() uses TypeScript conditional types for overloads
- **`WebSocketData<T>`**: Pattern for connection metadata, always includes clientId (UUID v7)
- **MessageContext**: Constructed with conditional payload based on schema definition
- **Type Inference**: Full type inference from schemas to handler contexts
- **Adapter Pattern**: Both Zod and Valibot adapters implement the same interface

## API Usage

### Connection Lifecycle

```typescript
// Handle connection open
router.onOpen((context) => {
  console.log(`Client ${context.ws.data.clientId} connected`);
  // context.ws - the ServerWebSocket instance
  // context.send - typed send function
});

// Handle connection close
router.onClose((context) => {
  console.log(`Client ${context.ws.data.clientId} disconnected`);
  // context.code - close code
  // context.reason - close reason
});
```

### Message Handling

```typescript
// Define message schema
const PingMessage = messageSchema(
  "PING",
  z.object({
    message: z.string(),
  }),
);

// Handle messages with full type safety
router.onMessage(PingMessage, (context) => {
  // context structure:
  // - ws: ServerWebSocket instance
  // - payload: Typed payload from schema (e.g., { message: string })
  // - meta: Message metadata (clientId, timestamp, correlationId)
  // - send: Typed send function

  const { message } = context.payload;
  console.log(`Received: ${message} from ${context.meta.clientId}`);

  // Send response with schema validation
  context.send(PongMessage, { reply: "pong" });
});
```

## Common Patterns

### Error Handling

```typescript
// Use ErrorMessage schema with ErrorCode enum
const errorMessage = {
  type: "ERROR",
  meta: { clientId, timestamp: Date.now() },
  payload: { code: "VALIDATION_ERROR", message: "Invalid input" },
};
```

### Broadcasting

```typescript
// Use publish() helper for validated broadcasts
// With ServerWebSocket instance:
publish(ws, topic, schema, payload, meta?);

// With Server instance:
import { publish } from "bun-ws-router/zod/publish";
publish(server, topic, schema, payload, meta?);

// Or use ws.publish() directly for untyped messages
ws.publish(topic, JSON.stringify(message));
```

### Authentication

```typescript
// Pass user data in upgrade() via data option
router.upgrade(req, {
  server,
  data: { userId: "123", roles: ["user"] },
});
```

### Route Composition

```typescript
// Create separate routers for different features
const authRouter = new WebSocketRouter();
const chatRouter = new WebSocketRouter();

// Define auth routes
const LoginMessage = messageSchema(
  "LOGIN",
  z.object({
    username: z.string(),
    password: z.string(),
  }),
);

authRouter.onMessage(LoginMessage, (ctx) => {
  // Handle authentication
});

// Define chat routes
const SendMessage = messageSchema(
  "SEND_MESSAGE",
  z.object({
    text: z.string(),
  }),
);

chatRouter.onMessage(SendMessage, (ctx) => {
  // Handle chat messages
});

// Merge all routes into main router
const mainRouter = new WebSocketRouter();
mainRouter.addRoutes(authRouter).addRoutes(chatRouter);

// Now mainRouter handles both auth and chat messages
```

### Creating Messages

#### Server-side (in handlers)

```typescript
// Define schema with messageSchema factory
const JoinRoomMessage = messageSchema(
  "JOIN_ROOM",
  z.object({
    roomId: z.string(),
  }),
);

// Handler receives typed context
router.onMessage(JoinRoomMessage, (ctx) => {
  // ctx.payload is typed as { roomId: string }
  // ctx.meta contains clientId, timestamp, etc.
  // ctx.ws is the ServerWebSocket instance

  // Send messages using schema validation:
  ctx.send(ResponseSchema, { data: "value" }, { correlationId: "123" });
});
```

#### Client-side (creating messages)

```typescript
// Use createMessage helper for type-safe message creation
const message = createMessage(JoinRoomMessage, { roomId: "general" });

if (message.success) {
  ws.send(JSON.stringify(message.data));
} else {
  console.error("Validation failed:", message.error);
}

// With custom metadata
const msgWithMeta = createMessage(
  RequestSchema,
  { data: "test" },
  { correlationId: "req-123" },
);
```

## Validation Commands

After making code changes, always run:

```bash
bun eslint --report-unused-disable-directives .
bun tsc --noEmit
bun prettier --write .
```

## Testing

- Test runner: Bun's built-in test framework
- Pattern: `*.test.ts` files
- Key utilities: MockServerWebSocket for unit tests
