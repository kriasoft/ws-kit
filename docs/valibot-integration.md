# Valibot Integration

This library now supports both **Zod** and **Valibot** validators through separate import paths. This allows you to choose the validation library that best fits your needs in terms of bundle size, performance, and API preferences.

## Quick Comparison

| Feature             | Zod                     | Valibot               |
| ------------------- | ----------------------- | --------------------- |
| Bundle Size         | 13.5 kB                 | 1.37 kB (90% smaller) |
| Runtime Performance | Baseline                | ~2x faster            |
| API Style           | Method chaining         | Functional pipelines  |
| Ecosystem           | Mature, large community | Growing, newer        |
| TypeScript Support  | Excellent               | Excellent             |

## Installation

Install the validator library you want to use:

```bash
# For Zod users
bun add zod

# For Valibot users
bun add valibot

# Or both for migration
bun add zod valibot
```

## Usage

### Zod Implementation

```typescript
import { WebSocketRouter, messageSchema } from "bun-ws-router/zod";
import { z } from "zod";

// Create message schemas
const JoinRoomMessage = messageSchema("JOIN_ROOM", {
  roomId: z.string(),
  userId: z.string(),
});

const LeaveRoomMessage = messageSchema("LEAVE_ROOM", {
  roomId: z.string(),
});

// Create router
const router = new WebSocketRouter<{ userId?: string }>();

// Register handlers
router.onMessage(JoinRoomMessage, ({ ws, payload, meta, send }) => {
  console.log(`User ${payload.userId} joining room ${payload.roomId}`);

  // Type-safe response
  send(messageSchema("ROOM_JOINED", { success: true }), {
    success: true,
  });
});
```

### Valibot Implementation

```typescript
import { WebSocketRouter, messageSchema } from "bun-ws-router/valibot";
import * as v from "valibot";

// Create message schemas
const JoinRoomMessage = messageSchema(
  "JOIN_ROOM",
  v.object({
    roomId: v.string(),
    userId: v.string(),
  }),
);

const LeaveRoomMessage = messageSchema(
  "LEAVE_ROOM",
  v.object({
    roomId: v.string(),
  }),
);

// Create router
const router = new WebSocketRouter<{ userId?: string }>();

// Register handlers
router.onMessage(JoinRoomMessage, ({ ws, payload, meta, send }) => {
  console.log(`User ${payload.userId} joining room ${payload.roomId}`);

  // Type-safe response
  send(messageSchema("ROOM_JOINED", v.object({ success: v.boolean() })), {
    success: true,
  });
});
```

## API Differences

### Schema Creation

**Zod:**

```typescript
import { z } from "zod";

// Basic validation
const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().min(18),
});
```

**Valibot:**

```typescript
import * as v from "valibot";

// Functional pipelines
const userSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
  age: v.pipe(v.number(), v.minValue(18)),
});
```

### Message Schema Factory

Both validators use the same `messageSchema()` function signature, but with their respective validation objects:

**Zod:**

```typescript
// Basic message
const PingMessage = messageSchema("PING");

// With payload
const ChatMessage = messageSchema("CHAT", {
  content: z.string(),
  roomId: z.string(),
});

// With custom metadata
const PrivateMessage = messageSchema(
  "PRIVATE",
  { content: z.string(), recipientId: z.string() },
  z.object({ senderId: z.string() }),
);
```

**Valibot:**

```typescript
// Basic message
const PingMessage = messageSchema("PING");

// With payload
const ChatMessage = messageSchema(
  "CHAT",
  v.object({
    content: v.string(),
    roomId: v.string(),
  }),
);

// With custom metadata
const PrivateMessage = messageSchema(
  "PRIVATE",
  v.object({ content: v.string(), recipientId: v.string() }),
  v.object({ senderId: v.string() }),
);
```

## Performance Benefits

### Bundle Size Impact

For a typical WebSocket application with 5-10 message types:

- **Zod version**: ~15-20 kB total validation code
- **Valibot version**: ~2-3 kB total validation code

This difference is especially important for:

- Client-side applications
- Serverless environments
- Mobile applications
- Edge computing scenarios

### Runtime Performance

Valibot's functional design and tree-shakeable architecture provides:

- ~2x faster validation than Zod
- Better startup performance due to minimal initialization
- Smaller memory footprint

## Migration Guide

### From Zod to Valibot

1. **Update imports:**

   ```typescript
   // Before
   import { WebSocketRouter, messageSchema } from "bun-ws-router";

   // After
   import { WebSocketRouter, messageSchema } from "bun-ws-router/valibot";
   ```

2. **Convert schema definitions:**

   ```typescript
   // Zod
   const schema = z.object({
     name: z.string().min(1).max(50),
     age: z.number().int().positive(),
   });

   // Valibot
   const schema = v.object({
     name: v.pipe(v.string(), v.minLength(1), v.maxLength(50)),
     age: v.pipe(v.number(), v.integer(), v.minValue(1)),
   });
   ```

3. **Update validation calls:**

   ```typescript
   // Zod
   const result = schema.safeParse(data);

   // Valibot
   const result = v.safeParse(schema, data);
   ```

### Gradual Migration

You can use both validators simultaneously during migration:

```typescript
// Legacy Zod handlers
import { WebSocketRouter as ZodRouter } from "bun-ws-router/zod";

// New Valibot handlers
import { WebSocketRouter as ValibotRouter } from "bun-ws-router/valibot";

const zodRouter = new ZodRouter();
const valibotRouter = new ValibotRouter();

// Merge routers
zodRouter.addRoutes(valibotRouter);
```

## Backward Compatibility

The main package export (`bun-ws-router`) continues to use Zod for backward compatibility:

```typescript
// This still works and uses Zod
import { WebSocketRouter, messageSchema } from "bun-ws-router";
```

## When to Choose Which

### Choose Zod if:

- You're new to validation libraries
- You need extensive ecosystem support
- You're working on server-side applications where bundle size isn't critical
- You prefer method chaining APIs
- You need complex, nested validation logic

### Choose Valibot if:

- Bundle size is critical (client-side, serverless, edge)
- You need maximum runtime performance
- You prefer functional programming patterns
- You're building new applications and can start fresh
- You want the latest validation technology

## Further Resources

- [Valibot Documentation](https://valibot.dev/)
- [Zod Documentation](https://zod.dev/)
- [Bundle Size Comparison](https://bundlephobia.com/compare/zod@3.24.3,valibot@0.42.1)
- [Performance Benchmarks](https://moltar.github.io/typescript-runtime-type-benchmarks/)
