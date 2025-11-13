# Getting Started with Router Composition

**Status**: Beginner-friendly guide
**References**: ADR-023, docs/patterns/composition.md

This guide walks you through the recommended pattern for organizing WebSocket applications: **feature modules + composition**.

## The Pattern in 3 Steps

1. **Feature modules** export sub-routers (one router per feature)
2. **Main app** composes them using `merge()`
3. **Type safety is automatic** — no manual annotations needed

That's it! Let's build a real example.

---

## Step 1: Create a Feature Module

A feature module has three files: schema, handlers, router.

### Schema File (`features/chat/schema.ts`)

```typescript
import { z, message } from "@ws-kit/zod";

export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string().min(1),
});

export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string().min(1),
});

export const MessageReceived = message("MESSAGE_RECEIVED", {
  roomId: z.string(),
  userId: z.string(),
  text: z.string(),
  timestamp: z.number(),
});
```

### Handlers File (`features/chat/handlers.ts`)

```typescript
import { JoinRoom, SendMessage, MessageReceived } from "./schema";
import type { MessageContext } from "@ws-kit/core";

type ChatAppData = { userId?: string; clientId: string };

export async function handleJoinRoom(
  ctx: MessageContext<typeof JoinRoom, ChatAppData>,
) {
  const { roomId } = ctx.payload; // ✅ Inferred as string
  const clientId = ctx.ws.data.clientId;

  console.log(`${clientId} joined ${roomId}`);

  // Subscribe to room topic
  await ctx.topics.subscribe(`room:${roomId}`);

  // Store room in connection data for later
  ctx.assignData({ roomId });
}

export async function handleSendMessage(
  ctx: MessageContext<typeof SendMessage, ChatAppData>,
) {
  const { roomId, text } = ctx.payload; // ✅ Inferred as string
  const clientId = ctx.ws.data.clientId;

  // Broadcast to all subscribers
  await ctx.publish(`room:${roomId}`, MessageReceived, {
    roomId,
    userId: clientId,
    text,
    timestamp: Date.now(),
  });
}
```

### Router File (`features/chat/router.ts`)

```typescript
import { createRouter } from "@ws-kit/zod";
import type { WebSocketData } from "@ws-kit/core";
import { JoinRoom, SendMessage } from "./schema";
import { handleJoinRoom, handleSendMessage } from "./handlers";

type ChatData = WebSocketData & { roomId?: string; clientId: string };

export function createChatRouter<TData extends ChatData = ChatData>() {
  return createRouter<TData>()
    .on(JoinRoom, handleJoinRoom)
    .on(SendMessage, handleSendMessage)
    .onClose((ctx) => {
      const roomId = ctx.ws.data.roomId as string | undefined;
      if (roomId) {
        console.log(`${ctx.ws.data.clientId} left ${roomId}`);
      }
    });
}
```

---

## Step 2: Create Another Feature (Presence)

Add a presence feature showing who's online:

### Schema (`features/presence/schema.ts`)

```typescript
import { z, message } from "@ws-kit/zod";

export const UserOnline = message("USER_ONLINE", {
  userId: z.string(),
  username: z.string(),
});

export const UserOffline = message("USER_OFFLINE", {
  userId: z.string(),
});
```

### Router (`features/presence/router.ts`)

```typescript
import { createRouter } from "@ws-kit/zod";
import type { WebSocketData } from "@ws-kit/core";
import { UserOnline, UserOffline } from "./schema";

type PresenceData = WebSocketData & { userId?: string; clientId: string };

export function createPresenceRouter<
  TData extends PresenceData = PresenceData,
>() {
  return createRouter<TData>()
    .onOpen((ctx) => {
      const userId = ctx.ws.data.userId;
      if (userId) {
        // Broadcast user came online
        void ctx.publish("global", UserOnline, {
          userId,
          username: userId,
        });
      }
    })
    .onClose((ctx) => {
      const userId = ctx.ws.data.userId;
      if (userId) {
        // Broadcast user went offline
        void ctx.publish("global", UserOffline, {
          userId,
        });
      }
    });
}
```

---

## Step 3: Compose in Main App

Create the main app that merges all feature modules:

### App Router (`app.ts`)

```typescript
import { createRouter } from "@ws-kit/zod";
import { createChatRouter } from "./features/chat/router";
import { createPresenceRouter } from "./features/presence/router";

type AppData = {
  userId?: string;
  clientId: string;
  roomId?: string;
};

export function createAppRouter() {
  return (
    createRouter<AppData>()
      // Global middleware can go here
      .use(async (ctx, next) => {
        console.log(`[${ctx.type}] from ${ctx.ws.data.clientId}`);
        await next();
      })
      // Compose features
      .merge(createChatRouter<AppData>())
      .merge(createPresenceRouter<AppData>())
  );
}
```

### Server Entry (`index.ts`)

