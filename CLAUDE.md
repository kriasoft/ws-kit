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

## API Design Principles

- **Single canonical import source**: Import validator and helpers from one place (`@ws-kit/zod` or `@ws-kit/valibot`) to avoid dual package hazards
- **Plain functions**: `message()` and `createRouter()` are plain functions, not factories
- **Full type inference**: TypeScript generics preserve types from schema through handlers without assertions
- **Runtime identity**: Functions preserve `instanceof` checks and runtime behavior

## Quick Start

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve/bun";

type AppData = { userId?: string };

const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

const router = createRouter<AppData>();

router.on(PingMessage, (ctx) => {
  ctx.send(PongMessage, { reply: `Got: ${ctx.payload.text}` });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    return { userId: "anonymous" };
  },
});
```

## Key Patterns

### Route Composition

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = { userId?: string };

const authRouter = createRouter<AppData>();
authRouter.on(LoginMessage, handleLogin);

const chatRouter = createRouter<AppData>();
chatRouter.on(SendMessage, handleChat);

const mainRouter = createRouter<AppData>();
mainRouter.addRoutes(authRouter).addRoutes(chatRouter);
```

### Middleware

Middleware runs before handlers—use it for authorization, validation, logging, rate limiting:

```typescript
import { createRouter } from "@ws-kit/zod";

type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

// Global middleware: authentication check
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return;
  }
  return next();
});

// Per-route middleware: rate limiting
const rateLimiter = new Map<string, number>();
router.use(SendMessage, (ctx, next) => {
  const userId = ctx.ws.data?.userId || "anon";
  const count = (rateLimiter.get(userId) || 0) + 1;
  if (count > 10) {
    ctx.error("RATE_LIMIT", "Too many messages");
    return;
  }
  rateLimiter.set(userId, count);
  return next();
});

router.on(SendMessage, (ctx) => {
  console.log(`Message from ${ctx.ws.data?.userId}: ${ctx.payload.text}`);
});
```

**Semantics:**

- `router.use(middleware)` registers global middleware (runs for all messages)
- `router.use(schema, middleware)` registers per-route middleware (runs only for that message)
- Middleware can call `ctx.error()` to reject, or skip calling `next()` to prevent handler execution
- Middleware can modify `ctx.ws.data` for handlers to access
- Both sync and async middleware supported

### Authentication

Initialize connection data in `serve()`, validate in middleware:

```typescript
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve/bun";

type AppData = { userId?: string; roles?: string[] };
const router = createRouter<AppData>();

// Middleware: require auth for protected messages
router.use((ctx, next) => {
  if (!ctx.ws.data?.userId && ctx.type !== "LOGIN") {
    ctx.error("AUTH_ERROR", "Not authenticated");
    return;
  }
  return next();
});

router.on(SecureMessage, (ctx) => {
  const userId = ctx.ws.data?.userId;
  const roles = ctx.ws.data?.roles;
});

serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    return token ? { userId: "123", roles: ["admin"] } : undefined;
  },
});
```

### Broadcasting

Type-safe publish/subscribe for rooms, channels, or topics:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

type AppData = { roomId?: string; userId?: string };

const SendMessage = message("SEND_MESSAGE", { text: z.string() });
const RoomUpdate = message("ROOM_UPDATE", {
  text: z.string(),
  userId: z.string(),
});

const router = createRouter<AppData>();

router.on(JoinRoom, (ctx) => {
  ctx.subscribe(`room:${ctx.payload.roomId}`);
});

router.on(SendMessage, (ctx) => {
  router.publish(`room:${ctx.ws.data?.roomId}`, RoomUpdate, {
    text: ctx.payload.text,
    userId: ctx.ws.data?.userId || "anon",
  });
});
```

### Client-Side

Create a type-safe WebSocket client using the same schemas:

```typescript
import { z, message } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";

const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const RoomUpdated = message("ROOM_UPDATED", {
  roomId: z.string(),
  users: z.number(),
});

type AppRouter = typeof router;
const client = wsClient<AppRouter>("ws://localhost:3000");

client.send(JoinRoom, { roomId: "general" });

client.on(RoomUpdated, (payload) => {
  console.log(`Room ${payload.roomId} has ${payload.users} users`);
});
```

### Error Handling

Use `ctx.error()` for type-safe error responses with predefined error codes:

```typescript
import { createRouter } from "@ws-kit/zod";
import type { ErrorCode } from "@ws-kit/zod";

const router = createRouter();

router.on(LoginMessage, (ctx) => {
  try {
    const user = authenticate(ctx.payload);
    ctx.send(LoginSuccess, { userId: user.id });
  } catch (err) {
    // ✅ Type-safe error code
    ctx.error("AUTH_ERROR", "Invalid credentials", {
      hint: "Check your password",
    });
  }
});

router.on(QueryMessage, (ctx) => {
  try {
    const result = queryDatabase(ctx.payload);
    // ✅ reply() alias for semantic clarity in request/response pattern
    ctx.reply(QueryResponse, result);
  } catch (err) {
    ctx.error("INTERNAL_ERROR", "Database query failed");
  }
});
```

**Standard error codes:**

- `VALIDATION_ERROR` — Invalid payload or schema mismatch
- `AUTH_ERROR` — Authentication failed
- `INTERNAL_ERROR` — Server error
- `NOT_FOUND` — Resource not found
- `RATE_LIMIT` — Rate limit exceeded

### Connection Data Type Safety

For large applications, declare your default connection data type once using TypeScript declaration merging:

```typescript
// types/app-data.d.ts
declare module "@ws-kit/core" {
  interface AppDataDefault {
    userId?: string;
    roles?: string[];
    tenant?: string;
  }
}
```

Now throughout your app, omit the generic type:

```typescript
// ✅ No generic needed - automatically uses AppDataDefault
const router = createRouter();

router.on(SecureMessage, (ctx) => {
  // ✅ ctx.ws.data is properly typed with all default fields
  const userId = ctx.ws.data?.userId; // string | undefined
  const roles = ctx.ws.data?.roles; // string[] | undefined
});
```

Alternatively, specify the type explicitly for custom data:

```typescript
// ✅ Still supported - explicit type for custom routers
type CustomData = { feature: string; version: number };
const featureRouter = createRouter<CustomData>();
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

```text
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
