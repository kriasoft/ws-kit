# Deployment

This guide covers best practices for deploying WS-Kit applications to production on Bun, Cloudflare Workers/Durable Objects, and other platforms.

## Choosing an Adapter

WS-Kit's pub/sub layer is pluggable, allowing you to choose the right adapter for your deployment scenario:

| Scenario                     | Adapter             | Package              | Notes                                                                                 |
| ---------------------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Single-instance server       | In-memory (default) | `@ws-kit/memory`     | Perfect for development and small deployments                                         |
| Multi-instance load-balanced | Redis               | `@ws-kit/redis`      | Automatic cross-instance broadcasting with atomic token bucket rate limiting          |
| Cloudflare Workers           | Durable Objects     | `@ws-kit/cloudflare` | Serverless with stateful compute; 100 connections per DO, sharding required for scale |
| Custom backend               | Your implementation | Custom               | Implement the `PubSubAdapter` interface                                               |

For detailed adapter specifications, limits, and guarantees, see [Adapter Responsibilities](/specs/adapters).

## Environment Configuration

Use environment variables for production settings:

```typescript
// config.ts
export const config = {
  port: parseInt(process.env.PORT || "3000"),

  // Security
  jwtSecret: process.env.JWT_SECRET!,
  corsOrigin: process.env.CORS_ORIGIN || "*",

  // Rate limiting
  maxConnectionsPerIP: parseInt(process.env.MAX_CONNECTIONS_PER_IP || "10"),
  messageRateLimit: parseInt(process.env.MESSAGE_RATE_LIMIT || "100"),

  // Timeouts
  authTimeout: parseInt(process.env.AUTH_TIMEOUT || "5000"),
  idleTimeout: parseInt(process.env.IDLE_TIMEOUT || "300000"),

  // Scaling
  maxPayloadSize: parseInt(process.env.MAX_PAYLOAD_SIZE || "1048576"), // 1MB
};

// Validate required env vars
if (!config.jwtSecret) {
  throw new Error("JWT_SECRET environment variable is required");
}
```

## Deploying to Bun

### Basic Setup with `serve()` Helper

The simplest approach uses the platform-specific `serve()` helper:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import jwt from "jsonwebtoken";
import { config } from "./config";

type AppData = {
  userId?: string;
  roles?: string[];
  authenticated?: boolean;
};

const AuthMessage = message("AUTH", {
  token: z.string(),
});

const router = createRouter<AppData>();

// Middleware: require auth for protected messages
router.use((ctx, next) => {
  if (!ctx.data?.authenticated && ctx.type !== "AUTH") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
  return next();
});

router.on(AuthMessage, (ctx) => {
  try {
    const decoded = jwt.verify(ctx.payload.token, config.jwtSecret, {
      algorithms: ["HS256"],
    });

    ctx.assignData({
      userId: decoded.sub as string,
      roles: decoded.roles as string[],
      authenticated: true,
    });
  } catch (error) {
    ctx.error("UNAUTHENTICATED", "Invalid token");
  }
});

// Serve with type-safe handlers
serve(router, {
  port: config.port,
  authenticate(req) {
    // Optional: authenticate during WebSocket upgrade
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        return {
          userId: decoded.sub as string,
          roles: decoded.roles as string[],
          authenticated: true,
        };
      } catch {
        return undefined;
      }
    }
  },
  onError(error, ctx) {
    console.error(`Error in ${ctx?.type}:`, error);
  },
  onOpen(ctx) {
    console.log(`User ${ctx.data?.userId} connected`);
  },
  onClose(ctx) {
    console.log(`User ${ctx.data?.userId} disconnected`);
  },
});

