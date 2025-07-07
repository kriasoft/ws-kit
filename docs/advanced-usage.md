# Advanced Usage

This guide covers advanced patterns and techniques for building sophisticated WebSocket applications with Bun WebSocket Router.

## Router Composition

Compose multiple routers to organize your application into modules:

```typescript
import { WebSocketRouter } from "bun-ws-router";

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

## Middleware Pattern

Implement middleware for cross-cutting concerns:

```typescript
// Middleware type
type Middleware<T = unknown> = (
  ctx: MessageContext<any, T>,
  next: () => void | Promise<void>,
) => void | Promise<void>;

// Authentication middleware
const requireAuth: Middleware = async (ctx, next) => {
  const userData = ctx.getData<{ authenticated?: boolean }>();

  if (!userData.authenticated) {
    ctx.send({
      type: "ERROR",
      payload: {
        code: ErrorCode.UNAUTHORIZED,
        message: "Authentication required",
      },
    });
    return;
  }

  await next();
};

// Logging middleware
const logMessages: Middleware = async (ctx, next) => {
  const start = Date.now();
  console.log(
    `[${ctx.clientId}] Received message type: ${ctx.ws.data.lastMessageType}`,
  );

  await next();

  const duration = Date.now() - start;
  console.log(`[${ctx.clientId}] Processed in ${duration}ms`);
};

// Apply middleware wrapper
function withMiddleware<T>(
  handler: (ctx: MessageContext<T>) => void,
  ...middleware: Middleware[]
): (ctx: MessageContext<T>) => void {
  return (ctx) => {
    let index = 0;

    const next = () => {
      if (index >= middleware.length) {
        return handler(ctx);
      }

      const mw = middleware[index++];
      return mw(ctx, next);
    };

    return next();
  };
}

// Use with router
router.onMessage(
  ProtectedMessage,
  withMiddleware(handleProtectedAction, requireAuth, logMessages),
);
```

## Custom Context Extensions

Extend the context with custom functionality:

```typescript
// Extended context with utilities
class ExtendedContext<T, TData = unknown> {
  constructor(private ctx: MessageContext<T, TData>) {}

  // Broadcast to all connected clients
  broadcast(message: Message) {
    this.ctx.publish("global", message);
  }

  // Send error with standard format
  sendError(code: ErrorCode, message: string, details?: any) {
    this.ctx.send({
      type: "ERROR",
      payload: { code, message, details },
    });
  }

  // Reply to a message with correlation
  reply(type: string, payload?: any) {
    this.ctx.send({
      type,
      meta: {
        clientId: this.ctx.clientId,
        timestamp: Date.now(),
        correlationId: this.ctx.ws.data.lastCorrelationId,
      },
      payload,
    });
  }

  // Check if user has role
  hasRole(role: string): boolean {
    const userData = this.ctx.getData<{ roles?: string[] }>();
    return userData.roles?.includes(role) ?? false;
  }
}

// Helper to wrap handlers
function extendedHandler<T>(
  handler: (ctx: ExtendedContext<T>) => void,
): (ctx: MessageContext<T>) => void {
  return (ctx) => handler(new ExtendedContext(ctx));
}

// Use in router
router.onMessage(
  AdminMessage,
  extendedHandler((ctx) => {
    if (!ctx.hasRole("admin")) {
      ctx.sendError(ErrorCode.FORBIDDEN, "Admin access required");
      return;
    }

    ctx.broadcast({
      type: "ADMIN_ANNOUNCEMENT",
      payload: ctx.ctx.payload,
    });
  }),
);
```

## State Management

Implement centralized state management:

```typescript
// State store
class StateStore {
  private state = new Map<string, any>();
  private subscribers = new Map<string, Set<(state: any) => void>>();

  get<T>(key: string): T | undefined {
    return this.state.get(key);
  }

  set(key: string, value: any) {
    this.state.set(key, value);
    this.notify(key, value);
  }

