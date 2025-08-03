---
outline: deep
---

# Examples

Real-world examples demonstrating common WebSocket patterns with Bun WebSocket Router.

## Chat Application

A complete chat room implementation with authentication and message history.

```typescript
import { WebSocketRouter, messageSchema, ErrorCode } from "bun-ws-router";
import { z } from "zod";

// Message schemas
const JoinRoomMessage = messageSchema(
  "JOIN_ROOM",
  z.object({
    roomId: z.uuid(),
    username: z.string().min(1).max(20),
  }),
);

const SendMessageMessage = messageSchema(
  "SEND_MESSAGE",
  z.object({
    roomId: z.uuid(),
    text: z.string().min(1).max(500),
  }),
);

const LeaveRoomMessage = messageSchema(
  "LEAVE_ROOM",
  z.object({
    roomId: z.uuid(),
  }),
);

// Store active users per room
const rooms = new Map<string, Set<string>>();

// Create router
const router = new WebSocketRouter<{ username?: string }>()
  .onOpen((ws) => {
    console.log(`Client ${ws.data.clientId} connected`);

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: "WELCOME",
        meta: {
          clientId: ws.data.clientId,
          timestamp: Date.now(),
        },
        payload: {
          message: "Connected to chat server",
        },
      }),
    );
  })

  .onMessage(JoinRoomMessage, (ctx) => {
    const { roomId, username } = ctx.payload;

    // Store username
    ctx.setData({ username });

    // Create room if doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    // Add user to room
    rooms.get(roomId)!.add(ctx.clientId);

    // Subscribe to room updates
    ctx.subscribe(`room:${roomId}`);

    // Notify room members
    ctx.publish(`room:${roomId}`, {
      type: "USER_JOINED",
      meta: {
        clientId: ctx.clientId,
        timestamp: Date.now(),
      },
      payload: {
        username,
        userCount: rooms.get(roomId)!.size,
      },
    });

    // Confirm join
    ctx.send({
      type: "JOIN_SUCCESS",
      payload: {
        roomId,
        userCount: rooms.get(roomId)!.size,
      },
    });
  })

  .onMessage(SendMessageMessage, (ctx) => {
    const { roomId, text } = ctx.payload;
    const userData = ctx.getData<{ username?: string }>();

    // Check if user is in room
    if (!rooms.get(roomId)?.has(ctx.clientId)) {
      ctx.send({
        type: "ERROR",
        payload: {
          code: ErrorCode.FORBIDDEN,
          message: "You must join the room first",
        },
      });
      return;
    }

    // Broadcast message to room
    ctx.publish(`room:${roomId}`, {
      type: "MESSAGE",
      meta: {
        clientId: ctx.clientId,
        timestamp: Date.now(),
      },
      payload: {
        username: userData.username || "Anonymous",
        text,
      },
    });
  })

  .onMessage(LeaveRoomMessage, (ctx) => {
    const { roomId } = ctx.payload;
    const userData = ctx.getData<{ username?: string }>();

    // Remove from room
    rooms.get(roomId)?.delete(ctx.clientId);

    // Unsubscribe
    ctx.unsubscribe(`room:${roomId}`);

    // Notify others
    ctx.publish(`room:${roomId}`, {
      type: "USER_LEFT",
      payload: {
        username: userData.username || "Anonymous",
        userCount: rooms.get(roomId)?.size || 0,
      },
    });
  })

  .onClose((ws) => {
    // Clean up user from all rooms
    for (const [roomId, users] of rooms) {
      if (users.has(ws.data.clientId)) {
        users.delete(ws.data.clientId);

        // Notify room if user was in it
        ws.publish(
          `room:${roomId}`,
          JSON.stringify({
            type: "USER_DISCONNECTED",
            payload: {
              userCount: users.size,
            },
          }),
        );
      }
    }
  });

// Start server
Bun.serve({
  port: 3000,
  fetch(req) {
    if (req.headers.get("upgrade") === "websocket") {
      return this.upgrade(req)
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 426 });
    }
    return new Response("WebSocket server");
  },
  websocket: router.handlers(),
});
```

