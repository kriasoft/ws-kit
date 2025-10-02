# WebSocket Router Specification

**Status**: ✅ Implemented

## Overview

Type-safe message routing for Bun WebSocket servers with automatic validation.

## Basic Setup

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);
const router = new WebSocketRouter();

const PingMessage = messageSchema("PING", { value: z.number() });

router.onMessage(PingMessage, (ctx) => {
  console.log("Ping from:", ctx.ws.data.clientId);
  console.log("Received at:", ctx.receivedAt);
  ctx.send(PongMessage, { reply: ctx.payload.value * 2 });
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
  ws: ServerWebSocket<Data>; // Connection (ws.data.clientId always present)
  type: Schema["shape"]["type"]["value"]; // Message type literal
  meta: z.infer<Schema["shape"]["meta"]>; // Validated client metadata
  payload: z.infer<Schema["shape"]["payload"]>; // Only if schema defines it
  receivedAt: number; // Server receive timestamp (Date.now())
  send: SendFunction; // Type-safe send function
};
```

**Server-provided context fields**:

- `ctx.ws.data.clientId`: Connection identity (UUID v7, generated during upgrade)
- `ctx.receivedAt`: Server receive timestamp (milliseconds since epoch)

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
  console.log("Client connected:", ctx.ws.data.clientId);
});

router.onClose((ctx) => {
  // ctx: { ws, code, reason?, send }
  console.log("Client disconnected:", ctx.ws.data.clientId);
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

**Connection identity**:

- `clientId` is generated during upgrade (UUID v7, time-ordered)
- Accessible via `ctx.ws.data.clientId` in all handlers
- NOT included in message `meta` (connection state, not message state)

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

**Type System Note**: `addRoutes()` accepts `WebSocketRouter<T> | any` to support derived router types with stricter handler signatures (see @adrs.md#ADR-001). This is an intentional LSP violation to enable better IDE inference for inline handlers.

## Message Routing

### Type-Based Routing

Messages route by `type` field. Last registered handler wins:

```typescript
router.onMessage(TestMessage, handler1);
router.onMessage(TestMessage, handler2); // ⚠️ Overwrites handler1
// Console: Handler for "TEST" is being overwritten
```

### Validation Flow

```text
Client Message → JSON Parse → Type Check → Handler Lookup → Normalize → Validation → Handler
```

**CRITICAL**: Normalization is a **security boundary**. Handlers MUST NEVER receive un-normalized input. Reserved keys (`clientId`, `receivedAt`) are stripped before validation to prevent spoofing.

- Parse error → Logged, ignored
- Missing type → Logged, ignored
- No handler → Logged, ignored
- Normalization → Strip reserved keys (security boundary)
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

**Outbound metadata**: `ctx.send()` automatically adds `timestamp` to `meta` (producer time for UI display; **server logic MUST use `ctx.receivedAt`**, not `meta.timestamp` — see @schema.md#Which-timestamp-to-use).

**Status**: ⚠️ Needs verification — See @implementation-status.md#GAP-003 to confirm auto-timestamp injection is implemented.

## Broadcasting

```typescript
import { publish } from "bun-ws-router/zod/publish";

router.onMessage(ChatMessage, (ctx) => {
  const roomTopic = `room:${ctx.meta.roomId}`;
  publish(
    ctx.ws,
    roomTopic,
    ChatMessage,
    { text: ctx.payload.text },
    { origin: "userId" }, // ✅ Canonical pattern: DX sugar for origin
  );
});
```

**Broadcast metadata**: `publish()` adds `timestamp` to `meta` (producer time for UI display; **server logic MUST use `ctx.receivedAt`**, not `meta.timestamp` — see @schema.md#Which-timestamp-to-use).

## Custom Connection Data

```typescript
type UserData = WebSocketData<{
  userId: string;
  roles: string[];
}>;

const router = new WebSocketRouter<UserData>();

router.onMessage(SecureMessage, (ctx) => {
  const userId = ctx.ws.data.userId; // ✅ Typed (custom)
  const clientId = ctx.ws.data.clientId; // ✅ Typed (always present)
  const receivedAt = ctx.receivedAt; // ✅ Typed (server timestamp)
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
router.onMessage(RiskyMessage, async (ctx) => {
  try {
    await riskyOperation();
  } catch (error) {
    console.error(`[${ctx.ws.data.clientId}] Operation failed:`, error);
    ctx.send(ErrorMessage, {
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
});
```

## Key Constraints

> See @constraints.md for complete rules. Critical for routing:

1. **Connection identity** — Access via `ctx.ws.data.clientId`, never `ctx.meta` (see @constraints.md#state-layering)
2. **Server timestamp** — Use `ctx.receivedAt` for authoritative time (see @schema.md#Which-timestamp-to-use)
3. **Payload typing** — `ctx.payload` exists only when schema defines it (see @adrs.md#ADR-001)
4. **Error handling** — Connections stay open on errors; handlers MUST explicitly close (see @constraints.md#error-handling)
5. **Validation flow** — Trust schema validation; never re-validate in handlers (see @constraints.md#validation-flow)
