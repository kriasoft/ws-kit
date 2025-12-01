# Schema-Driven Router Design (A + G + D)

**Status**: Recommended Pattern
**References**: ADR-023, docs/patterns/composition.md
**Audience**: Application developers, library users

## Three Pillars: A + G + D

This guide explains WS-Kit's recommended approach to router design, combining three complementary patterns for maximum DX, type safety, and modularity.

### **A — Schema-Driven Inference**

Handlers infer payload types **purely from the schema parameter**, not router state. No manual annotations needed.

### **G — Composition Over Mutation**

Features are exported as sub-routers and merged at the application level, not passed through helper functions.

### **D — Convention-Based Enforcement (Optional)**

Validator family consistency is enforced through import conventions, not runtime helpers.

---

## The Problem We're Solving

Without this pattern, developers faced a type-safety gap:

```typescript
// ❌ Problem: Type inference lost when passing router through helpers
function setupChat(router: Router<AppData>) {
  router.on(JoinRoom, (c) => {
    const { roomId } = c.payload; // ❌ any, not string!
    // Needed workaround: (c: MessageContext<typeof JoinRoom, AppData>) => { ... }
  });
}
```

With A + G + D, this becomes:

```typescript
// ✅ Solution: Perfect inference everywhere
function createChatRouter<TData>() {
  return createRouter<TData>().on(JoinRoom, (c) => {
    const { roomId } = c.payload; // ✅ string, fully typed
  });
}

const appRouter = createRouter<AppData>().merge(createChatRouter<AppData>());
```

---

## Part A: Schema-Driven Inference

### How It Works

The `on()` method is generic over the **schema parameter**:

```typescript
// Core signature
interface Router<TData> {
  on<S extends MessageSchemaType>(
    schema: S,
    handler: (ctx: MessageContext<S, TData>) => void | Promise<void>,
  ): this;
}
```

When you call `router.on(JoinRoom, handler)`:

1. TypeScript infers `S = typeof JoinRoom`
2. The handler signature becomes `(ctx: MessageContext<typeof JoinRoom, TData>)`
3. `ctx.payload` is automatically typed from the schema

**No router-level validator generic needed.**

### In Practice

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import type { Router, WebSocketData } from "@ws-kit/core";

const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
  userName: z.string().min(1),
});

// Works with typed routers
const typedRouter = createRouter<AppData>();
typedRouter.on(JoinRoom, (c) => {
  const roomId: string = c.payload.roomId; // ✅ Inferred
});

// Also works when erased to interface
function helperFunction(router: Router<AppData>) {
  router.on(JoinRoom, (c) => {
    const roomId: string = c.payload.roomId; // ✅ Still inferred!
  });
}
```

### Why This Matters

- ✅ **Perfect type safety** through function parameters
- ✅ **No workarounds** or manual annotations
- ✅ **Validator-agnostic** (Zod, Valibot, custom)
- ✅ **Transparent inference** — just works

---

## Part G: Composition Over Mutation

### The Pattern

Export sub-routers from feature modules, then merge at the application level:

```typescript
// features/chat/router.ts
export function createChatRouter<TData extends WebSocketData>() {
  return createRouter<TData>()
    .on(JoinRoom, handleJoinRoom)
    .on(SendMessage, handleSendMessage)
    .onClose(handleDisconnect);
}

// features/presence/router.ts
export function createPresenceRouter<TData extends WebSocketData>() {
  return createRouter<TData>()
    .on(UserOnline, handleUserOnline)
    .on(UserOffline, handleUserOffline);
}

// app.ts — Compose at the edge
export function createApp() {
  return createRouter<AppData>()
    .merge(createChatRouter<AppData>())
    .merge(createPresenceRouter<AppData>());
}
```

### Why Composition?

1. **Perfect inference** — Sub-routers inherit type safety, no erasure
2. **Testability** — Each module tested independently:
   ```typescript
   const chatRouter = createChatRouter<TestData>();
   // Test with mock WebSocket, no app context needed
   ```
3. **Clear boundaries** — No passing routers around
4. **Scales naturally** — Compose routers-of-routers
5. **Same elegant API** — Just uses `merge()`

### When to Use Helpers Instead

Helpers are still appropriate for:

- **Cross-cutting concerns** (middleware, logging, auth)
- **Setup functions** (database initialization)
- **Hooks** (error handling, lifecycle)

```typescript
// ✅ Helpers work great for middleware
export function setupLogging(router: Router<AppData>) {
  router.use(async (ctx, next) => {
    console.log(`[${ctx.type}] from ${ctx.clientId}`);
    await next();
  });
}