  update<T>(key: string, updater: (current: T) => T) {
    const current = this.get<T>(key);
    const updated = updater(current!);
    this.set(key, updated);
  }

  subscribe(key: string, callback: (state: any) => void) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(key)?.delete(callback);
    };
  }

  private notify(key: string, value: any) {
    this.subscribers.get(key)?.forEach((cb) => cb(value));
  }
}

// Global state
const store = new StateStore();

// Room state example
interface RoomState {
  users: Map<string, { username: string; joinedAt: number }>;
  messages: Array<{ id: string; text: string; userId: string }>;
}

router.onMessage(JoinRoomMessage, (ctx) => {
  const { roomId, username } = ctx.payload;

  // Update room state
  store.update<RoomState>(
    `room:${roomId}`,
    (
      room = {
        users: new Map(),
        messages: [],
      },
    ) => ({
      ...room,
      users: new Map(room.users).set(ctx.clientId, {
        username,
        joinedAt: Date.now(),
      }),
    }),
  );

  // Subscribe to room state changes
  const unsubscribe = store.subscribe(`room:${roomId}`, (roomState) => {
    ctx.send({
      type: "ROOM_STATE_UPDATE",
      payload: {
        userCount: roomState.users.size,
        latestMessages: roomState.messages.slice(-10),
      },
    });
  });

  // Clean up on disconnect
  ctx.ws.data.cleanupCallbacks = [
    ...(ctx.ws.data.cleanupCallbacks || []),
    unsubscribe,
  ];
});
```

## Message Queuing

Implement message queuing for reliability:

```typescript
class MessageQueue {
  private queues = new Map<string, Message[]>();
  private processing = new Set<string>();

  enqueue(clientId: string, message: Message) {
    if (!this.queues.has(clientId)) {
      this.queues.set(clientId, []);
    }
    this.queues.get(clientId)!.push(message);
  }

  async process(
    clientId: string,
    handler: (message: Message) => Promise<void>,
  ) {
    if (this.processing.has(clientId)) {
      return; // Already processing
    }

    this.processing.add(clientId);
    const queue = this.queues.get(clientId) || [];

    while (queue.length > 0) {
      const message = queue.shift()!;
      try {
        await handler(message);
      } catch (error) {
        console.error(`Failed to process message:`, error);
        // Could implement retry logic here
      }
    }

    this.processing.delete(clientId);
  }

  clear(clientId: string) {
    this.queues.delete(clientId);
    this.processing.delete(clientId);
  }
}

const messageQueue = new MessageQueue();

// Queue messages when client is processing
router.onMessage(QueuedMessage, async (ctx) => {
  const userData = ctx.getData<{ isProcessing?: boolean }>();

  if (userData.isProcessing) {
    // Queue message for later
    messageQueue.enqueue(ctx.clientId, {
      type: QueuedMessage.type,
      meta: {
        clientId: ctx.clientId,
        timestamp: Date.now(),
      },
      payload: ctx.payload,
    });
    return;
  }

  // Process immediately
  ctx.setData({ ...userData, isProcessing: true });

  try {
    await processMessage(ctx.payload);

    // Process any queued messages
    await messageQueue.process(ctx.clientId, async (msg) => {
      await processMessage(msg.payload);
    });
  } finally {
    ctx.setData({ ...userData, isProcessing: false });
  }
});
```

## Connection Pooling

Manage groups of connections efficiently:

```typescript
class ConnectionPool {
  private pools = new Map<string, Set<ServerWebSocket>>();

  add(poolId: string, ws: ServerWebSocket) {
    if (!this.pools.has(poolId)) {
      this.pools.set(poolId, new Set());
    }
    this.pools.get(poolId)!.add(ws);
  }

  remove(poolId: string, ws: ServerWebSocket) {
    this.pools.get(poolId)?.delete(ws);

    // Clean up empty pools
    if (this.pools.get(poolId)?.size === 0) {
      this.pools.delete(poolId);
    }
  }

