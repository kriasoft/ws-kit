# Deployment

This guide covers best practices for deploying Bun WebSocket Router applications to production.

## Environment Configuration

Use environment variables for production settings:

```typescript
// config.ts
export const config = {
  port: parseInt(process.env.PORT || "3000"),
  wsPath: process.env.WS_PATH || "/ws",

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

## Security Best Practices

### 1. Authentication & Authorization

```typescript
import jwt from "jsonwebtoken";

const router = new WebSocketRouter()
  .onOpen((ctx) => {
    // Set auth timeout
    const authTimer = setTimeout(() => {
      if (!ctx.ws.data.authenticated) {
        ctx.ws.close(1008, "Authentication timeout");
      }
    }, config.authTimeout);

    ctx.ws.data.authTimer = authTimer;
  })

  .on(AuthMessage, async (ctx) => {
    try {
      // Verify token
      const decoded = jwt.verify(ctx.payload.token, config.jwtSecret, {
        algorithms: ["HS256"],
        maxAge: "24h",
      });

      // Clear auth timer
      clearTimeout(ctx.ws.data.authTimer);

      // Set authenticated
      ctx.ws.data.authenticated = true;
      ctx.ws.data.userId = decoded.sub;
      ctx.ws.data.roles = decoded.roles;
    } catch (error) {
      ctx.ws.close(1008, "Invalid authentication");
    }
  });
```

### 2. Input Validation

```typescript
// Strict schema validation
const MessageSchema = messageSchema("MESSAGE", {
  // Limit string lengths
  text: z.string().min(1).max(1000),

  // Validate formats
  email: z.email(),
  url: z.url().startsWith("https://"),

  // Sanitize HTML
  content: z.string().transform(sanitizeHtml),

  // Validate enums
  type: z.enum(["text", "image", "video"]),

  // Limit array sizes
  tags: z.array(z.string()).max(10),
});
```

### 3. Rate Limiting

```typescript
import { RateLimiterMemory } from "rate-limiter-flexible";

// Create rate limiters
const messageLimiter = new RateLimiterMemory({
  points: config.messageRateLimit,
  duration: 60, // Per minute
});

const connectionLimiter = new RateLimiterMemory({
  points: config.maxConnectionsPerIP,
  duration: 0, // No expiry
});

// Apply rate limiting
Bun.serve({
  async fetch(req, server) {
    const ip = req.headers.get("x-forwarded-for") || "unknown";

    try {
      // Check connection limit
      await connectionLimiter.consume(ip);

      return router.upgrade(req, { server });
    } catch {
      return new Response("Too many connections", { status: 429 });
    }
  },

  websocket: router.websocket,
});
```

## Performance Optimization

### 1. Connection Pooling

```typescript
import { publish } from "bun-ws-router/zod/publish";

// Efficient broadcast using type-safe publish
router.on(BroadcastMessage, (ctx) => {
  // Type-safe publish validates message before sending
  publish(ctx.ws, "global", BroadcastMessage, ctx.payload);
});

// Subscribe clients efficiently
router.onOpen((ctx) => {
  ctx.ws.subscribe("global");
  ctx.ws.subscribe(`user:${ctx.ws.data.clientId}`);
});
```

### 2. Message Compression

```typescript
// Enable per-message deflate
const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch: app.fetch, // Your HTTP handler
  websocket: {
    ...router.websocket,

    // Enable compression
    perMessageDeflate: {
      threshold: 1024, // Compress messages > 1KB
      compress: true,
    },
  },
});
```

### 3. Memory Management

```typescript
// Clean up resources
const cleanupManager = new Map<string, () => void>();

router
  .onOpen((ctx) => {
    const clientId = ctx.ws.data.clientId;
    const cleanup: Array<() => void> = [];

    // Initialize activity tracking
    ctx.ws.data.lastActivity = Date.now();

    // Set idle timeout
    const idleTimer = setInterval(() => {
      if (Date.now() - ctx.ws.data.lastActivity > config.idleTimeout) {
        ctx.ws.close(1000, "Idle timeout");
      }
    }, 60000);

    cleanup.push(() => clearInterval(idleTimer));

    // Store cleanup functions
    cleanupManager.set(clientId, () => {
      cleanup.forEach((fn) => fn());
      cleanupManager.delete(clientId);
    });
  })

  .on(AnyMessage, (ctx) => {
    // Update activity timestamp directly on ws.data
    ctx.ws.data.lastActivity = Date.now();
  })

  .onClose((ctx) => {
    // Run cleanup
    cleanupManager.get(ctx.ws.data.clientId)?.();
  });
