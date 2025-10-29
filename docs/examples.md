---
outline: deep
---

# Examples

Real-world examples demonstrating common WebSocket patterns with ws-kit.

## Chat Application

A complete chat room implementation with authentication and message history.

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

type AppData = { username?: string };

// Message schemas
const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string().uuid(),
  username: z.string().min(1).max(20),
});

const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string().uuid(),
  text: z.string().min(1).max(500),
});

const LeaveRoom = message("LEAVE_ROOM", {
  roomId: z.string().uuid(),
});

const Welcome = message("WELCOME", {
  message: z.string(),
});

const UserJoined = message("USER_JOINED", {
  username: z.string(),
  userCount: z.number(),
});

const NewMessage = message("NEW_MESSAGE", {
  username: z.string(),
  text: z.string(),
});

const UserLeft = message("USER_LEFT", {
  username: z.string(),
  userCount: z.number(),
});

// Store active users per room
const rooms = new Map<string, Set<string>>();

// Create router
const router = createRouter<AppData>();

router.onOpen((ctx) => {
  console.log(`Client ${ctx.ws.data.clientId} connected`);
  ctx.send(Welcome, { message: "Connected to chat server" });
});

router.on(JoinRoom, (ctx) => {
  const { roomId, username } = ctx.payload;

  // Store username in connection data
  ctx.assignData({ username });

  // Create room if doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  // Add user to room
  rooms.get(roomId)!.add(ctx.ws.data.clientId);

  // Subscribe to room broadcasts
  ctx.subscribe(roomId);

  // Notify room members
  router.publish(roomId, UserJoined, {
    username,
    userCount: rooms.get(roomId)!.size,
  });
});

router.on(SendMessage, (ctx) => {
  const { roomId, text } = ctx.payload;

  // Broadcast message to room
  router.publish(roomId, NewMessage, {
    username: ctx.ws.data.username || "Anonymous",
    text,
  });
});

router.on(LeaveRoom, (ctx) => {
  const { roomId } = ctx.payload;

  // Remove from room
  rooms.get(roomId)?.delete(ctx.ws.data.clientId);

  // Unsubscribe
  ctx.unsubscribe(roomId);

  // Notify others
  router.publish(roomId, UserLeft, {
    username: ctx.ws.data.username || "Anonymous",
    userCount: rooms.get(roomId)?.size || 0,
  });
});

router.onClose((ctx) => {
  // Clean up user from all rooms
  for (const [roomId, users] of rooms) {
    if (users.has(ctx.ws.data.clientId)) {
      users.delete(ctx.ws.data.clientId);
    }
  }
});

// Start server
serve(router, {
  port: 3000,
  authenticate(req) {
    // Optional: validate authentication
    return undefined;
  },
});
```

## Authentication & Authorization

Implementing JWT authentication with role-based access control.

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import jwt from "jsonwebtoken";

enum Role {
  USER = "user",
  ADMIN = "admin",
  MODERATOR = "moderator",
}

// User data type
type AppData = {
  userId: string;
  username: string;
  roles: Role[];
  authenticated: boolean;
};

// Message schemas
const AdminAction = message("ADMIN_ACTION", {
  action: z.enum(["kick", "ban", "mute"]),
  targetUserId: z.string(),
  reason: z.string().optional(),
});

const Kicked = message("KICKED", { reason: z.string() });
const Muted = message("MUTED", { reason: z.string() });

// Create router
const router = createRouter<AppData>();

// Global middleware: require authentication for protected messages
router.use((ctx, next) => {
  if (!ctx.ws.data.authenticated && ctx.type !== "ADMIN_ACTION") {
    return next();
  }
  return next();
});

// Per-route middleware: admin-only access
router.use(AdminAction, (ctx, next) => {
  if (!ctx.ws.data.roles.includes(Role.ADMIN)) {
    ctx.error("AUTH_ERROR", "Admin access required");
    return;
  }
  return next();
});

router.on(AdminAction, (ctx) => {
  const { action, targetUserId } = ctx.payload;
  console.log(`Admin ${ctx.ws.data.userId} executed: ${action}`);

  // Handle admin actions
  switch (action) {
    case "kick":
      router.publish(targetUserId, Kicked, {
        reason: ctx.payload.reason || "No reason provided",
      });
      break;
    case "mute":
      router.publish(targetUserId, Muted, {
        reason: ctx.payload.reason || "No reason provided",
      });
      break;
  }
});

// Start server with JWT authentication
serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return {
        userId: "anon",
        username: "Anonymous",
        roles: [],
        authenticated: false,
      };
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        username: string;
        roles: Role[];
      };

      return {
        ...decoded,
        authenticated: true,
      };
    } catch (err) {
      return {
        userId: "anon",
        username: "Anonymous",
        roles: [],
        authenticated: false,
      };
    }
  },
});
```