  broadcast(poolId: string, message: Message, exclude?: string) {
    const pool = this.pools.get(poolId);
    if (!pool) return;

    const messageStr = JSON.stringify(message);

    for (const ws of pool) {
      if (ws.data.clientId !== exclude) {
        ws.send(messageStr);
      }
    }
  }

  getSize(poolId: string): number {
    return this.pools.get(poolId)?.size || 0;
  }

  getAll(poolId: string): ServerWebSocket[] {
    return Array.from(this.pools.get(poolId) || []);
  }
}

const connectionPool = new ConnectionPool();

// Use in router
router
  .onOpen((ws) => {
    // Add to global pool
    connectionPool.add("global", ws);
  })

  .onMessage(JoinPoolMessage, (ctx) => {
    const { poolId } = ctx.payload;

    // Add to specific pool
    connectionPool.add(poolId, ctx.ws);

    // Notify pool members
    connectionPool.broadcast(
      poolId,
      {
        type: "USER_JOINED_POOL",
        payload: {
          userId: ctx.clientId,
          poolSize: connectionPool.getSize(poolId),
        },
      },
      ctx.clientId,
    );
  })

  .onClose((ws) => {
    // Remove from all pools
    connectionPool.remove("global", ws);
    // Remove from other pools...
  });
```

## Schema Versioning

Handle message schema evolution:

```typescript
// Version 1 schema
const UserMessageV1 = messageSchema(
  "USER_UPDATE",
  z.object({
    name: z.string(),
    email: z.string().email(),
  }),
);

// Version 2 schema with additional field
const UserMessageV2 = messageSchema(
  "USER_UPDATE",
  z.object({
    name: z.string(),
    email: z.string().email(),
    avatar: z.string().url().optional(),
    version: z.literal(2).default(2),
  }),
);

// Migration function
function migrateUserMessage(data: any): z.infer<typeof UserMessageV2.schema> {
  if (!data.version || data.version === 1) {
    return {
      ...data,
      avatar: undefined,
      version: 2,
    };
  }
  return data;
}

// Versioned handler
router.onMessage(UserMessageV2, (ctx) => {
  const migrated = migrateUserMessage(ctx.payload);

  // Process with latest schema
  updateUser(migrated);
});
```

## Performance Optimization

Tips for optimizing WebSocket performance:

```typescript
// 1. Batch operations
class BatchProcessor {
  private batch: Array<() => void> = [];
  private timer?: Timer;

  add(operation: () => void) {
    this.batch.push(operation);

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 10);
    }
  }

  flush() {
    const operations = this.batch;
    this.batch = [];
    this.timer = undefined;

    // Process all at once
    operations.forEach((op) => op());
  }
}

// 2. Message compression (for large payloads)
import { gzipSync, gunzipSync } from "zlib";

const CompressedMessage = messageSchema(
  "COMPRESSED",
  z.object({
    encoding: z.literal("gzip"),
    data: z.string(), // Base64 encoded
  }),
);

function compressMessage(message: Message): Message {
  const json = JSON.stringify(message);
  const compressed = gzipSync(json);

  return {
    type: "COMPRESSED",
    payload: {
      encoding: "gzip",
      data: compressed.toString("base64"),
    },
  };
}

// 3. Connection pooling for broadcasts
const BROADCAST_CHUNK_SIZE = 100;

async function broadcastInChunks(
  connections: ServerWebSocket[],
  message: string,
) {
  for (let i = 0; i < connections.length; i += BROADCAST_CHUNK_SIZE) {
    const chunk = connections.slice(i, i + BROADCAST_CHUNK_SIZE);

    // Send to chunk
    chunk.forEach((ws) => ws.send(message));

    // Yield to event loop
    if (i + BROADCAST_CHUNK_SIZE < connections.length) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
```

## Next Steps

- Review [Examples](/examples) for practical implementations
- Read [Deployment](/deployment) for production guidelines
- Check the [API Reference](/api-reference) for detailed documentation
