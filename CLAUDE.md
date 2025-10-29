# ws-kit

Type-safe WebSocket router with pluggable validators (Zod/Valibot) and platform adapters (Bun/Cloudflare DO).

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

- **Modular Packages**: `@ws-kit/core` router with pluggable validator and platform adapters
- **Composition Over Inheritance**: Single `WebSocketRouter<V>` class, any validator + platform combo works
- **Message-Based Routing**: Routes by message `type` field to registered handlers
- **Type Safety**: Full TypeScript inference from schema to handler via generics and overloads
- **Platform Adapters**: `@ws-kit/bun`, `@ws-kit/cloudflare-do`, more platforms can be added without core changes
- **Validator Adapters**: `@ws-kit/zod`, `@ws-kit/valibot`, custom validators welcome via `ValidatorAdapter` interface

## Critical: Use Factory Pattern

The factory pattern is **required** to avoid dual package hazard with discriminated unions:

```typescript
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

// ✅ Correct - use factory with your validator instance
const { messageSchema } = createMessageSchema(z);

// ✅ Also correct - use simplified default export
import { zodValidator } from "@ws-kit/zod";
const validator = zodValidator(); // Uses default Zod config
```

## Quick Start

```typescript
import { z } from "zod";
import { WebSocketRouter } from "@ws-kit/core";
import { zodValidator, createMessageSchema } from "@ws-kit/zod";
import { createBunAdapter, createBunHandler } from "@ws-kit/bun";

// Create message schema factory
const { messageSchema } = createMessageSchema(z);
const PingMessage = messageSchema("PING", { text: z.string() });
const PongMessage = messageSchema("PONG", { reply: z.string() });

// Compose router with Zod validator and Bun platform adapter
const router = new WebSocketRouter({
  validator: zodValidator(),
  platform: createBunAdapter(),
});

// Register handlers
router.onMessage(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

// Create Bun handler and serve
const { fetch, websocket } = createBunHandler(router);

Bun.serve({
  fetch,
  websocket,
});
```

## Key Patterns

### Route Composition

```typescript
import { WebSocketRouter } from "@ws-kit/core";
import { zodValidator } from "@ws-kit/zod";
import { createBunAdapter } from "@ws-kit/bun";

// Compose modules separately
const authRouter = new WebSocketRouter({ validator: zodValidator() });
const chatRouter = new WebSocketRouter({ validator: zodValidator() });

// Define routes in modules
authRouter.onMessage(LoginMessage, handleLogin);
chatRouter.onMessage(SendMessage, handleChat);

// Merge into main router with platform adapter
const mainRouter = new WebSocketRouter({
  validator: zodValidator(),
  platform: createBunAdapter(),
});
mainRouter.addRoutes(authRouter).addRoutes(chatRouter);
```

### Authentication

```typescript
import { createBunHandler } from "@ws-kit/bun";

// Create handler with custom upgrade logic
const { fetch, websocket } = createBunHandler(router, {
  onUpgrade(req, ws) {
    // Extract token from request and attach to ws.data
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (token) {
      ws.data = { userId: "123", roles: ["admin"] };
    }
  },
});

// Access in handlers via ctx.ws.data
router.onMessage(SecureMessage, (ctx) => {
  const { userId, roles } = ctx.ws.data || {};
});
```

### Broadcasting with Validation

```typescript
// Publish to all listeners on a channel (scope depends on platform)
router.onMessage(SendMessageSchema, async (ctx) => {
  const message = {
    type: "MESSAGE",
    payload: ctx.payload,
    userId: ctx.ws.data?.userId,
  };

  // Bun: broadcasts to all listeners in this process
  // Cloudflare DO: broadcasts only within this DO instance
  await router.publish("room:123", message);
});
```

### Client-Side Message Creation

```typescript
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

// Create schema factory with your Zod instance
const { messageSchema } = createMessageSchema(z);
const JoinRoomMessage = messageSchema("JOIN_ROOM", { roomId: z.string() });

// Type-safe client message
type JoinRoomMsg = typeof JoinRoomMessage;

// Send to server with full type inference
ws.send(
  JSON.stringify({
    type: "JOIN_ROOM",
    payload: { roomId: "general" },
  }),
);
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

## Test Structure

Tests are organized by package. Each package owns its test directory:

```
packages/
├── core/test/              # Core router tests + features/
├── zod/test/               # Zod validator tests + features/
├── valibot/test/           # Valibot validator tests + features/
├── bun/test/               # Bun adapter tests
├── client/test/            # Client tests (runtime/ + types/)
└── cloudflare-do/test/     # Cloudflare DO adapter tests
```

**When adding tests:**

- **Core features**: `packages/core/test/features/`
- **Validator features**: Mirror Zod tests in Valibot with same structure
- **Type inference tests**: Use `packages/*/test/types/`
- **Adapters**: Add to respective `packages/*/test/`

**Run tests:**

```bash
bun test                           # All tests
bun test packages/zod/test         # Specific package
bun test --grep "pattern"          # By pattern
bun test --watch                   # Watch mode
```
