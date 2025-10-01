# Message Schema Specification

## Factory Pattern (Critical)

**MUST use factory pattern** to avoid dual package hazard with discriminated unions:

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema, createMessage } = createMessageSchema(z);
```

## Message Structure

```typescript
{
  type: string,        // Message type literal (required)
  meta: {              // Metadata (required, can be empty)
    clientId?: string,
    timestamp?: number,
    correlationId?: string,
  },
  payload?: T          // Optional typed payload
}
```

## Schema Patterns

### Without Payload

```typescript
const PingMessage = messageSchema("PING");
// { type: "PING", meta: { ... } }
```

### With Payload

```typescript
const JoinRoom = messageSchema("JOIN_ROOM", {
  roomId: z.string(),
});
// { type: "JOIN_ROOM", meta: { ... }, payload: { roomId: string } }
```

### Extended Meta

```typescript
const RoomMessage = messageSchema(
  "ROOM_MSG",
  { text: z.string() },
  { roomId: z.string() }, // Extended meta
);
// meta: { clientId?, timestamp?, correlationId?, roomId: string }
```

## Type Inference

```typescript
// Schema type
type JoinRoomType = z.infer<typeof JoinRoom>;

// Handler context type
import type { MessageContext } from "bun-ws-router/zod";
type Ctx = MessageContext<typeof JoinRoom, WebSocketData<{}>>;
// {
//   ws: ServerWebSocket<...>,
//   type: "JOIN_ROOM",
//   meta: { ... },
//   payload: { roomId: string },  // ✅ Only if schema defines it
//   send: SendFunction
// }
```

## Conditional Payload Typing

**Key Feature**: `ctx.payload` exists **only** when schema defines it:

```typescript
const WithPayload = messageSchema("WITH", { id: z.number() });
const WithoutPayload = messageSchema("WITHOUT");

router.onMessage(WithPayload, (ctx) => {
  ctx.payload.id; // ✅ Typed as number
});

router.onMessage(WithoutPayload, (ctx) => {
  ctx.payload; // ❌ Type error
});
```

## Discriminated Unions

```typescript
const PingMsg = messageSchema("PING");
const PongMsg = messageSchema("PONG", { reply: z.string() });

const MessageUnion = z.discriminatedUnion("type", [PingMsg, PongMsg]);
```

**Critical**: Factory pattern required for discriminated unions to pass instanceof checks.

## Client-Side Message Creation

```typescript
const { createMessage } = createMessageSchema(z);

const msg = createMessage(JoinRoom, { roomId: "general" });
if (msg.success) {
  ws.send(JSON.stringify(msg.data));
}
```

## Standard Error Schema

```typescript
const { ErrorMessage } = createMessageSchema(z);
// {
//   type: "ERROR",
//   meta: { ... },
//   payload: {
//     code: ErrorCode,
//     message?: string,
//     context?: Record<string, any>
//   }
// }
```

### Error Codes

```typescript
type ErrorCode =
  | "INVALID_MESSAGE_FORMAT"
  | "VALIDATION_FAILED"
  | "UNSUPPORTED_MESSAGE_TYPE"
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_SERVER_ERROR";
```

## AI Code Generation Constraints

1. **ALWAYS** use factory pattern: `createMessageSchema(validator)`
2. **NEVER** import deprecated `messageSchema` directly
3. **ALWAYS** check schema definition before accessing `ctx.payload`
4. Use string literals for message types (enables routing and unions)
5. Define payload as object schemas for proper type inference
6. Add type-level tests with `expectTypeOf` for new schemas
