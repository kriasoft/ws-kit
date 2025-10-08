# Bun WebSocket Router

Type-safe WebSocket router for Bun with Zod or Valibot validation.

## Specifications and ADRs

- `specs/adrs.md`
- `specs/broadcasting.md`
- `specs/client.md`
- `specs/rules.md`
- `specs/error-handling.md`
- `specs/router.md`
- `specs/schema.md`
- `specs/test-requirements.md`
- `specs/validation.md`

## Architecture

- **Adapter Pattern**: Core router logic with pluggable validators (Zod/Valibot)
- **Message-Based Routing**: Routes by message `type` field to registered handlers
- **Type Safety**: Full TypeScript inference from schema to handler

## Critical: Use Factory Pattern

The factory pattern is **required** to avoid dual package hazard with discriminated unions:

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

// ✅ Correct - use factory with your validator instance
const { messageSchema, createMessage } = createMessageSchema(z);

// ❌ Wrong - deprecated exports will break discriminated unions
import { messageSchema } from "bun-ws-router";
```

## Quick Start

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

// Create factory and router
const { messageSchema } = createMessageSchema(z);
const router = new WebSocketRouter();

// Define message schemas
const PingMessage = messageSchema("PING", { text: z.string() });
const PongMessage = messageSchema("PONG", { reply: z.string() });

// Register handlers
router.onMessage(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

// Use with Bun.serve
Bun.serve({
  fetch(req, server) {
    return router.upgrade(req, { server });
  },
  websocket: router.websocket,
});
```

## Key Patterns

### Route Composition

```typescript
// Compose routers from different modules
const authRouter = new WebSocketRouter();
const chatRouter = new WebSocketRouter();

// Define routes separately
authRouter.onMessage(LoginMessage, handleLogin);
chatRouter.onMessage(SendMessage, handleChat);

// Merge into main router
const mainRouter = new WebSocketRouter();
mainRouter.addRoutes(authRouter).addRoutes(chatRouter);
```

### Authentication

```typescript
// Pass user data during WebSocket upgrade
router.upgrade(req, {
  server,
  data: { userId: "123", roles: ["admin"] },
});

// Access in handlers via ctx.ws.data
router.onMessage(SecureMessage, (ctx) => {
  const { userId, roles } = ctx.ws.data;
});
```

### Broadcasting with Validation

```typescript
import { publish } from "bun-ws-router/zod/publish";

// Publish validates message before sending
publish(ws, "room:123", NotificationSchema, {
  text: "New message",
});
```

### Client-Side Message Creation

```typescript
const { createMessage } = createMessageSchema(z);

// Type-safe message creation with validation
const msg = createMessage(JoinRoomMessage, { roomId: "general" });
if (msg.success) {
  ws.send(JSON.stringify(msg.data));
}
```

## Development

```bash
# Validation
bun run lint        # ESLint with unused directive check
bun tsc --noEmit    # Type checking
bun run format      # Prettier formatting

# Testing
bun test            # Run all tests
bun test --watch    # Watch mode
```