// App setup
const appRouter = createRouter<AppData>();
setupLogging(appRouter); // ✅ Middleware via helper
appRouter.merge(createChatRouter<AppData>()); // ✅ Features via composition
```

---

## Part D: Convention-Based Enforcement (Optional)

### What It Is

Validator family consistency is enforced through import conventions — not runtime helpers. By standardizing which validator package your team imports from, you guarantee consistency without extra code.

### The Pattern

```typescript
// 📝 Team convention: All features in this service use Zod
// src/features/*/router.ts imports from @ws-kit/zod only
import { createRouter, message, z } from "@ws-kit/zod"; // ← Single import source

// This ensures family consistency through code review, not runtime checks
```

### When to Enforce Conventions

- **Multi-validator teams** that want family enforcement per-module
- **Large applications** with multiple contributors
- **Strict consistency** requirements

### When NOT to Enforce

- **Most applications** — Not needed, schema inference is sufficient
- **Simple projects** — Adds ceremony without benefit
- **Single-validator codebases** — Already consistent by default

**Recommendation**: Use import conventions and code review rather than runtime checks.

---

## Type Safety Guarantees

The A + G + D approach provides the following compile-time and runtime guarantees:

### What A + G + D Guarantees ✅

1. **Payload Type Inference**: `ctx.payload` is typed directly from the schema parameter—no manual annotations needed
2. **Property Access Safety**: Accessing non-existent properties on `ctx.payload` is a TypeScript error
3. **Handler Context Typing**: Full inference of `ctx` type without annotations through `Router<TData>` type
4. **Connection Data Consistency**: `TData` is enforced across merged routers (type-checked at compile time)
5. **Composition Type Preservation**: Merged routers maintain all type information—no type erasure through composition
6. **Message Type Correctness**: `ctx.type` is a literal type matching the schema (e.g., `"JOIN_ROOM"` not `string`)

### What A + G + D Does NOT Guarantee ⚠️

1. **Validator Family Homogeneity**: The system allows mixing Zod and Valibot schemas (use optional narrowers if strict enforcement is needed)
2. **Handler Conflict Detection**: No compile-time error if two routers handle the same message type (last-write-wins applies, as documented)
3. **Message Type Conflicts**: Message type strings are not enforced to be unique across features (enforced by application structure, not types)
4. **Build-Time Message Validation**: Message type validity checked at runtime, not compile-time (schemas carry runtime validators)

### When You Need Stricter Guarantees

Enforce validator family per-module through import conventions:

```typescript
// 📝 Team convention: All features in this service use Zod
// src/features/*/router.ts imports from @ws-kit/zod only
import { createRouter, message, z } from "@ws-kit/zod"; // ← Single import source

// This ensures family consistency through code review, not runtime checks
```

For TypeScript-level enforcement, use branded types or module boundaries:

```typescript
// types/router.ts — Define your app's router type
import type { Router } from "@ws-kit/core";

export type AppRouter = Router<AppData>;

// features/chat/router.ts — Use the branded type
import type { AppRouter } from "../../types/router";
import { createRouter } from "@ws-kit/zod";

export function createChatRouter(): AppRouter {
  return createRouter<AppData>().on(JoinRoom, (c) => {
    // Full inference, and type system ensures AppData consistency
  });
}
```

---

## End-to-End Example

### Project Structure

```
src/
├── features/
│   ├── chat/
│   │   ├── schema.ts       # Message definitions
│   │   ├── handlers.ts     # Business logic
│   │   └── router.ts       # createChatRouter()
│   ├── presence/
│   │   ├── schema.ts
│   │   ├── handlers.ts
│   │   └── router.ts
│   └── notifications/
│       ├── schema.ts
│       ├── handlers.ts
│       └── router.ts
├── middleware/
│   ├── auth.ts             # setupAuth()
│   ├── logging.ts          # setupLogging()
│   └── rateLimit.ts        # setupRateLimit()
├── app.ts                  # createApp()
└── index.ts                # Server entry
```

### Implementation

**features/chat/schema.ts**

```typescript
import { z, message } from "@ws-kit/zod";

export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string().min(1),
});

export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string().min(1),
});
```

**features/chat/handlers.ts**

```typescript
import { JoinRoom, SendMessage } from "./schema";

export async function handleJoinRoom(
  ctx: MessageContext<typeof JoinRoom, AppData>,
) {
  const { roomId } = ctx.payload; // ✅ Inferred: string
  await ctx.topics.subscribe(`room:${roomId}`);
  ctx.send(UserJoined, { roomId, userId: ctx.clientId });
}

