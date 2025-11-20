---
outline: deep
---

# Examples

Real-world examples demonstrating common WebSocket patterns with WS-Kit.

All examples are located in the [`examples/`](https://github.com/kriasoft/ws-kit/tree/main/examples) directory of the repository.

## Available Examples

### Quick Start

**Location:** [`examples/quick-start/`](https://github.com/kriasoft/ws-kit/tree/main/examples/quick-start)

Simple reference examples for getting started with WS-Kit. Each file demonstrates a specific feature:

- **`schema.ts`** — Define typed message schemas using the `message()` helper
- **`auth-schema.ts`** — Authentication schema with Zod v4 validators (JWT, email, URL, etc.)
- **`chat.ts`** — Chat room router with middleware, message broadcasting, and subscription patterns
- **`error-handling.ts`** — Enhanced error handling with Zod v4 validation and middleware
- **`client-usage.ts`** — Type-safe browser client patterns with `@ws-kit/client/zod`
- **`index.ts`** — Full WebSocket server setup using `serve()` helper with route composition

**Run the example:**

```bash
cd examples/quick-start
bun index.ts
```

### Full-Featured Chat Application

**Location:** [`examples/bun-zod-chat/`](https://github.com/kriasoft/ws-kit/tree/main/examples/bun-zod-chat)

Complete chat application demonstrating production-ready patterns:

- Full Bun.serve() integration with custom HTTP routing
- Type-safe message schemas using `message()` helper
- Room-based pub/sub with typed message publishing
- Connection lifecycle hooks (onOpen, onClose, onError)
- Global and per-route middleware
- Stats endpoint for monitoring

**Run the example:**

```bash
cd examples/bun-zod-chat
bun index.ts
# Open http://localhost:3000 in your browser
```

### Delta Sync for Collaborative Apps

**Location:** [`examples/delta-sync/`](https://github.com/kriasoft/ws-kit/tree/main/examples/delta-sync)

Revision-based state synchronization example perfect for collaborative applications:

- Operation history with ring buffer
- Delta sync (send only changes) vs. snapshot sync
- Optimistic updates on client with server reconciliation
- Heartbeat-based stale connection cleanup
- Bandwidth-efficient state replication

**Files:**

- **`server.ts`** — Server with operation tracking and revision management
- **`client.ts`** — Client-side state management with optimistic updates
- **`schema.ts`** — Message schemas for delta protocol
- **`ring-buffer.ts`** — Circular buffer for operation history

**Run the example:**

```bash
# Terminal 1: Start server
bun examples/delta-sync/server.ts

# Terminal 2: Run client
bun examples/delta-sync/client.ts
```

### Cloudflare Durable Objects Sharding

**Location:** [`examples/cloudflare-sharding/`](https://github.com/kriasoft/ws-kit/tree/main/examples/cloudflare-sharding)

Production-ready example of scaling pub/sub across multiple Durable Object instances by sharding subscriptions based on scope (room/channel).

**Problem:** Cloudflare Durable Objects have a 100-connection limit per instance. Without sharding, you can only support 100 concurrent subscribers per room.

**Solution:** Shard rooms across multiple DO instances using stable hashing.

**Run the example:**

```bash
cd examples/cloudflare-sharding
wrangler deploy
```

### Redis Multi-Instance Deployment

**Location:** [`examples/redis-multi-instance/`](https://github.com/kriasoft/ws-kit/tree/main/examples/redis-multi-instance)

Multi-instance deployment example with Redis PubSub for cross-instance broadcasting:

- Multiple Bun server instances
- Cross-instance message broadcasting via Redis
- Redis pub/sub integration
- Load balancer setup

**Run the example:**

```bash
cd examples/redis-multi-instance
bun index.ts
```

### Type-Safe Browser Client

**Location:** [`examples/typed-client-usage.ts`](https://github.com/kriasoft/ws-kit/tree/main/examples/typed-client-usage.ts)

Advanced client example showing:

- Type-safe browser client with `@ws-kit/client/zod`
- Full message type inference from schemas
- Request/response patterns with timeout
- Message sending with extended metadata

## Common Patterns

The following code examples demonstrate common patterns. For working examples, see the actual files in the [`examples/`](https://github.com/kriasoft/ws-kit/tree/main/examples) directory.

### Chat Application

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
  console.log(`Client ${ctx.clientId} connected`);
  ctx.send(Welcome, { message: "Connected to chat server" });
});

router.on(JoinRoom, async (ctx) => {
  const { roomId, username } = ctx.payload;

  // Store username in connection data
  ctx.assignData({ username });

  // Create room if doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  // Add user to room
  rooms.get(roomId)!.add(ctx.clientId);

  // Subscribe to room broadcasts
  await ctx.topics.subscribe(roomId);

  // Notify room members
  await router.publish(roomId, UserJoined, {
    username,
    userCount: rooms.get(roomId)!.size,
  });
});

router.on(SendMessage, async (ctx) => {
  const { roomId, text } = ctx.payload;

  // Broadcast message to room
  await router.publish(roomId, NewMessage, {
    username: ctx.data.username || "Anonymous",
    text,
  });
});

router.on(LeaveRoom, async (ctx) => {
  const { roomId } = ctx.payload;

  // Remove from room
  rooms.get(roomId)?.delete(ctx.clientId);

  // Unsubscribe
  await ctx.topics.unsubscribe(roomId);

  // Notify others
  await router.publish(roomId, UserLeft, {
    username: ctx.data.username || "Anonymous",
    userCount: rooms.get(roomId)?.size || 0,
  });
});

router.onClose((ctx) => {
  // Clean up user from all rooms
  for (const [roomId, users] of rooms) {
    if (users.has(ctx.clientId)) {
      users.delete(ctx.clientId);
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
  if (!ctx.data.authenticated) {
    ctx.error("UNAUTHENTICATED", "Authentication required");
    return;
  }
  return next();
});

// Per-route middleware: admin-only access
router
  .route(AdminAction)
  .use((ctx, next) => {
    if (!ctx.data.roles.includes(Role.ADMIN)) {
      ctx.error("PERMISSION_DENIED", "Admin access required");
      return;
    }
    return next();
  })
  .on(async (ctx) => {
    const { action, targetUserId } = ctx.payload;
    console.log(`Admin ${ctx.data.userId} executed: ${action}`);

    // Handle admin actions
    switch (action) {
      case "kick":
        await router.publish(targetUserId, Kicked, {
          reason: ctx.payload.reason || "No reason provided",
        });
        break;
      case "mute":
        await router.publish(targetUserId, Muted, {
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

router
  .route(SendMessage)
  .use((ctx, next) => {
    const userId = ctx.clientId;
    const now = Date.now();
    const windowStart = now - 60000; // 60 second window

    // Get timestamps for this user
    const timestamps = rateLimits.get(userId) || [];

    // Remove old timestamps
    const recentTimestamps = timestamps.filter((t) => t > windowStart);

    // Check if limit exceeded
    if (recentTimestamps.length >= 10) {
      ctx.error("RESOURCE_EXHAUSTED", "Too many messages. Max 10 per minute.");
      return;
    }

    // Record this message
    recentTimestamps.push(now);
    rateLimits.set(userId, recentTimestamps);

    return next();
  })
  .on((ctx) => {
    console.log(`Message: ${ctx.payload.text}`);
  });
```

## Request/Response Pattern (RPC)

Use the `rpc()` helper to bind request and response schemas for type-safe request/response pairs.

**Server-side:**

```typescript
import { z, rpc, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define RPC schema - binds request to response type
const Calculate = rpc(
  "CALCULATE",
  {
    operation: z.enum(["add", "multiply"]),
    a: z.number(),
    b: z.number(),
  },
  "CALCULATE_RESULT",
  { result: z.number() },
);

const router = createRouter();

// Use router.rpc() for type-safe RPC handlers
router.rpc(Calculate, (ctx) => {
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

  // Reply with the bound response schema
  ctx.reply(Calculate.response, { result });
});

serve(router, { port: 3000 });
```

**Client-side:**

```typescript
import { z, rpc, wsClient } from "@ws-kit/client/zod";

// Same RPC schema definition (share between client and server)
const Calculate = rpc(
  "CALCULATE",
  {
    operation: z.enum(["add", "multiply"]),
    a: z.number(),
    b: z.number(),
  },
  "CALCULATE_RESULT",
  { result: z.number() },
);

const client = wsClient({ url: "ws://localhost:3000" });
await client.connect();

// Request with auto-detected response type
const response = await client.request(Calculate, {
  operation: "add",
  a: 5,
  b: 3,
});

console.log(`5 + 3 = ${response.payload.result}`);
// response.type === "CALCULATE_RESULT"
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
      ctx.error("UNAUTHENTICATED", "Invalid credentials");
      return;
    }

    ctx.assignData({ userId: user.id, username: user.username });
  } catch (error) {
    console.error("Login error:", error);
    ctx.error("INTERNAL", "Login failed");
  }
});
```

## Heartbeat & Connection Monitoring

Configure heartbeat for connection health monitoring.

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

type AppData = { userId?: string; lastSeen?: number };

const router = createRouter<AppData>({
  heartbeat: {
    intervalMs: 30_000, // Send ping every 30 seconds
    timeoutMs: 5_000, // Wait 5 seconds for pong
    onStaleConnection: (clientId, ws) => {
      console.log(`Connection ${clientId} is stale, closing...`);
      ws.close(1008, "Heartbeat timeout");
    },
  },
});

router.onOpen((ctx) => {
  console.log(`Client ${ctx.clientId} connected`);
  ctx.assignData({ lastSeen: Date.now() });
});

router.onClose((ctx) => {
  const duration = Date.now() - (ctx.data.lastSeen || 0);
  console.log(`Client ${ctx.clientId} disconnected after ${duration}ms`);
});

serve(router, { port: 3000 });
```

## Getting Started

1. **Start with `examples/quick-start/`** to learn the basics
2. **Explore `examples/bun-zod-chat/`** for a real-world application
3. **Check `examples/delta-sync/`** for collaborative app patterns
4. **Review `examples/cloudflare-sharding/`** for scaling strategies
5. **See `examples/typed-client-usage.ts`** for browser client implementation

All examples use:

- **Bun** as runtime
- **Zod** for schema validation
- **@ws-kit/** packages from workspace

**Install dependencies:**

```bash
bun install
```

**Type-check all examples:**

```bash
bunx tsc --noEmit
```

**Run tests:**

```bash
bun test
```
