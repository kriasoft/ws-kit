# Router Composition Pattern (ADR-023, Pillar G)

**Status**: Recommended
**Tags**: architecture, modularity, type-safety, testing

## Overview

**Composition over mutation** is the first-class pattern for organizing WebSocket router features. Instead of passing routers through function parameters, export sub-routers and merge them at the edge.

### Why Composition First?

1. **Perfect type inference** — Sub-routers preserve full schema-driven inference
2. **Better testability** — Each module's router can be tested in isolation
3. **Clear modular boundaries** — No dependency injection confusion
4. **Scales naturally** — Composition composes (routers-of-routers work smoothly)
5. **Same elegant API** — Uses `merge()`, the core router method

## Pattern: Sub-Router Modules

### Basic Structure

```typescript
// features/chat/schema.ts
import { z, message } from "@ws-kit/zod";

export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string().min(1),
});

export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string().min(1),
});

export const NewMessage = message("NEW_MESSAGE", {
  roomId: z.string(),
  userId: z.string(),
  text: z.string(),
  timestamp: z.number().optional(),
});

// features/chat/handlers.ts
import { JoinRoom, SendMessage, NewMessage } from "./schema";
import type { WebSocketData } from "@ws-kit/core";

type ChatData = WebSocketData & { roomId?: string };

export async function handleJoinRoom(
  ctx: MessageContext<typeof JoinRoom, ChatData>,
) {
  const { roomId } = ctx.payload; // ✅ Fully typed
  await ctx.topics.subscribe(`room:${roomId}`);
  ctx.assignData({ roomId });
  ctx.send(NewMessage, {
    roomId,
    userId: ctx.clientId,
    text: "Joined room",
    timestamp: Date.now(),
  });
}

export async function handleSendMessage(
  ctx: MessageContext<typeof SendMessage, ChatData>,
) {
  const { roomId, text } = ctx.payload; // ✅ Fully typed
  await ctx.publish(`room:${roomId}`, NewMessage, {
    roomId,
    userId: ctx.clientId,
    text,
    timestamp: Date.now(),
  });
}

// features/chat/router.ts ← Sub-router module
import { createRouter } from "@ws-kit/zod";
import { handleJoinRoom, handleSendMessage } from "./handlers";

export function createChatRouter<TData extends ChatData>() {
  return createRouter<TData>()
    .on(JoinRoom, handleJoinRoom)
    .on(SendMessage, handleSendMessage)
    .onClose((ctx) => {
      const roomId = ctx.data.roomId as string | undefined;
      if (roomId) {
        void ctx.publish(`room:${roomId}`, NewMessage, {
          roomId,
          userId: ctx.clientId,
          text: "Left room",
          timestamp: Date.now(),
        });
      }
    });
}
```

### Composing at the Application Level

```typescript
// app.ts — Compose all features
import { createRouter } from "@ws-kit/zod";
import { createChatRouter } from "./features/chat/router";
import { createPresenceRouter } from "./features/presence/router";
import { createNotificationsRouter } from "./features/notifications/router";

type AppData = {
  userId?: string;
  roomId?: string;
  status?: "online" | "away";
};

export function createAppRouter() {
  return createRouter<AppData>()
    .use(async (ctx, next) => {
      // Global middleware: auth, logging, etc.
      console.log(`[${ctx.type}] from ${ctx.clientId}`);
      await next();
    })
    .merge(createChatRouter<AppData>())
    .merge(createPresenceRouter<AppData>())
    .merge(createNotificationsRouter<AppData>())
    .onOpen((ctx) => {
      console.log(`Client connected: ${ctx.clientId}`);
    })
    .onClose((ctx) => {
      console.log(`Client disconnected: ${ctx.clientId}`);
    });
}

// Server integration (e.g., with @ws-kit/bun)
import { serve } from "@ws-kit/bun";

const appRouter = createAppRouter();

serve(appRouter, {
  port: 3000,
  authenticate: async (req) => {
    const userId = extractUserIdFromRequest(req);
    return { userId };
  },
});
```

## Pattern: Conditional Sub-Routers

When features are optional, conditionally merge them:

```typescript
export function createAppRouter(options: { enableNotifications?: boolean }) {
  let router = createRouter<AppData>()
    .merge(createChatRouter<AppData>())
    .merge(createPresenceRouter<AppData>());

  if (options.enableNotifications) {
    router = router.merge(createNotificationsRouter<AppData>());
  }

  return router;
}
```

## Pattern: Feature Flags with Routers

Combine with feature flags for A/B testing or gradual rollout:

```typescript
export async function createAppRouter(featureFlags: FeatureFlags) {
  const mainRouter = createRouter<AppData>().merge(createChatRouter<AppData>());

  // Experimental feature behind flag
  if (featureFlags.isEnabled("streaming-messages")) {
    mainRouter.merge(createStreamingMessagesRouter<AppData>());
  }

  return mainRouter;
}
```

## Pattern: Scoped Sub-Routers (Namespace)

