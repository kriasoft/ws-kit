# WebSocket Router Specification

**Status**: ✅ Implemented

## Overview

Type-safe message routing for Bun WebSocket servers with automatic validation.

## Section Map

Quick navigation for AI tools:

- [#Basic-Setup](#basic-setup) — Minimal router example
- [#Router-API](#router-api) — Handler registration and context types
- [#Message-Routing](#message-routing) — Type-based dispatch and validation flow
- [#Type-Safe-Sending](#type-safe-sending) — Unicast messaging with ctx.send()
- [#Custom-Connection-Data](#custom-connection-data) — Typed connection state
- [#Error-Handling](#error-handling) — Handler error patterns
- **Broadcasting**: See @broadcasting.md for multicast patterns

## Basic Setup

```typescript
import { z } from "zod";
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
import { createBunHandler, createBunAdapter } from "@ws-kit/bun";

const { messageSchema } = createMessageSchema(z);
const router = createZodRouter({
  platform: createBunAdapter(),
});

const PingMessage = messageSchema("PING", { value: z.number() });
const PongMessage = messageSchema("PONG", { reply: z.number() });

router.onMessage(PingMessage, (ctx) => {
  console.log("Ping from:", ctx.ws.data.clientId);
  console.log("Received at:", ctx.receivedAt);
  // ✅ ctx.payload is fully typed - no 'as any' needed!
  ctx.send(PongMessage, { reply: ctx.payload.value * 2 });
});

const { fetch, websocket } = createBunHandler(router._core);

Bun.serve({
  fetch,
  websocket,
});
```

## Typed Router Factories

To ensure full type safety and prevent accidental payload type mismatches, **always use the typed router factories**: `createZodRouter()` or `createValibotRouter()`.

### Why Typed Router Factories?

The core `WebSocketRouter` is validator-agnostic (works with any validator), which means it uses generic types internally. This causes TypeScript to lose schema type information when handlers are stored. Without the factory wrapper, accessing `ctx.payload` would require type assertions:

```typescript
// ❌ Without typed router factory - type assertion needed
const router = new WebSocketRouter({ validator: zodValidator() });
router.onMessage(PingMessage, (ctx) => {
  const value = (ctx.payload as any).value; // Loss of type safety
});

// ✅ With typed router factory - full type inference
const router = createZodRouter();
router.onMessage(PingMessage, (ctx) => {
  const value = ctx.payload.value; // Fully typed, no assertion
});
```

### Available Factories

- **`createZodRouter()`** (@ws-kit/zod) — For Zod validators
- **`createValibotRouter()`** (@ws-kit/valibot) — For Valibot validators
- **Custom validator?** See @validation.md for using the core `WebSocketRouter` directly

All factories return identical APIs—the difference is purely in type preservation. Choose based on your validator:

```typescript
// Zod
import { createZodRouter } from "@ws-kit/zod";
const router = createZodRouter();

// Valibot
import { createValibotRouter } from "@ws-kit/valibot";
const router = createValibotRouter();
```

### Advanced: Accessing Core Router

For platform-specific operations, the `._core` property exposes the underlying core router:

```typescript
import { createBunHandler } from "@ws-kit/bun";

const router = createZodRouter();

// Platform handlers need the core router
const { fetch, websocket } = createBunHandler(router._core);
```

This is a rare pattern—use it only when the typed wrapper doesn't expose the functionality you need. See ADR-004 for the architectural rationale.

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
  // ctx: { ws, code, reason, send }
  console.log(
    "Client disconnected:",
    ctx.ws.data.clientId,
    ctx.code,
    ctx.reason,
  );
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
import { createZodRouter } from "@ws-kit/zod";

const authRouter = createZodRouter();
authRouter.onMessage(LoginMessage, handleLogin);

const chatRouter = createZodRouter();
chatRouter.onMessage(SendMessage, handleChat);

const mainRouter = createZodRouter()
  .addRoutes(authRouter)
  .addRoutes(chatRouter);
```

**Type System Note**: `addRoutes()` accepts `TypedZodRouter<T> | any` to support router composition. The typed router wrapper preserves handler types within each router, enabling proper type inference (see ADR-004).

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

**For broadcasting to multiple clients**, see @broadcasting.md for multicast patterns using Bun's native pubsub.

## Custom Connection Data

```typescript
import { createZodRouter } from "@ws-kit/zod";
import type { WebSocketData } from "@ws-kit/core";

type UserData = WebSocketData<{
  userId: string;
  roles: string[];
}>;

const router = createZodRouter<UserData>();

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

> See @rules.md for complete rules. Critical for routing:

1. **Connection identity** — Access via `ctx.ws.data.clientId`, never `ctx.meta` (see @rules.md#state-layering)
2. **Server timestamp** — Use `ctx.receivedAt` for authoritative time (see @schema.md#Which-timestamp-to-use)
3. **Payload typing** — `ctx.payload` exists only when schema defines it (see ADR-001)
4. **Error handling** — Connections stay open on errors; handlers MUST explicitly close (see @rules.md#error-handling)
5. **Validation flow** — Trust schema validation; never re-validate in handlers (see @rules.md#validation-flow)
6. **Broadcasting** — For multicast messaging, see @broadcasting.md (not covered in this spec)