## Rate Limiting

Implement per-user rate limiting using middleware.

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const SendMessage = message("SEND_MESSAGE", {
  text: z.string().max(1000),
});

// Rate limiter: 10 messages per 60 seconds per user
const rateLimits = new Map<string, number[]>();

const router = createRouter();

router.use(SendMessage, (ctx, next) => {
  const userId = ctx.ws.data.clientId;
  const now = Date.now();
  const windowStart = now - 60000; // 60 second window

  // Get timestamps for this user
  const timestamps = rateLimits.get(userId) || [];

  // Remove old timestamps
  const recentTimestamps = timestamps.filter((t) => t > windowStart);

  // Check if limit exceeded
  if (recentTimestamps.length >= 10) {
    ctx.error("RATE_LIMIT", "Too many messages. Max 10 per minute.");
    return;
  }

  // Record this message
  recentTimestamps.push(now);
  rateLimits.set(userId, recentTimestamps);

  return next();
});

router.on(SendMessage, (ctx) => {
  console.log(`Message: ${ctx.payload.text}`);
});
```

## Request/Response Pattern

Implement request/response messaging with timeouts.

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

const Calculate = message("CALCULATE", {
  operation: z.enum(["add", "multiply"]),
  a: z.number(),
  b: z.number(),
});

const CalculateResult = message("CALCULATE_RESULT", {
  result: z.number(),
});

const router = createRouter();

router.on(Calculate, (ctx) => {
  const { operation, a, b } = ctx.payload;

  let result: number;
  switch (operation) {
    case "add":
      result = a + b;
      break;
    case "multiply":
      result = a * b;
      break;
  }

  // Send response back to client
  ctx.reply(CalculateResult, { result });
});

serve(router, { port: 3000 });
```

**Client-side:**

```typescript
import { message, wsClient } from "@ws-kit/client/zod";

const Calculate = message("CALCULATE", {
  operation: z.enum(["add", "multiply"]),
  a: z.number(),
  b: z.number(),
});

const CalculateResult = message("CALCULATE_RESULT", {
  result: z.number(),
});

const client = wsClient({ url: "ws://localhost:3000" });
await client.connect();

// Request with timeout
const response = await client.request(Calculate, CalculateResult, {
  timeoutMs: 5000,
});

console.log(`5 + 3 = ${response.payload.result}`);
```

## Type-Safe Error Handling

Proper error handling with type-safe error codes.

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const LoginMessage = message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

const router = createRouter();

router.on(LoginMessage, async (ctx) => {
  const { username, password } = ctx.payload;

  try {
    // Validate credentials
    const user = await validateUser(username, password);

    if (!user) {
      ctx.error("AUTH_ERROR", "Invalid credentials");
      return;
    }

    ctx.assignData({ userId: user.id, username: user.username });
  } catch (error) {
    console.error("Login error:", error);
    ctx.error("INTERNAL_ERROR", "Login failed");
  }
});
```

## Discriminated Unions

Use discriminated unions for flexible message handling.

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const PingMessage = message("PING");
const PongMessage = message("PONG", { latency: z.number() });
const ChatMessage = message("CHAT", { text: z.string() });

// Create a union for type narrowing
const AllMessages = z.discriminatedUnion("type", [
  PingMessage,
  PongMessage,
  ChatMessage,
]);

const router = createRouter();

// Each handler is automatically typed
router.on(PingMessage, (ctx) => {
  // ctx.type === "PING" (narrowed)
  console.log("Received ping");
});

router.on(ChatMessage, (ctx) => {
  // ctx.payload.text is typed as string
  console.log(`Chat: ${ctx.payload.text}`);
});
```