When features need isolation (e.g., admin panel vs user features):

```typescript
// features/admin/router.ts
export function createAdminRouter<TData>() {
  return createRouter<TData>()
    .use(async (ctx, next) => {
      // Admin auth check
      if (ctx.data.role !== "admin") {
        return ctx.error("PERMISSION_DENIED", "Admin only");
      }
      await next();
    })
    .on(AdminCommand, handleAdminCommand)
    .on(AdminQuery, handleAdminQuery);
}

// features/user/router.ts
export function createUserRouter<TData>() {
  return createRouter<TData>().on(UserMessage, handleUserMessage);
}

// app.ts — Compose with different scopes
export function createAppRouter() {
  return createRouter<AppData>()
    .merge(createUserRouter<AppData>())
    .merge(createAdminRouter<AppData>()); // Auth checked per-message
}
```

## Testing Sub-Routers

Each sub-router can be tested in isolation without the full application:

```typescript
import { describe, test, expect } from "bun:test";
import { createChatRouter } from "./chat/router";

describe("Chat Router", () => {
  test("JOIN_ROOM subscribes to topic", async () => {
    const router = createChatRouter<{ userId?: string }>();
    const mockWs = createMockWebSocket({ clientId: "test-123" });

    // Register handler
    let subscribedTopic: string | null = null;
    router.on(JoinRoom, async (ctx) => {
      // Capture subscription
      await ctx.topics.subscribe(`room:${ctx.payload.roomId}`);
      subscribedTopic = `room:${ctx.payload.roomId}`;
    });

    // Simulate message
    const joinMsg = { type: "JOIN_ROOM", payload: { roomId: "lobby" } };
    // ... test implementation
    expect(subscribedTopic).toBe("room:lobby");
  });
});
```

## Handler Conflicts (Last-Write-Wins)

When merging routers that handle the same message type, the **last-write-wins** behavior applies:

```typescript
const router1 = createRouter<AppData>().on(UserUpdate, handler1);

const router2 = createRouter<AppData>().on(UserUpdate, handler2);

const mainRouter = createRouter<AppData>().merge(router1).merge(router2);

// UserUpdate now routes to handler2 (from router2, merged second)
```

**This is intentional**: The merge order is explicit and under your control. When composing feature modules, each module typically handles distinct message types, so conflicts are rare.

**If conflicts occur**, you have two options:

1. **Reorder merges** — Change which router is merged second
2. **Consolidate handlers** — Combine overlapping handlers into a single router

This design keeps the merge API simple and predictable: what you see (the merge order) is what you get (the routing behavior).

---

## Refactoring: From Helpers to Composition

**Before** (helper function pattern):

```typescript
function setupChat(router: Router<AppData>) {
  router.on(JoinRoom, handleJoinRoom);
  router.on(SendMessage, handleSendMessage);
}

const appRouter = createRouter<AppData>();
setupChat(appRouter);
```

**After** (composition pattern):

```typescript
export function createChatRouter<TData>() {
  return createRouter<TData>()
    .on(JoinRoom, handleJoinRoom)
    .on(SendMessage, handleSendMessage);
}

const appRouter = createRouter<AppData>().merge(createChatRouter<AppData>());
```

**Benefits**:

- ✅ Sub-router is testable standalone
- ✅ No need to pass router through function
- ✅ Clearer module boundaries
- ✅ Perfect type inference everywhere

## When to Use Helpers (Still Valid)

Helpers are appropriate for:

1. **Middleware registration** — Global auth, logging, rate-limiting
2. **Setup functions** — Database initialization, cache warmup
3. **Hooks** — Open/close handlers, error handling

```typescript
export function setupGlobalMiddleware(router: Router<AppData>) {
  router.use(async (ctx, next) => {
    // Logging, tracing
    await next();
  });
}

const appRouter = createRouter<AppData>();
setupGlobalMiddleware(appRouter); // ✅ Helper for middleware
appRouter.merge(createChatRouter<AppData>()); // ✅ Composition for features
```

## Size Limits

There's no hard limit on router size, but consider splitting when:

- A single module has >500 lines
- Features have no shared types/handlers
- You want independent testing of distinct concerns

```typescript
// Split large chat module
export function createChatRouter<TData>() {
  return createRouter<TData>()
    .merge(createChatMessagesRouter<TData>())
    .merge(createChatThreadsRouter<TData>())
    .merge(createChatSearchRouter<TData>());
}
```

## Summary

| Goal                 | Pattern                     | Why                                |
| -------------------- | --------------------------- | ---------------------------------- |
| Feature modules      | Export `createXRouter()`    | Composable, testable, typesafe     |
| Global setup         | Helper function             | Cleaner for cross-cutting concerns |
| Conditional features | `if (flag) merge(...)`      | Feature flags, A/B testing         |
| Namespacing          | Separate sub-routers        | Isolation, scope management        |
| Testing              | Test sub-routers standalone | No mock app needed                 |

**Composition is the foundation; helpers are the exception.**
