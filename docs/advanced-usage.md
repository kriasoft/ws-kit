# Advanced Usage

Advanced patterns for building sophisticated WebSocket applications with Bun WebSocket Router.

## Discriminated Unions

With the factory pattern (v0.4.0+), you can now use Zod's discriminated unions to create type-safe message handlers:

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);

// Define individual message schemas
const TextMessage = messageSchema("TEXT", {
  content: z.string(),
  channelId: z.string(),
});

const ImageMessage = messageSchema("IMAGE", {
  url: z.url(),
  channelId: z.string(),
  width: z.number(),
  height: z.number(),
});

const VideoMessage = messageSchema("VIDEO", {
  url: z.url(),
  channelId: z.string(),
  duration: z.number(),
});

// Create a discriminated union
const MediaMessage = z.discriminatedUnion("type", [
  TextMessage,
  ImageMessage,
  VideoMessage,
]);

// Type-safe message handling
function handleMediaMessage(message: z.infer<typeof MediaMessage>) {
  switch (message.type) {
    case "TEXT":
      // TypeScript knows payload has { content, channelId }
      console.log("Text:", message.payload.content);
      break;

    case "IMAGE":
      // TypeScript knows payload has { url, channelId, width, height }
      console.log("Image:", message.payload.url, message.payload.width);
      break;

    case "VIDEO":
      // TypeScript knows payload has { url, channelId, duration }
      console.log("Video:", message.payload.url, message.payload.duration);
      break;
  }
}

// Use in router - register individual handlers
router
  .onMessage(TextMessage, (ctx) => {
    // Handle text specifically
  })
  .onMessage(ImageMessage, (ctx) => {
    // Handle images specifically
  })
  .onMessage(VideoMessage, (ctx) => {
    // Handle videos specifically
  });
```

This pattern is useful for protocol versioning, command/query separation, event sourcing, and complex state machines.

## Router Composition

Compose multiple routers to organize your application into modules:

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);

// Authentication router
const authRouter = new WebSocketRouter()
  .onMessage(LoginMessage, handleLogin)
  .onMessage(LogoutMessage, handleLogout)
  .onMessage(RefreshTokenMessage, handleRefresh);

// Chat router
const chatRouter = new WebSocketRouter()
  .onMessage(SendMessageMessage, handleSendMessage)
  .onMessage(EditMessageMessage, handleEditMessage)
  .onMessage(DeleteMessageMessage, handleDeleteMessage);

// Admin router
const adminRouter = new WebSocketRouter()
  .onMessage(KickUserMessage, handleKickUser)
  .onMessage(BanUserMessage, handleBanUser)
  .onMessage(MuteUserMessage, handleMuteUser);

// Main router combining all
const mainRouter = new WebSocketRouter()
  .addRoutes(authRouter)
  .addRoutes(chatRouter)
  .addRoutes(adminRouter)
  .onOpen(handleConnection)
  .onClose(handleDisconnection);
```

::: tip
For complex applications, consider organizing routers by feature domain (auth, chat, notifications) rather than by message type.
:::

## Authentication Middleware

Create reusable authentication checks:

```typescript
import { publish } from "bun-ws-router/zod/publish";

// Authentication check helper
function requireAuth<T>(
  handler: (ctx: MessageContext<T>) => void | Promise<void>,
): (ctx: MessageContext<T>) => void | Promise<void> {
  return async (ctx) => {
    if (!ctx.ws.data.authenticated) {
      ctx.send(ErrorMessage, {
        code: "AUTHENTICATION_FAILED",
        message: "Authentication required",
      });
      return;
    }
    await handler(ctx);
  };
}

// Use with router
router.onMessage(
  ProtectedMessage,
  requireAuth((ctx) => {
    // Handler only runs if authenticated
    publish(ctx.ws, "updates", UpdateMessage, ctx.payload);
  }),
);
```

## Custom Connection Data

Store and access application-specific data per connection:

```typescript
interface UserData {
  userId: string;
  username: string;
  authenticated: boolean;
  joinedRooms: Set<string>;
}

const router = new WebSocketRouter<UserData>();

router
  .onOpen((ctx) => {
    // Initialize connection data
    ctx.ws.data.authenticated = false;
    ctx.ws.data.joinedRooms = new Set();
  })
  .onMessage(AuthMessage, (ctx) => {
    // Set authenticated user data
    ctx.ws.data.userId = "user-123";
    ctx.ws.data.username = "Alice";
    ctx.ws.data.authenticated = true;
  })
  .onMessage(JoinRoomMessage, (ctx) => {
    // Track joined rooms
    ctx.ws.data.joinedRooms.add(ctx.payload.roomId);
    ctx.ws.subscribe(`room:${ctx.payload.roomId}`);
  });
```

## Rate Limiting

Implement per-client rate limiting:

```typescript
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(clientId: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const limit = rateLimits.get(clientId);

  if (!limit || now > limit.resetAt) {
    rateLimits.set(clientId, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (limit.count >= maxPerMinute) {
    return false;
  }

  limit.count++;
  return true;
}

router.onMessage(ChatMessage, (ctx) => {
  if (!checkRateLimit(ctx.ws.data.clientId, 10)) {
    ctx.send(ErrorMessage, {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many messages. Please slow down.",
    });
    return;
  }

  publish(ctx.ws, "chat", ChatMessage, ctx.payload);
});
```