console.log(`Server running on ws://localhost:${config.port}`);
```

## Deploying to Cloudflare Durable Objects

Cloudflare Durable Objects provide stateful serverless compute for WebSocket connections:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { createDurableObjectHandler } from "@ws-kit/cloudflare";

type AppData = {
  userId?: string;
  roles?: string[];
};

const AuthMessage = message("AUTH", {
  token: z.string(),
});

const router = createRouter<AppData>();

router.use((ctx, next) => {
  if (!ctx.data?.userId && ctx.type !== "AUTH") {
    ctx.error("UNAUTHENTICATED", "Not authenticated");
    return;
  }
  return next();
});

router.on(AuthMessage, (ctx) => {
  try {
    // Access environment variable from Cloudflare DO env
    const jwtSecret = "your-jwt-secret"; // In real app: get from env
    const decoded = verifyJWT(ctx.payload.token, jwtSecret);
    ctx.assignData({
      userId: decoded.sub as string,
      roles: (decoded.roles as string[]) || [],
    });
  } catch {
    ctx.error("UNAUTHENTICATED", "Invalid token");
  }
});

// Export Durable Object class (required by Cloudflare)
export class ChatRoom {
  private handler;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.handler = createDurableObjectHandler(router, {
      authenticate(req) {
        const token = req.headers.get("authorization")?.replace("Bearer ", "");
        if (token) {
          try {
            const jwtSecret = env.JWT_SECRET || "your-jwt-secret";
            const decoded = verifyJWT(token, jwtSecret);
            return {
              userId: decoded.sub as string,
              roles: (decoded.roles as string[]) || [],
            };
          } catch {
            return undefined;
          }
        }
      },
      maxConnections: 1000,
    });
  }

  async fetch(req: Request): Promise<Response> {
    return this.handler.fetch(req);
  }
}
```

Deploy to Cloudflare:

```bash
wrangler deploy
```

## Security Best Practices

### 1. Input Validation

Use schemas to validate all message payloads:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const MessageSchema = message("MESSAGE", {
  // Limit string lengths
  text: z.string().min(1).max(1000),

  // Validate formats
  email: z.email(),
  url: z.url().startsWith("https://"),

  // Validate enums
  type: z.enum(["text", "image", "video"]),

  // Limit array sizes
  tags: z.array(z.string()).max(10),
});

const router = createRouter();

router.on(MessageSchema, (ctx) => {
  // Payload is guaranteed valid—TypeScript knows the shape
  console.log(`Message type: ${ctx.payload.type}`);
});
```

### 2. Rate Limiting

Implement per-user rate limiting in middleware with backoff hints:

```typescript
const rateLimiters = new Map<string, { count: number; resetAt: number }>();

router.use((ctx, next) => {
  const userId = ctx.data?.userId || "anonymous";
  const now = Date.now();
  const limit = rateLimiters.get(userId);

  if (limit && now < limit.resetAt) {
    if (limit.count >= 100) {
      // Send backoff hint so client knows when to retry
      const retryAfterMs = Math.max(0, limit.resetAt - now);
      ctx.error("RESOURCE_EXHAUSTED", "Too many messages", undefined, {
        retryable: true,
        retryAfterMs, // Client waits before retrying
      });
      return;
    }
    limit.count++;
  } else {
    rateLimiters.set(userId, {
      count: 1,
      resetAt: now + 60000, // Reset every minute
    });
  }

  return next();
});
```

The `retryAfterMs` field helps clients implement intelligent backoff: they'll automatically retry after the specified duration without hammering the server with immediate requests.

### 3. Idle Timeout Handling

Track idle connections and close them:

```typescript
const idleTimeout = 5 * 60 * 1000; // 5 minutes
const activityMap = new Map<WebSocket<AppData>, number>();

router.onOpen((ctx) => {
  activityMap.set(ctx.ws, Date.now());

  // Check for idle connections periodically
  const idleCheck = setInterval(() => {
    const lastActivity = activityMap.get(ctx.ws);
    if (lastActivity && Date.now() - lastActivity > idleTimeout) {
      ctx.ws.close(1000, "Idle timeout");
      activityMap.delete(ctx.ws);
      clearInterval(idleCheck);
    }
  }, 60000); // Check every minute
});

