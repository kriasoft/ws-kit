# Valibot Integration

This library now supports both **Zod** and **Valibot** validators through separate import paths. This allows you to choose the validation library that best fits your needs in terms of bundle size, performance, and API preferences.

## Quick Comparison

| Feature             | Zod (v4)                | Valibot (v1)         |
| ------------------- | ----------------------- | -------------------- |
| Bundle Size         | ~5-6 kB (minified)      | ~1-2 kB (minified)   |
| Runtime Performance | Fast                    | ~2x faster           |
| API Style           | Method chaining         | Functional pipelines |
| Ecosystem           | Mature, large community | Growing, modern      |
| TypeScript Support  | Excellent               | Excellent            |

::: tip Bundle Size
Actual bundle size depends on usage. Both libraries are tree-shakeable. Valibot typically results in 60-80% smaller bundles for typical WebSocket message validation use cases.
:::

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
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

// Create factory with your Zod instance
const { messageSchema } = createMessageSchema(z);

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

// Define response schema first
const RoomJoinedMessage = messageSchema("ROOM_JOINED", {
  success: z.boolean(),
});

// Register handlers
router.on(JoinRoomMessage, (ctx) => {
  console.log(`User ${ctx.payload.userId} joining room ${ctx.payload.roomId}`);

  // Type-safe response
  ctx.send(RoomJoinedMessage, {
    success: true,
  });
});
```

### Valibot Implementation

```typescript
import * as v from "valibot";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/valibot";

// Create factory with your Valibot instance
const { messageSchema } = createMessageSchema(v);

// Create message schemas
const JoinRoomMessage = messageSchema("JOIN_ROOM", {
  roomId: v.string(),
  userId: v.string(),
});

const LeaveRoomMessage = messageSchema("LEAVE_ROOM", {
  roomId: v.string(),
});

// Create router
const router = new WebSocketRouter<{ userId?: string }>();

// Define response schema first
const RoomJoinedMessage = messageSchema("ROOM_JOINED", {
  success: v.boolean(),
});

// Register handlers
router.on(JoinRoomMessage, (ctx) => {
  console.log(`User ${ctx.payload.userId} joining room ${ctx.payload.roomId}`);

  // Type-safe response
  ctx.send(RoomJoinedMessage, {
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
  email: z.email(),
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

Both validators require creating a factory first, then use the same `messageSchema()` function signature:

**Zod:**

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);

// Basic message
const PingMessage = messageSchema("PING");

// With payload
const ChatMessage = messageSchema("CHAT", {
  content: z.string(),
  roomId: z.string(),
});

// With custom metadata (required field)
const PrivateMessage = messageSchema(
  "PRIVATE",
  { content: z.string(), recipientId: z.string() },
  { roomId: z.string() },
);
```

**Valibot:**

```typescript
import * as v from "valibot";
import { createMessageSchema } from "bun-ws-router/valibot";

const { messageSchema } = createMessageSchema(v);

// Basic message
const PingMessage = messageSchema("PING");

// With payload
const ChatMessage = messageSchema("CHAT", {
  content: v.string(),
  roomId: v.string(),
});

// With custom metadata (required field)
const PrivateMessage = messageSchema(
  "PRIVATE",
  { content: v.string(), recipientId: v.string() },
  { roomId: v.string() },
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
   // Before (Zod)
   import { z } from "zod";
   import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
   const { messageSchema } = createMessageSchema(z);

   // After (Valibot)
   import * as v from "valibot";
   import { WebSocketRouter, createMessageSchema } from "bun-ws-router/valibot";
   const { messageSchema } = createMessageSchema(v);
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

The main package export (`bun-ws-router`) continues to use Zod for backward compatibility, but you must use the factory pattern:

```typescript
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";

// ✅ REQUIRED - use factory pattern
const { messageSchema } = createMessageSchema(z);
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