export async function handleSendMessage(
  ctx: MessageContext<typeof SendMessage, AppData>,
) {
  const { roomId, text } = ctx.payload; // ✅ Inferred: both strings
  await ctx.publish(`room:${roomId}`, NewMessage, {
    roomId,
    userId: ctx.clientId,
    text,
  });
}
```

**features/chat/router.ts**

```typescript
import { createRouter } from "@ws-kit/zod";
import { handleJoinRoom, handleSendMessage } from "./handlers";

export function createChatRouter<TData extends WebSocketData>() {
  return createRouter<TData>()
    .on(JoinRoom, handleJoinRoom)
    .on(SendMessage, handleSendMessage)
    .onClose((ctx) => {
      if (ctx.data.roomId) {
        void ctx.publish(`room:${ctx.data.roomId}`, UserLeft, {
          roomId: ctx.data.roomId,
          userId: ctx.clientId,
        });
      }
    });
}
```

**middleware/auth.ts**

```typescript
export function setupAuth(router: Router<AppData>) {
  router.use(async (ctx, next) => {
    const token = extractToken(ctx);
    const user = await verifyToken(token);
    ctx.assignData({ userId: user.id, role: user.role });
    await next();
  });
}
```

**app.ts**

```typescript
import { createRouter } from "@ws-kit/zod";
import { createChatRouter } from "./features/chat/router";
import { createPresenceRouter } from "./features/presence/router";
import { setupAuth } from "./middleware/auth";
import { setupLogging } from "./middleware/logging";

type AppData = {
  userId?: string;
  role?: string;
  roomId?: string;
};

export function createApp() {
  const router = createRouter<AppData>();

  // Setup middleware (helpers are fine here)
  setupAuth(router);
  setupLogging(router);

  // Merge features (composition)
  return router
    .merge(createChatRouter<AppData>())
    .merge(createPresenceRouter<AppData>())
    .onOpen((ctx) => {
      console.log(`Connected: ${ctx.data.userId}`);
    });
}
```

**index.ts**

```typescript
import { serve } from "@ws-kit/bun";
import { createApp } from "./app";

serve(createApp(), {
  port: 3000,
  authenticate: async (req) => {
    return { userId: undefined, role: undefined };
  },
});
```

---

## Migration Guide

If you have existing code using helpers:

**Before**:

```typescript
function setupChat(router: Router<AppData>) {
  router.on(JoinRoom, (c: MessageContext<typeof JoinRoom, AppData>) => {
    // Manual annotation needed
  });
}

const router = createRouter<AppData>();
setupChat(router);
```

**After**:

```typescript
function createChatRouter<TData>() {
  return createRouter<TData>().on(JoinRoom, (c) => {
    // No annotation needed—inferred from schema
  });
}

const router = createRouter<AppData>().merge(createChatRouter<AppData>());
```

**Steps**:

1. Convert helper to `createXRouter()` that returns a sub-router
2. Remove manual context annotations
3. Use `merge()` at the application level
4. Delete helper function (or keep for middleware/setup)

---

## Best Practices

1. **One feature = one sub-router** — Clear module boundaries
2. **Export `createXRouter<TData>()` function** — Reusable, testable
3. **Use composition first, helpers second** — For middleware and setup
4. **Test sub-routers independently** — No app context needed
5. **Group by domain** — chat/, presence/, notifications/, not handlers/schemas/routes
6. **Avoid narrowers unless needed** — Composition + schema inference is usually enough

---

## Troubleshooting

### "Type `any` in handler payload"

Make sure you're using the correct schema:

```typescript
// ❌ Wrong: bare message object
router.on({ type: "JOIN_ROOM", payload: { roomId: "string" } }, (c) => {
  // No inference
});

// ✅ Right: message() helper result
const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
router.on(JoinRoom, (c) => {
  // Full inference
});
```

### "Handler not typed properly in merged router"

Ensure the sub-router and merged routers use compatible `TData`:

```typescript
// ❌ Wrong: different TData
const sub = createChatRouter<ChatData>();
const main = createRouter<AppData>();
main.merge(sub); // Type error if ChatData ≠ AppData

// ✅ Right: same TData
const sub = createChatRouter<AppData>();
const main = createRouter<AppData>();
main.merge(sub);
```

### "Performance: Should I split large routers?"

Only if:

- Single module >500 lines
- Distinct feature sets with no shared state
- Want independent testing

Otherwise, keep related handlers in one router for clarity.

---

## References

- **ADR-023**: [Schema-Driven Type Inference](../adr/023-schema-driven-type-inference.md)
- **Composition Pattern**: [docs/patterns/composition.md](../patterns/composition.md)
- **Router Spec**: [docs/specs/router.md](../specs/router.md)
- **Examples**: [examples/quick-start](../../examples/quick-start), [examples/state-channels](../../examples/state-channels)
