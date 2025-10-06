---
outline: deep
---

# Examples

Real-world examples demonstrating common WebSocket patterns with Bun WebSocket Router.

## Chat Application

A complete chat room implementation with authentication and message history.

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { publish } from "bun-ws-router/zod/publish";

// Create factory
const { messageSchema, ErrorMessage } = createMessageSchema(z);

// Message schemas
const JoinRoomMessage = messageSchema("JOIN_ROOM", {
  roomId: z.uuid(),
  username: z.string().min(1).max(20),
});

const SendMessageMessage = messageSchema("SEND_MESSAGE", {
  roomId: z.uuid(),
  text: z.string().min(1).max(500),
});

const LeaveRoomMessage = messageSchema("LEAVE_ROOM", {
  roomId: z.uuid(),
});

const WelcomeMessage = messageSchema("WELCOME", {
  message: z.string(),
});

const UserJoinedMessage = messageSchema("USER_JOINED", {
  username: z.string(),
  userCount: z.number(),
});

const MessageSchema = messageSchema("MESSAGE", {
  username: z.string(),
  text: z.string(),
});

const UserLeftMessage = messageSchema("USER_LEFT", {
  username: z.string(),
  userCount: z.number(),
});

const UserDisconnectedMessage = messageSchema("USER_DISCONNECTED", {
  userCount: z.number(),
});

// Store active users per room
const rooms = new Map<string, Set<string>>();

// Create router
const router = new WebSocketRouter<{ username?: string }>()
  .onOpen((ctx) => {
    console.log(`Client ${ctx.ws.data.clientId} connected`);

    ctx.send(WelcomeMessage, {
      message: "Connected to chat server",
    });
  })

  .onMessage(JoinRoomMessage, (ctx) => {
    const { roomId, username } = ctx.payload;

    // Store username in custom data
    ctx.ws.data.username = username;

    // Create room if doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    // Add user to room
    rooms.get(roomId)!.add(ctx.ws.data.clientId);

    // Subscribe to room updates
    ctx.ws.subscribe(`room:${roomId}`);

    // Notify room members
    publish(ctx.ws, `room:${roomId}`, UserJoinedMessage, {
      username,
      userCount: rooms.get(roomId)!.size,
    });
  })

  .onMessage(SendMessageMessage, (ctx) => {
    const { roomId, text } = ctx.payload;

    // Check if user is in room
    if (!rooms.get(roomId)?.has(ctx.ws.data.clientId)) {
      ctx.send(ErrorMessage, {
        code: "AUTHORIZATION_FAILED",
        message: "You must join the room first",
      });
      return;
    }

    // Broadcast message to room
    publish(ctx.ws, `room:${roomId}`, MessageSchema, {
      username: ctx.ws.data.username || "Anonymous",
      text,
    });
  })

  .onMessage(LeaveRoomMessage, (ctx) => {
    const { roomId } = ctx.payload;

    // Remove from room
    rooms.get(roomId)?.delete(ctx.ws.data.clientId);

    // Unsubscribe
    ctx.ws.unsubscribe(`room:${roomId}`);

    // Notify others
    publish(ctx.ws, `room:${roomId}`, UserLeftMessage, {
      username: ctx.ws.data.username || "Anonymous",
      userCount: rooms.get(roomId)?.size || 0,
    });
  })

  .onClose((ctx) => {
    // Clean up user from all rooms
    for (const [roomId, users] of rooms) {
      if (users.has(ctx.ws.data.clientId)) {
        users.delete(ctx.ws.data.clientId);

        publish(ctx.ws, `room:${roomId}`, UserDisconnectedMessage, {
          userCount: users.size,
        });
      }
    }
  });