router.use((ctx, next) => {
  activityMap.set(ctx.ws, Date.now());
  return next();
});

router.onClose((ctx) => {
  activityMap.delete(ctx.ws);
});
```

## Performance Optimization

### 1. Broadcasting

Type-safe broadcasting with schema validation:

```typescript
const RoomUpdate = message("ROOM_UPDATE", {
  roomId: z.string(),
  message: z.string(),
});

router.on(SendMessage, async (ctx) => {
  const { text, roomId } = ctx.payload;

  // Type-safe broadcast (validated against schema)
  await router.publish(roomId, RoomUpdate, {
    roomId,
    message: text,
  });
});
```

### 2. Backpressure Handling

Bun provides built-in backpressure handling through the `drain` callback:

```typescript
import { createBunHandler } from "@ws-kit/bun";

const { fetch, websocket } = createBunHandler(router);

// The drain callback is called when the socket's write buffer has been flushed
// Use this to resume message processing if it was paused due to backpressure
Bun.serve({
  fetch,
  websocket: {
    ...websocket,
    drain(ws) {
      // Called when buffered messages are sent
      // Resume processing if you paused due to high backpressure
    },
  },
  port: 3000,
});
```

For high-throughput scenarios, monitor `ws.send()` return value to detect backpressure and pause processing accordingly.

### 3. Memory Management

Clean up resources on connection close:

```typescript
const connectionResources = new Map<WebSocket<AppData>, () => void>();

router.onOpen((ctx) => {
  const cleanup: Array<() => void> = [];

  // Track timers for cleanup
  const idleTimer = setInterval(() => {
    // Check idle status
  }, 60000);

  cleanup.push(() => clearInterval(idleTimer));

  // Store cleanup function
  connectionResources.set(ctx.ws, () => {
    cleanup.forEach((fn) => fn());
    connectionResources.delete(ctx.ws);
  });
});

router.onClose((ctx) => {
  const cleanup = connectionResources.get(ctx.ws);
  cleanup?.();
});
```

## Monitoring & Logging

### 1. Structured Logging

Log connection lifecycle and message handling:

```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: process.env.NODE_ENV !== "production",
    },
  },
});

router.onOpen((ctx) => {
  logger.info({
    event: "ws_connect",
    userId: ctx.data?.userId,
    timestamp: new Date().toISOString(),
  });
});

router.use((ctx, next) => {
  logger.debug({
    event: "ws_message",
    userId: ctx.data?.userId,
    type: ctx.type,
    size: JSON.stringify(ctx.payload).length,
  });
  return next();
});

router.onClose((ctx) => {
  logger.info({
    event: "ws_disconnect",
    userId: ctx.data?.userId,
  });
});
```

### 2. Metrics Collection

Track key metrics:

```typescript
const metrics = {
  activeConnections: 0,
  totalMessages: 0,
  totalErrors: 0,
};

router.onOpen(() => {
  metrics.activeConnections++;
});

router.onClose(() => {
  metrics.activeConnections--;
});

router.use((ctx, next) => {
  try {
    metrics.totalMessages++;
    return next();
  } catch (error) {
    metrics.totalErrors++;
    throw error;
  }
});

// Expose metrics endpoint (if using HTTP framework)
app.get("/metrics", (c) => {
  return c.json(metrics);
});
```

## Scaling Strategies

### 1. Horizontal Scaling with Redis

For multi-instance deployments, use the Redis adapter for automatic cross-instance broadcasting:

```typescript
import { createClient } from "redis";
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/pubsub";
import { serve } from "@ws-kit/bun";
import { redisPubSub } from "@ws-kit/redis";

type AppData = { userId?: string };

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
await redis.connect();

