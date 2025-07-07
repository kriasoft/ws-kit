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
- **WebSocketData<T>**: Pattern for connection metadata, always includes clientId
- **MessageContext**: Constructed with conditional payload based on schema definition
- **Type Inference**: Full type inference from Zod schemas to handler contexts
- **Adapter Pattern**: Both Zod and Valibot adapters implement the same interface

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
publish(server, topic, schema, message);
// Or use ws.publish() directly for unvalidated messages
ws.publish(topic, JSON.stringify(message));
```

### Authentication

```typescript
// Pass user data in upgrade() via data option
server.upgrade(req, {
  data: { userId: "123", roles: ["user"] },
});
```

### Route Composition

```typescript
// Use addRoutes() to merge routers
router.addRoutes(authRouter);
router.addRoutes(chatRouter);
```

### Creating Messages

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
  // ctx.send() accepts only valid message schemas
});
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
