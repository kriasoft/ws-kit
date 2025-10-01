# WebSocket Router Specification

## Overview

Type-safe message routing for Bun WebSocket servers with automatic validation.

## Basic Setup

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);
const router = new WebSocketRouter();

const PingMessage = messageSchema("PING", { timestamp: z.number() });

router.onMessage(PingMessage, (ctx) => {
  console.log("Ping at:", ctx.payload.timestamp);
  ctx.send(PongMessage, { reply: Date.now() });
});

Bun.serve({
  fetch(req, server) {
    return router.upgrade(req, { server });
  },
  websocket: router.websocket,
});
```

## Router API

### Message Handlers

```typescript
router.onMessage<Schema extends MessageSchemaType>(
  schema: Schema,
  handler: MessageHandler<Schema, Data>
): WebSocketRouter<Data>
```

**Handler Context**:

```typescript
type MessageContext<Schema, Data> = {
  ws: ServerWebSocket<Data>;
  type: Schema["shape"]["type"]["value"]; // Message type literal
  meta: z.infer<Schema["shape"]["meta"]>; // Metadata
  payload: z.infer<Schema["shape"]["payload"]>; // Only if schema defines it
  send: SendFunction; // Type-safe send function
};
```

**Type Safety**: `ctx.payload` exists only when schema defines it:

```typescript
const WithPayload = messageSchema("WITH", { id: z.number() });
const WithoutPayload = messageSchema("WITHOUT");

router.onMessage(WithPayload, (ctx) => {
  const id = ctx.payload.id; // ✅ Typed as number
});

router.onMessage(WithoutPayload, (ctx) => {
  const p = ctx.payload; // ❌ Type error
});
```

### Connection Lifecycle

```typescript
router.onOpen((ctx) => {
  // ctx: { ws, send }
});

router.onClose((ctx) => {
  // ctx: { ws, code, reason?, send }
});
```

### WebSocket Upgrade

```typescript
router.upgrade(req, {
  server,
  data: { userId: "123" },  // Custom connection data
  headers: { ... }
});

// Connection data type
type WebSocketData<T> = {
  clientId: string;  // Auto-generated UUID v7
} & T;
```

### Route Composition

```typescript
const authRouter = new WebSocketRouter();
authRouter.onMessage(LoginMessage, handleLogin);

const chatRouter = new WebSocketRouter();
chatRouter.onMessage(SendMessage, handleChat);

const mainRouter = new WebSocketRouter()
  .addRoutes(authRouter)
  .addRoutes(chatRouter);
```

## Message Routing

### Type-Based Routing

Messages route by `type` field. Last registered handler wins:

```typescript
router.onMessage(TestMessage, handler1);
router.onMessage(TestMessage, handler2); // ⚠️ Overwrites handler1
// Console: Handler for "TEST" is being overwritten
```

### Validation Flow

```
Client Message → JSON Parse → Type Check → Handler Lookup → Validation → Handler
```

- Parse error → Logged, ignored
- Missing type → Logged, ignored
- No handler → Logged, ignored
- Validation error → Logged, handler not called
- Handler error → Logged, connection stays open

## Type-Safe Sending

```typescript
const ResponseMsg = messageSchema("RESPONSE", { result: z.string() });

router.onMessage(SomeMessage, (ctx) => {
  ctx.send(ResponseMsg, { result: "ok" }); // ✅
  ctx.send(ResponseMsg, { result: 123 }); // ❌ Type error
});
```

## Broadcasting

```typescript
import { publish } from "bun-ws-router/zod/publish";

router.onMessage(ChatMessage, (ctx) => {
  const roomTopic = `room:${ctx.meta.roomId}`;
  publish(ctx.ws, roomTopic, ChatMessage, {
    text: ctx.payload.text,
    sender: ctx.ws.data.userId,
  });
});
```

## Custom Connection Data

```typescript
type UserData = WebSocketData<{
  userId: string;
  roles: string[];
}>;

const router = new WebSocketRouter<UserData>();

router.onMessage(SecureMessage, (ctx) => {
  const userId = ctx.ws.data.userId; // ✅ Typed
  const clientId = ctx.ws.data.clientId; // ✅ Always present
});

router.upgrade(req, {
  server,
  data: {
    userId: "user-123",
    roles: ["admin"],
  },
});
```

## Error Handling

All errors are logged. Connections stay open unless handler explicitly closes.

```typescript
router.onMessage(ErrorMessage, async (ctx) => {
  try {
    await riskyOperation();
  } catch (error) {
    ctx.send(ErrorMessage, {
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
});
```

## AI Code Generation Constraints

1. **NEVER** access `ctx.payload` without checking schema defines payload
2. **ALWAYS** wrap async operations in try/catch
3. **ALWAYS** use `ctx.send()` for type-safe message sending
4. Use `addRoutes()` for composition from feature modules
5. Pass authentication/session data during `upgrade()`
6. Use `publish()` for validated broadcasting
7. Trust schema validation—don't re-validate in handlers
8. Always handle promise rejections in async handlers