// Create router with Redis adapter for cross-instance broadcasting
const router = createRouter<AppData>()
  .plugin(withZod())
  .plugin(
    withPubSub({
      adapter: redisPubSub(redis, { channelPrefix: "myapp:prod:" }),
    }),
  );

const ChatMessage = message("CHAT", {
  userId: z.string(),
  text: z.string(),
});

router.on(ChatMessage, async (ctx) => {
  // Broadcasts to all instances connected to Redis
  await ctx.publish("chat:general", ChatMessage, {
    userId: ctx.payload.userId,
    text: ctx.payload.text,
  });
});

// Initialize broker (auto-creates subscriber via duplicate())
await router.pubsub.init();

serve(router, { port: 3000 });
```

The Redis adapter handles all cross-instance coordination automatically:

- Messages published via `router.publish()` are broadcast to all instances
- Each instance delivers messages to its local subscribers
- Automatic reconnection with exponential backoff
- Connection pooling for optimal performance

For more details, see the [redis-multi-instance example](https://github.com/kriasoft/ws-kit/tree/main/examples/redis-multi-instance/).

### 2. Load Balancing

Configure your load balancer for sticky WebSocket sessions:

```nginx
# nginx.conf
upstream websocket {
    ip_hash;  # Sticky sessions to same backend
    server app1.internal:3000;
    server app2.internal:3000;
    server app3.internal:3000;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location /ws {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long timeouts for persistent connections
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

## Testing Multiple Runtimes

Before production, test your router under multiple deployment targets. The router is platform-agnostic, so you can test the same routing logic with different adapters.

Example testing approach:

```typescript
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { describe, it, expect } from "bun:test";

// Create your router once
const router = createRouter();
// ... register handlers

describe("Production deployment test", () => {
  it("works with Bun adapter", async () => {
    // Start server with Bun adapter
    serve(router, {
      port: 3000,
      authenticate(req) {
        return { userId: "test" };
      },
    });

    // Run client tests against ws://localhost:3000
  });

  // For Cloudflare DO, test with their local dev environment
  // using `wrangler dev` or integration tests
});
```

For complete multi-runtime testing patterns, see [Advanced: Multi-Runtime Harness](./guides/advanced-multi-runtime).

## Graceful Shutdown

Handle shutdown signals and drain connections gracefully:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { createBunHandler } from "@ws-kit/bun";

const router = createRouter();
const { fetch, websocket } = createBunHandler(router);

const ShutdownNotice = message("SERVER_SHUTDOWN", {
  reason: z.string(),
});

let isShuttingDown = false;

async function gracefulShutdown(server: ReturnType<typeof Bun.serve>) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("Starting graceful shutdown...");

  // Notify clients of shutdown
  await router.publish("all", ShutdownNotice, {
    reason: "Server maintenance",
  });

  // Give clients time to gracefully disconnect
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Stop accepting new connections
  server.stop();

  process.exit(0);
}

const server = Bun.serve({
  fetch,
  websocket,
  port: 3000,
});

process.on("SIGTERM", () => gracefulShutdown(server));
process.on("SIGINT", () => gracefulShutdown(server));
```

## Deployment Checklist

Before deploying to production:

- [ ] Set all required environment variables (JWT_SECRET, etc.)
- [ ] Enable WSS/HTTPS with valid certificates
- [ ] Configure rate limiting per user
- [ ] Set up structured logging and aggregation
- [ ] Test authentication flow end-to-end
- [ ] Configure idle timeout handling
- [ ] Test graceful shutdown
- [ ] Load test with expected concurrent connections
- [ ] Set up monitoring and alerting
- [ ] Test multi-runtime compatibility (see Advanced guide)
- [ ] Configure automatic restarts and health checks

## See Also

- [Advanced: Multi-Runtime Harness](./guides/advanced-multi-runtime) — Integration testing across platforms
- [ADR-006: Multi-Runtime serve()](./adr/006-multi-runtime-serve-with-explicit-selection) — Runtime selection design
