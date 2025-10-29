# ws-kit

WS-Kit — Type-Safe WebSocket router for Bun and Cloudflare.

## Documentation

**ADRs** (`docs/adr/NNN-slug.md`): Architectural decisions (reference as ADR-NNN)
**SPECs** (`docs/specs/slug.md`): Component specifications (reference as docs/specs/slug.md)

- `docs/specs/broadcasting.md`
- `docs/specs/client.md`
- `docs/specs/rules.md`
- `docs/specs/error-handling.md`
- `docs/specs/router.md`
- `docs/specs/schema.md`
- `docs/specs/test-requirements.md`
- `docs/specs/validation.md`

## Architecture

- **Modular Packages**: `@ws-kit/core` router with pluggable validator and platform adapters
- **Composition Over Inheritance**: Single `WebSocketRouter<V>` class, any validator + platform combo works
- **Message-Based Routing**: Routes by message `type` field to registered handlers
- **Type Safety**: Full TypeScript inference from schema to handler via generics and overloads
- **Platform Adapters**: `@ws-kit/bun`, `@ws-kit/cloudflare-do`, more platforms can be added without core changes
- **Validator Adapters**: `@ws-kit/zod`, `@ws-kit/valibot`, custom validators welcome via `ValidatorAdapter` interface

## Critical: Use Factory Pattern

The factory pattern is used in two places for type safety:

### 1. Message Schema Factory

**Required** to avoid dual package hazard with discriminated unions:

```typescript
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

// ✅ Correct - use factory with your validator instance
const { messageSchema } = createMessageSchema(z);

// ✅ Also correct - use simplified default export
import { zodValidator } from "@ws-kit/zod";
const validator = zodValidator(); // Uses default Zod config
```

### 2. Typed Router Factory

**Recommended** for full type inference in message handlers:

```typescript
import { createZodRouter } from "@ws-kit/zod"; // Zod router
// OR
import { createValibotRouter } from "@ws-kit/valibot"; // Valibot router

// ✅ Correct - creates a type-safe router
const router = createZodRouter();

// ❌ Avoid - loses type inference in handlers
const router = new WebSocketRouter({ validator: zodValidator() });
```

The typed router factory preserves payload types through handler invocation, eliminating the need for `as any` type assertions. See ADR-004 for details.

## Quick Start

```typescript
import { z } from "zod";
import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
import { createBunAdapter, createBunHandler } from "@ws-kit/bun";

// Create message schemas with full type inference
const { messageSchema } = createMessageSchema(z);
const PingMessage = messageSchema("PING", { text: z.string() });
const PongMessage = messageSchema("PONG", { reply: z.string() });

// Create type-safe router with Zod validation
const router = createZodRouter({
  platform: createBunAdapter(),
});

// Register handlers - payload types are fully inferred!
router.onMessage(PingMessage, (ctx) => {
  // ✅ ctx.payload.text is automatically typed as string!
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

// Create Bun handler and serve
const { fetch, websocket } = createBunHandler(router._core);

Bun.serve({
  fetch,
  websocket,
});
```

**Note on `router._core`**: The typed router wrapper (`createZodRouter()`) provides type-safe handler registration. Platform handlers like `createBunHandler()` require the underlying core router via the `._core` property. This is a thin wrapper layer—no performance overhead.

## Key Patterns

### Route Composition

```typescript
import { createZodRouter } from "@ws-kit/zod";
import { createBunAdapter } from "@ws-kit/bun";

// Compose modules separately - each with type-safe handlers
const authRouter = createZodRouter();
authRouter.onMessage(LoginMessage, handleLogin); // ✅ Fully typed

const chatRouter = createZodRouter();
chatRouter.onMessage(SendMessage, handleChat); // ✅ Fully typed

// Merge into main router with platform adapter
const mainRouter = createZodRouter({
  platform: createBunAdapter(),
});
mainRouter.addRoutes(authRouter).addRoutes(chatRouter);
```

### Authentication

```typescript
import { createBunHandler } from "@ws-kit/bun";
import { createZodRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roles?: string[] };

const router = createZodRouter<AppData>({
  platform: createBunAdapter(),
});

// Create handler with custom authentication
const { fetch, websocket } = createBunHandler(router._core, {
  authenticate(req) {
    // Extract token from request
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (token) {
      return { userId: "123", roles: ["admin"] };
    }
  },
});

// Access in handlers via ctx.ws.data - fully typed!
router.onMessage(SecureMessage, (ctx) => {
  const userId = ctx.ws.data?.userId; // ✅ string | undefined
  const roles = ctx.ws.data?.roles; // ✅ string[] | undefined
});
```

### Broadcasting with Validation

```typescript
import { createZodRouter } from "@ws-kit/zod";

const router = createZodRouter();

// Publish to all listeners on a channel (scope depends on platform)
router.onMessage(SendMessageSchema, async (ctx) => {
  // ctx.payload is fully typed from the schema!
  const message = {
    type: "MESSAGE",
    payload: ctx.payload, // ✅ Automatically typed
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