```

## Monitoring & Logging

### 1. Structured Logging

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

router
  .onOpen((ctx) => {
    logger.info({
      event: "ws_connect",
      clientId: ctx.ws.data.clientId,
      ip: ctx.ws.data.ip,
    });
  })

  .on(AnyMessage, (ctx) => {
    logger.debug({
      event: "ws_message",
      clientId: ctx.ws.data.clientId,
      type: ctx.type,
      size: JSON.stringify(ctx.payload).length,
    });
  })

  .onError((ws, error) => {
    logger.error({
      event: "ws_error",
      clientId: ws.data.clientId,
      error: error.message,
      stack: error.stack,
    });
  });
```

### 2. Metrics Collection

```typescript
// Prometheus metrics
import { register, Counter, Gauge, Histogram } from "prom-client";

const metrics = {
  connections: new Gauge({
    name: "ws_connections_total",
    help: "Total WebSocket connections",
  }),

  messages: new Counter({
    name: "ws_messages_total",
    help: "Total messages processed",
    labelNames: ["type"],
  }),

  errors: new Counter({
    name: "ws_errors_total",
    help: "Total errors",
    labelNames: ["code"],
  }),

  messageSize: new Histogram({
    name: "ws_message_size_bytes",
    help: "Message size in bytes",
    buckets: [100, 1000, 10000, 100000],
  }),
};

// Track metrics
router
  .onOpen(() => metrics.connections.inc())
  .onClose(() => metrics.connections.dec())
  .on(AnyMessage, (ctx) => {
    const size = JSON.stringify(ctx.payload).length;
    metrics.messages.inc({ type: ctx.type });
    metrics.messageSize.observe(size);
  });

// Expose metrics endpoint
app.get("/metrics", (c) => c.text(register.metrics()));
```

## Scaling Strategies

### 1. Horizontal Scaling with Redis

```typescript
import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL,
});

await redis.connect();

// Pub/Sub across instances
router.on(BroadcastMessage, async (ctx) => {
  // Publish to Redis for cross-instance communication
  await redis.publish(
    "broadcast",
    JSON.stringify({
      type: "BROADCAST",
      payload: ctx.payload,
      origin: process.env.INSTANCE_ID,
    }),
  );

  // Also broadcast to local clients using type-safe publish()
  publish(ctx.ws, "global", BroadcastMessage, ctx.payload);
});

// Subscribe to Redis broadcasts from other instances
redis.subscribe("broadcast", (message) => {
  const data = JSON.parse(message);

  // Skip if from current instance (already broadcasted above)
  if (data.origin === process.env.INSTANCE_ID) return;

  // Broadcast to local clients using server.publish()
  // Note: This is raw server-level broadcast (no validation)
  // Message is already validated by originating instance
  server.publish("global", JSON.stringify(data));
});
```

### 2. Load Balancing

Configure your load balancer for WebSocket support:

```nginx
# nginx.conf
upstream websocket {
    ip_hash;  # Sticky sessions
    server app1:3000;
    server app2:3000;
    server app3:3000;
}

server {
    listen 80;

    location /ws {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

## Health Checks

Implement health check endpoints:

```typescript
const healthRouter = new Hono();

healthRouter.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: Date.now(),
    connections: connectionCount,
    uptime: process.uptime(),
  });
});

healthRouter.get("/health/ready", async (c) => {
  try {
    // Check dependencies
    await redis.ping();

    return c.json({ status: "ready" });
  } catch (error) {
    return c.json({ status: "not ready", error: error.message }, 503);
  }
});
```

## Deployment Checklist

Before deploying to production:

- [ ] Set all required environment variables
- [ ] Enable HTTPS/WSS with valid certificates
- [ ] Configure rate limiting
- [ ] Set up monitoring and alerting
- [ ] Test authentication flow
- [ ] Configure log aggregation
- [ ] Set up automated backups
- [ ] Create runbooks for common issues
- [ ] Test graceful shutdown
- [ ] Load test with expected traffic

## Graceful Shutdown

```typescript
// Handle shutdown signals
let isShuttingDown = false;

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Starting graceful shutdown...");

  // Stop accepting new connections
  server.stop();

  // Notify all clients of shutdown using server.publish()
  // Note: This is server-level broadcast (no per-connection context)
  const ShutdownMessage = messageSchema("SERVER_SHUTDOWN", {
    reason: z.string(),
  });

  server.publish(
    "global",
    JSON.stringify({
      type: "SERVER_SHUTDOWN",
      meta: { timestamp: Date.now() },
      payload: { reason: "Server maintenance" },
    }),
  );

  // Give clients time to handle shutdown message
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Clean up resources
  await redis.quit();

  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
```