// Start server
Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (req.headers.get("upgrade") === "websocket") {
      return router.upgrade(req, { server });
    }
    return new Response("WebSocket server");
  },
  websocket: router.websocket,
});
```

## Authentication & Authorization

Implementing JWT authentication with role-based access control.

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import jwt from "jsonwebtoken";

// Create factory
const { messageSchema, ErrorMessage, ErrorCode } = createMessageSchema(z);

// User roles
enum Role {
  USER = "user",
  ADMIN = "admin",
  MODERATOR = "moderator",
}

// Message schemas
const AuthMessage = messageSchema("AUTH", {
  token: z.string(),
});

const AdminActionMessage = messageSchema("ADMIN_ACTION", {
  action: z.enum(["kick", "ban", "mute"]),
  targetUserId: z.string(),
  reason: z.string().optional(),
});

const KickedMessage = messageSchema("KICKED", { reason: z.string() });
const MutedMessage = messageSchema("MUTED", { reason: z.string() });

// User data interface
interface UserData {
  userId: string;
  username: string;
  roles: Role[];
  authenticated: boolean;
}

// Create router
const router = new WebSocketRouter<UserData>()
  .onOpen((ctx) => {
    // Initialize as unauthenticated
    ctx.ws.data.userId = "";
    ctx.ws.data.username = "";
    ctx.ws.data.roles = [];
    ctx.ws.data.authenticated = false;

    // Give client time to authenticate
    setTimeout(() => {
      if (!ctx.ws.data.authenticated) {
        ctx.ws.close(1008, "Authentication required");
      }
    }, 5000);
  })

  .onMessage(AuthMessage, async (ctx) => {
    try {
      // Verify JWT token
      const decoded = jwt.verify(
        ctx.payload.token,
        process.env.JWT_SECRET!,
      ) as any;

      // Store user data in connection
      ctx.ws.data.userId = decoded.userId;
      ctx.ws.data.username = decoded.username;
      ctx.ws.data.roles = decoded.roles || [Role.USER];
      ctx.ws.data.authenticated = true;

      // Subscribe to user-specific channel
      ctx.ws.subscribe(`user:${decoded.userId}`);

      // Subscribe to role channels
      for (const role of decoded.roles) {
        ctx.ws.subscribe(`role:${role}`);
      }

      // Send success
      ctx.send({
        type: "AUTH_SUCCESS",
        payload: {
          userId: decoded.userId,
          username: decoded.username,
          roles: decoded.roles,
        },
      });
    } catch (error) {
      ctx.send(ErrorMessage, {
        code: "AUTHENTICATION_FAILED",
        message: "Invalid token",
      });

      // Close connection
      ctx.ws.close(1008, "Invalid token");
    }
  })

  .onMessage(AdminActionMessage, (ctx) => {
    // Check authentication
    if (!ctx.ws.data.authenticated) {
      ctx.send(ErrorMessage, {
        code: "AUTHENTICATION_FAILED",
        message: "Not authenticated",
      });
      return;
    }

    // Check authorization
    if (!ctx.ws.data.roles?.includes(Role.ADMIN)) {
      ctx.send(ErrorMessage, {
        code: "AUTHORIZATION_FAILED",
        message: "Admin access required",
      });
      return;
    }

    // Perform admin action
    const { action, targetUserId, reason } = ctx.payload;

    switch (action) {
      case "kick":
        // Send kick message to target user
        publish(ctx.ws, `user:${targetUserId}`, KickedMessage, {
          reason: reason || "No reason provided",
        });
        break;

      case "ban":
        // Add to ban list (implement your logic)
        console.log(`Banning user ${targetUserId}`);
        break;

      case "mute":
        // Send mute notification
        publish(ctx.ws, `user:${targetUserId}`, MutedMessage, {
          reason: reason || "No reason provided",
        });
        break;
    }
  });
```

## Real-time Notifications

Push notifications system with topic subscriptions.

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { publish } from "bun-ws-router/zod/publish";

const { messageSchema } = createMessageSchema(z);

// Notification types
enum NotificationType {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  SUCCESS = "success",
}

// Message schemas
const SubscribeMessage = messageSchema("SUBSCRIBE", {
  topics: z.array(z.string()).min(1),
});

const UnsubscribeMessage = messageSchema("UNSUBSCRIBE", {
  topics: z.array(z.string()).min(1),
});

const NotificationMessage = messageSchema("NOTIFICATION", {
  id: z.uuid(),
  type: z.nativeEnum(NotificationType),
  title: z.string(),
  message: z.string(),
  data: z.record(z.unknown()).optional(),
  timestamp: z.number(),
});

// Track subscriptions
const userSubscriptions = new Map<string, Set<string>>();

