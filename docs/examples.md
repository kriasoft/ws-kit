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
      ctx.send(ErrorMessage, {
        code: "AUTHORIZATION_FAILED",
        message: "You must join the room first",
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
  fetch(req, server) {
    if (req.headers.get("upgrade") === "websocket") {
      return server.upgrade(req)
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 426 });
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
const AuthMessage = messageSchema(
  "AUTH",
  {
    token: z.string(),
  },
);

const AdminActionMessage = messageSchema(
  "ADMIN_ACTION",
  {
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
      ctx.send(ErrorMessage, {
        code: "AUTHENTICATION_FAILED",
        message: "Invalid token",
      });

      // Close connection
      ctx.ws.close(1008, "Invalid token");
    }
  })

  .onMessage(AdminActionMessage, (ctx) => {
    const userData = ctx.getData<UserData>();

    // Check authentication
    if (!userData.authenticated) {
      ctx.send(ErrorMessage, {
        code: "AUTHENTICATION_FAILED",
        message: "Not authenticated",
      });
      return;
    }

    // Check authorization
    if (!userData.roles.includes(Role.ADMIN)) {
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

  // Use raw send for error handler since we don't have ctx
  ws.send(
    JSON.stringify({
      type: "ERROR",
      payload: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An error occurred",
      },
    }),
  );
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
const SubscribeMessage = messageSchema(
  "SUBSCRIBE",
  {
    topics: z.array(z.string()).min(1),
  },
);

const UnsubscribeMessage = messageSchema(
  "UNSUBSCRIBE",
  {
    topics: z.array(z.string()).min(1),
  },
);

const NotificationMessage = messageSchema(
  "NOTIFICATION",
  {
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

  websocket: router.websocket,
});

console.log("Notification server running on http://localhost:3000");
```

## Rate Limiting

Implementing rate limiting to prevent spam.

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

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
    if (!messageLimiter.check(ctx.clientId)) {
      ctx.send(ErrorMessage, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many messages. Please slow down.",
      });
      return;
    }

    // Process message
    ctx.publish("global", ChatMessage, ctx.payload);
  })

  .onMessage(JoinChannelMessage, (ctx) => {
    // Check join rate limit
    if (!joinLimiter.check(ctx.clientId)) {
      ctx.send(ErrorMessage, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many join requests.",
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

## Client-Side Example

Using `createMessage` for type-safe WebSocket communication on the client.

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema, createMessage } = createMessageSchema(z);

// Share these schemas between client and server
const ConnectionMessage = messageSchema(
  "CONNECTION",
  {
    token: z.string(),
  },
);

const ChatMessage = messageSchema(
  "CHAT_MESSAGE",
  {
    roomId: z.string(),
    text: z.string().min(1).max(500),
  }),
);

const TypingMessage = messageSchema(
  "TYPING",
  {
    roomId: z.string(),
    isTyping: z.boolean(),
  }),
);

// Client implementation
class ChatClient {
  private ws: WebSocket;
  private reconnectTimer?: Timer;
  private messageQueue: Array<{ schema: any; payload: any; meta?: any }> = [];

  constructor(
    private url: string,
    private token: string,
  ) {
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("Connected to chat server");

      // Authenticate on connection
      const authMsg = createMessage(ConnectionMessage, { token: this.token });
      if (authMsg.success) {
        this.ws.send(JSON.stringify(authMsg.data));
      }

      // Send any queued messages
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("Failed to parse message:", error);
      }
    };

    this.ws.onclose = () => {
      console.log("Disconnected from server");
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case "CHAT_MESSAGE":
        this.onChatMessage?.(message.payload);
        break;
      case "TYPING":
        this.onTypingUpdate?.(message.payload);
        break;
      case "ERROR":
        this.onError?.(message.payload);
        break;
    }
  }

  sendMessage(roomId: string, text: string) {
    const msg = createMessage(
      ChatMessage,
      { roomId, text },
      { correlationId: crypto.randomUUID() },
    );

    if (!msg.success) {
      console.error("Invalid message:", msg.error);
      return false;
    }

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg.data));
      return true;
    } else {
      // Queue message for later
      this.messageQueue.push({
        schema: ChatMessage,
        payload: { roomId, text },
        meta: { correlationId: crypto.randomUUID() },
      });
      return false;
    }
  }

  setTyping(roomId: string, isTyping: boolean) {
    const msg = createMessage(TypingMessage, { roomId, isTyping });

    if (msg.success && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg.data));
    }
  }

  private flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const { schema, payload, meta } = this.messageQueue.shift()!;
      const msg = createMessage(schema, payload, meta);

      if (msg.success) {
        this.ws.send(JSON.stringify(msg.data));
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 5000);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws.close();
  }

  // Event handlers (to be set by consumer)
  onChatMessage?: (payload: any) => void;
  onTypingUpdate?: (payload: any) => void;
  onError?: (error: any) => void;
}

// Usage
const client = new ChatClient("ws://localhost:3000/ws", "auth-token");

client.onChatMessage = (message) => {
  console.log("New message:", message);
};

client.onError = (error) => {
  console.error("Chat error:", error);
};

// Send a message
client.sendMessage("general", "Hello everyone!");

// Show typing indicator
client.setTyping("general", true);
```