```typescript
import { serve } from "@ws-kit/bun";
import { createAppRouter } from "./app";

const appRouter = createAppRouter();

serve(appRouter, {
  port: 3000,
  authenticate: async (req) => {
    // Extract user ID from request (e.g., JWT, session)
    const userId = req.headers.get("x-user-id") || "anonymous";
    return { userId, clientId: crypto.randomUUID() };
  },
});
```

---

## Directory Structure

```
src/
├── app.ts                     # Main app composition
├── index.ts                   # Server entry point
└── features/
    ├── chat/
    │   ├── schema.ts          # Message definitions
    │   ├── handlers.ts        # Business logic
    │   └── router.ts          # Export createChatRouter()
    └── presence/
        ├── schema.ts
        ├── handlers.ts
        └── router.ts
```

---

## Key Benefits

### Type Safety Everywhere

```typescript
// In createChatRouter() handler:
const { roomId } = ctx.payload; // ✅ string, inferred from JoinRoom schema
// No manual annotation needed!
```

### Independent Testing

```typescript
import { describe, test, expect } from "bun:test";
import { createChatRouter } from "./features/chat/router";

describe("Chat Router", () => {
  test("JOIN_ROOM handler works", async () => {
    const router = createChatRouter<{ userId?: string; clientId: string }>();
    // Test sub-router without full app context
  });
});
```

### Clear Module Boundaries

Each feature:

- Owns its messages (schema.ts)
- Owns its logic (handlers.ts)
- Exports a router (router.ts)
- Can be tested in isolation

### Scales Naturally

Add more features as needed:

```typescript
createAppRouter()
  .merge(createChatRouter<AppData>())
  .merge(createPresenceRouter<AppData>())
  .merge(createNotificationsRouter<AppData>())
  .merge(createAnalyticsRouter<AppData>());
```

---

## When to Deviate

### Use Helpers for Infrastructure (Not Features)

Helpers are appropriate for **middleware**, **setup**, and **lifecycle hooks**:

```typescript
// ✅ Use helper for global middleware
function setupLogging(router: Router<AppData>) {
  router.use(async (ctx, next) => {
    console.time(`${ctx.type}`);
    await next();
    console.timeEnd(`${ctx.type}`);
  });
}

// ✅ Use helper for global auth
function setupAuth(router: Router<AppData>) {
  router.use(async (ctx, next) => {
    const token = extractToken(ctx);
    const user = await verifyToken(token);
    ctx.assignData({ userId: user.id });
    await next();
  });
}

// App composition
const appRouter = createRouter<AppData>();
setupLogging(appRouter);
setupAuth(appRouter);
appRouter.merge(createChatRouter<AppData>());
```

The boundary is clear:

- **Composition**: Features (message handlers, lifecycle hooks specific to a feature)
- **Helpers**: Infrastructure (global middleware, authentication, error handling)

---

## Troubleshooting

### "Error: router does not have handler for message X"

You forgot to register the handler in the feature router:

```typescript
// ❌ Missing in router.ts
export function createChatRouter<TData>() {
  return createRouter<TData>().on(JoinRoom, handleJoinRoom);
  // Missing: .on(SendMessage, handleSendMessage)
}

// ✅ Add it
export function createChatRouter<TData>() {
  return createRouter<TData>()
    .on(JoinRoom, handleJoinRoom)
    .on(SendMessage, handleSendMessage); // ← Added
}
```

### "Type error: AppData mismatch"

All merged routers must use the same `TData`:

```typescript
// ❌ Wrong: different AppData in each router
const router = createRouter<AppData1>().merge(createChatRouter<AppData2>()); // Type error!

// ✅ Right: same AppData everywhere
const router = createRouter<AppData>().merge(createChatRouter<AppData>());
```

### "TypeScript doesn't infer payload type"

Make sure you're using the schema-driven pattern:

```typescript
// ❌ Helper pattern (old):
function setupChat(router: Router<AppData>) {
  router.on(JoinRoom, (c) => {
    const { roomId } = c.payload; // ❌ any, not inferred
  });
}

// ✅ Composition pattern (new):
export function createChatRouter<TData>() {
  return createRouter<TData>().on(JoinRoom, (c) => {
    const { roomId } = c.payload; // ✅ string, inferred
  });
}
```

---

## Next Steps

- **Learn patterns**: Read [docs/patterns/composition.md](../patterns/composition.md) for advanced patterns
- **Full design**: See [docs/guides/schema-driven-design.md](../guides/schema-driven-design.md) for A + G + D overview
- **Type safety**: Understand guarantees in [ADR-023](../adr/023-schema-driven-type-inference.md)
- **Run example**: Check [examples/quick-start](../../examples/quick-start) for a complete working app

---

## Summary

Composition is straightforward:

1. **Create feature modules** with `schema.ts`, `handlers.ts`, `router.ts`
2. **Export `createXRouter<TData>()`** from each feature
3. **Merge in main app**: `createRouter().merge(createChatRouter()).merge(...)`
4. **Enjoy perfect type inference** with zero manual annotations

You now have a scalable, testable, type-safe WebSocket application! 🎉