const router = new WebSocketRouter()
  .onOpen((ctx) => {
    // Initialize user subscriptions
    userSubscriptions.set(ctx.ws.data.clientId, new Set());

    // Subscribe to personal notifications
    ctx.ws.subscribe(`user:${ctx.ws.data.clientId}`);
  })

  .onMessage(SubscribeMessage, (ctx) => {
    const { topics } = ctx.payload;
    const subs = userSubscriptions.get(ctx.ws.data.clientId)!;

    // Subscribe to topics
    for (const topic of topics) {
      ctx.ws.subscribe(`topic:${topic}`);
      subs.add(topic);
    }
  })

  .onMessage(UnsubscribeMessage, (ctx) => {
    const { topics } = ctx.payload;
    const subs = userSubscriptions.get(ctx.ws.data.clientId)!;

    // Unsubscribe from topics
    for (const topic of topics) {
      ctx.ws.unsubscribe(`topic:${topic}`);
      subs.delete(topic);
    }
  })

  .onClose((ctx) => {
    // Clean up subscriptions
    userSubscriptions.delete(ctx.ws.data.clientId);
  });

// HTTP endpoint to send notifications
const server = Bun.serve({
  port: 3000,

  async fetch(req) {
    const url = new URL(req.url);

    // REST API to send notifications
    if (url.pathname === "/api/notify" && req.method === "POST") {
      const body = await req.json();

      const notification = {
        id: crypto.randomUUID(),
        type: body.type || NotificationType.INFO,
        title: body.title,
        message: body.message,
        data: body.data,
        timestamp: Date.now(),
      };

      // Broadcast to topic using server.publish
      // Note: publish() is for use within handlers with ctx.ws
      // For server-level broadcasting, use server.publish() directly
      if (body.topic) {
        server.publish(
          `topic:${body.topic}`,
          JSON.stringify({
            type: "NOTIFICATION",
            payload: notification,
            meta: { timestamp: Date.now() },
          }),
        );
      }

      // Send to specific user
      if (body.userId) {
        server.publish(
          `user:${body.userId}`,
          JSON.stringify({
            type: "NOTIFICATION",
            payload: notification,
            meta: { timestamp: Date.now() },
          }),
        );
      }

      return Response.json({ success: true, id: notification.id });
    }

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      return router.upgrade(req, { server });
    }

    return new Response("Notification Server");
  },

  websocket: router.websocket,
});

console.log("Notification server running on http://localhost:3000");
```

## Rate Limiting

Implementing rate limiting to prevent spam.

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { publish } from "bun-ws-router/zod/publish";

const { messageSchema, ErrorMessage } = createMessageSchema(z);

// Rate limiter class
class RateLimiter {
  private requests = new Map<string, number[]>();

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  check(clientId: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(clientId) || [];

    // Remove old requests
    const validRequests = requests.filter((time) => now - time < this.windowMs);

    // Check limit
    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(clientId, validRequests);

    return true;
  }

  reset(clientId: string) {
    this.requests.delete(clientId);
  }
}

// Create rate limiters
const messageLimiter = new RateLimiter(10, 60000); // 10 per minute
const joinLimiter = new RateLimiter(5, 300000); // 5 per 5 minutes

// Message schema
const ChatMessage = messageSchema("CHAT_MESSAGE", {
  text: z.string().min(1).max(200),
});

const JoinChannelMessage = messageSchema("JOIN_CHANNEL", {
  channel: z.string(),
});

// Router with rate limiting
const router = new WebSocketRouter()
  .onMessage(ChatMessage, (ctx) => {
    // Check rate limit
    if (!messageLimiter.check(ctx.ws.data.clientId)) {
      ctx.send(ErrorMessage, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many messages. Please slow down.",
      });
      return;
    }

    // Process message
    publish(ctx.ws, "global", ChatMessage, ctx.payload);
  })

  .onMessage(JoinChannelMessage, (ctx) => {
    // Check join rate limit
    if (!joinLimiter.check(ctx.ws.data.clientId)) {
      ctx.send(ErrorMessage, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many join requests.",
      });
      return;
    }

    // Join channel
    ctx.ws.subscribe(ctx.payload.channel);
  })

  .onClose((ctx) => {
    // Clean up rate limit data
    messageLimiter.reset(ctx.ws.data.clientId);
    joinLimiter.reset(ctx.ws.data.clientId);
  });
```