## Authentication & Authorization

Implementing JWT authentication with role-based access control.

```typescript
import { WebSocketRouter, messageSchema, ErrorCode } from "bun-ws-router";
import { z } from "zod";
import jwt from "jsonwebtoken";

// User roles
enum Role {
  USER = "user",
  ADMIN = "admin",
  MODERATOR = "moderator",
}

// Message schemas
const AuthMessage = messageSchema(
  "AUTH",
  z.object({
    token: z.string(),
  }),
);

const AdminActionMessage = messageSchema(
  "ADMIN_ACTION",
  z.object({
    action: z.enum(["kick", "ban", "mute"]),
    targetUserId: z.string(),
    reason: z.string().optional(),
  }),
);

// User data interface
interface UserData {
  userId: string;
  username: string;
  roles: Role[];
  authenticated: boolean;
}

// Create router
const router = new WebSocketRouter<UserData>()
  .onOpen((ws) => {
    // Initialize as unauthenticated
    ws.data.user = {
      userId: "",
      username: "",
      roles: [],
      authenticated: false,
    };

    // Give client time to authenticate
    setTimeout(() => {
      if (!ws.data.user?.authenticated) {
        ws.close(1008, "Authentication required");
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

      // Update user data
      ctx.setData({
        userId: decoded.userId,
        username: decoded.username,
        roles: decoded.roles || [Role.USER],
        authenticated: true,
      });

      // Subscribe to user-specific channel
      ctx.subscribe(`user:${decoded.userId}`);

      // Subscribe to role channels
      for (const role of decoded.roles) {
        ctx.subscribe(`role:${role}`);
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
      ctx.send({
        type: "ERROR",
        payload: {
          code: ErrorCode.UNAUTHORIZED,
          message: "Invalid token",
        },
      });

      // Close connection
      ctx.ws.close(1008, "Invalid token");
    }
  })

  .onMessage(AdminActionMessage, (ctx) => {
    const userData = ctx.getData<UserData>();

    // Check authentication
    if (!userData.authenticated) {
      ctx.send({
        type: "ERROR",
        payload: {
          code: ErrorCode.UNAUTHORIZED,
          message: "Not authenticated",
        },
      });
      return;
    }

    // Check authorization
    if (!userData.roles.includes(Role.ADMIN)) {
      ctx.send({
        type: "ERROR",
        payload: {
          code: ErrorCode.FORBIDDEN,
          message: "Admin access required",
        },
      });
      return;
    }

    // Perform admin action
    const { action, targetUserId, reason } = ctx.payload;

    switch (action) {
      case "kick":
        // Send kick message to target user
        ctx.publish(`user:${targetUserId}`, {
          type: "KICKED",
          payload: { reason },
        });
        break;

      case "ban":
        // Add to ban list (implement your logic)
        console.log(`Banning user ${targetUserId}`);
        break;

      case "mute":
        // Send mute notification
        ctx.publish(`user:${targetUserId}`, {
          type: "MUTED",
          payload: { reason },
        });
        break;
    }

    // Confirm action
    ctx.send({
      type: "ADMIN_ACTION_SUCCESS",
      payload: {
        action,
        targetUserId,
      },
    });
  });

// Middleware to check auth on all messages
router.onError((ws, error) => {
  console.error(`Error for client ${ws.data.clientId}:`, error);

  ws.send(
    JSON.stringify({
      type: "ERROR",
      payload: {
        code: ErrorCode.INTERNAL_ERROR,
        message: "An error occurred",
      },
    }),
  );
});
```

## Real-time Notifications

Push notifications system with topic subscriptions.

```typescript
import { WebSocketRouter, messageSchema, publish } from "bun-ws-router";
import { z } from "zod";

// Notification types
enum NotificationType {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  SUCCESS = "success",
}

// Message schemas
const SubscribeMessage = messageSchema(
  "SUBSCRIBE",
  z.object({
    topics: z.array(z.string()).min(1),
  }),
);

const UnsubscribeMessage = messageSchema(
  "UNSUBSCRIBE",
  z.object({
    topics: z.array(z.string()).min(1),
  }),
);

const NotificationMessage = messageSchema(
  "NOTIFICATION",
  z.object({
    id: z.uuid(),
    type: z.nativeEnum(NotificationType),
    title: z.string(),
    message: z.string(),
    data: z.record(z.unknown()).optional(),
    timestamp: z.number(),
  }),
);

// Track subscriptions
const userSubscriptions = new Map<string, Set<string>>();

const router = new WebSocketRouter()
  .onOpen((ws) => {
    // Initialize user subscriptions
    userSubscriptions.set(ws.data.clientId, new Set());

    // Subscribe to personal notifications
    ws.subscribe(`user:${ws.data.clientId}`);
  })

  .onMessage(SubscribeMessage, (ctx) => {
    const { topics } = ctx.payload;
    const subs = userSubscriptions.get(ctx.clientId)!;

    // Subscribe to topics
    for (const topic of topics) {
      ctx.subscribe(`topic:${topic}`);
      subs.add(topic);
    }

    ctx.send({
      type: "SUBSCRIBE_SUCCESS",
      payload: { topics },
    });
  })

  .onMessage(UnsubscribeMessage, (ctx) => {
    const { topics } = ctx.payload;
    const subs = userSubscriptions.get(ctx.clientId)!;

    // Unsubscribe from topics
    for (const topic of topics) {
      ctx.unsubscribe(`topic:${topic}`);
      subs.delete(topic);
    }

    ctx.send({
      type: "UNSUBSCRIBE_SUCCESS",
      payload: { topics },
    });
  })

  .onClose((ws) => {
    // Clean up subscriptions
    userSubscriptions.delete(ws.data.clientId);
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

      // Broadcast to topic
      if (body.topic) {
        publish(
          server,
          `topic:${body.topic}`,
          NotificationMessage,
          notification,
        );
      }

      // Send to specific user
      if (body.userId) {
        publish(
          server,
          `user:${body.userId}`,
          NotificationMessage,
          notification,
        );
      }

      return Response.json({ success: true, id: notification.id });
    }

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      return server.upgrade(req)
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 426 });
    }

    return new Response("Notification Server");
  },

  websocket: router.handlers(),
});

console.log("Notification server running on http://localhost:3000");
```

## Rate Limiting

Implementing rate limiting to prevent spam.

```typescript
import { WebSocketRouter, messageSchema, ErrorCode } from "bun-ws-router";
import { z } from "zod";

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
const ChatMessage = messageSchema(
  "CHAT_MESSAGE",
  z.object({
    text: z.string().min(1).max(200),
  }),
);

const JoinChannelMessage = messageSchema(
  "JOIN_CHANNEL",
  z.object({
    channel: z.string(),
  }),
);

// Router with rate limiting
const router = new WebSocketRouter()
  .onMessage(ChatMessage, (ctx) => {
    // Check rate limit
    if (!messageLimiter.check(ctx.clientId)) {
      ctx.send({
        type: "ERROR",
        payload: {
          code: ErrorCode.RATE_LIMIT,
          message: "Too many messages. Please slow down.",
        },
      });
      return;
    }

    // Process message
    ctx.publish("global", ChatMessage, ctx.payload);
  })

  .onMessage(JoinChannelMessage, (ctx) => {
    // Check join rate limit
    if (!joinLimiter.check(ctx.clientId)) {
      ctx.send({
        type: "ERROR",
        payload: {
          code: ErrorCode.RATE_LIMIT,
          message: "Too many join requests.",
        },
      });
      return;
    }

    // Join channel
    ctx.subscribe(ctx.payload.channel);
    ctx.send({
      type: "JOIN_SUCCESS",
      payload: { channel: ctx.payload.channel },
    });
  })

  .onClose((ws) => {
    // Clean up rate limit data
    messageLimiter.reset(ws.data.clientId);
    joinLimiter.reset(ws.data.clientId);
  });
```

## Next Steps

- Learn [Advanced Usage](/advanced-usage) patterns
- Read [Deployment](/deployment) best practices
- Explore the [API Reference](/api-reference)
