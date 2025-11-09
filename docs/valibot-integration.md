# Valibot Integration

ws-kit supports both **Zod** and **Valibot** validators with identical APIs. Choose based on your bundle size and performance needs.

## Quick Comparison

| Feature             | Zod (v4)                | Valibot (v1)         |
| ------------------- | ----------------------- | -------------------- |
| Bundle Size         | ~5-6 kB (minified)      | ~1-2 kB (minified)   |
| Runtime Performance | Baseline                | ~2x faster           |
| API Style           | Method chaining         | Functional pipelines |
| Ecosystem           | Mature, large community | Growing, modern      |
| TypeScript Support  | Excellent               | Excellent            |

**Choose Valibot for:** Client-side applications, mobile, or size-critical bundles.
**Choose Zod for:** Familiar method-chaining API, server-side, or large ecosystem.

## Installation

```bash
# Valibot validator
bun add @ws-kit/valibot valibot

# Client (if needed)
bun add @ws-kit/client @ws-kit/valibot
```

## Basic Setup

The API is identical to Zod—just replace the validator:

**Zod:**

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const LoginMessage = message("LOGIN", {
  username: z.string().min(3),
  password: z.string().min(8),
});
```

**Valibot:**

```typescript
import { v, message, createRouter } from "@ws-kit/valibot";

const LoginMessage = message("LOGIN", {
  username: v.string(),
  password: v.pipe(v.string(), v.minLength(8)),
});
```

Everything else remains the same.

## Key Validator Differences

### String Validation

**Zod:**

```typescript
const schema = z.string().min(3).max(20).email();
```

**Valibot:**

```typescript
import * as v from "valibot";

const schema = v.pipe(v.string(), v.minLength(3), v.maxLength(20), v.email());
```

Valibot uses **pipes** for composing validators instead of method chains.

### Enums and Unions

**Zod:**

```typescript
const RoleSchema = z.enum(["user", "admin", "moderator"]);
const ValueSchema = z.union([z.string(), z.number()]);
```

**Valibot:**

```typescript
import * as v from "valibot";

const RoleSchema = v.picklist(["user", "admin", "moderator"]);
const ValueSchema = v.union([v.string(), v.number()]);
```

### Objects and Arrays

**Zod:**

```typescript
const schema = z.object({
  name: z.string(),
  tags: z.array(z.string()),
});
```

**Valibot:**

```typescript
import * as v from "valibot";

const schema = v.object({
  name: v.string(),
  tags: v.array(v.string()),
});
```

## Complete Example

### Server

```typescript
import { v, message, createRouter } from "@ws-kit/valibot";
import { serve } from "@ws-kit/bun";

// Define message schemas
const JoinRoom = message("JOIN_ROOM", {
  roomId: v.string(),
  username: v.string(),
});

const SendMessage = message("SEND_MESSAGE", {
  text: v.string(),
});

const UserJoined = message("USER_JOINED", {
  username: v.string(),
  userCount: v.number(),
});

const NewMessage = message("NEW_MESSAGE", {
  username: v.string(),
  text: v.string(),
});

// Create router
type AppData = { username?: string };
const router = createRouter<AppData>();

// Track users in rooms
const rooms = new Map<string, Set<string>>();

router.on(JoinRoom, async (ctx) => {
  const { roomId, username } = ctx.payload;

  // Update connection data
  ctx.ws.data.username = username;

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  rooms.get(roomId)!.add(ctx.ws.data.clientId);
  await ctx.topics.subscribe(roomId);

  ctx.publish(roomId, UserJoined, {
    username,
    userCount: rooms.get(roomId)!.size,
  });
});

router.on(SendMessage, (ctx) => {
  // Find which room this user is in
  let userRoomId: string | undefined;
  for (const [roomId, users] of rooms.entries()) {
    if (users.has(ctx.ws.data.clientId)) {
      userRoomId = roomId;
      break;
    }
  }

  if (userRoomId) {
    ctx.publish(userRoomId, NewMessage, {
      username: ctx.ws.data.username || "Anonymous",
      text: ctx.payload.text,
    });
  }
});

// Start server
serve(router, { port: 3000 });
```

### Client

```typescript
import { v, message } from "@ws-kit/valibot";
import { wsClient } from "@ws-kit/client/valibot";

// Define schemas (same as server)
const JoinRoom = message("JOIN_ROOM", {
  roomId: v.string(),
  username: v.string(),
});

const UserJoined = message("USER_JOINED", {
  username: v.string(),
  userCount: v.number(),
});

const SendMessage = message("SEND_MESSAGE", {
  text: v.string(),
});

const NewMessage = message("NEW_MESSAGE", {
  username: v.string(),
  text: v.string(),
});

// Create client
const client = wsClient({ url: "wss://api.example.com/ws" });

await client.connect();

// Join a room
client.send(JoinRoom, {
  roomId: "room-123",
  username: "Alice",
});

// Listen for users joining
client.on(UserJoined, (payload) => {
  // ✅ payload.username and userCount are fully typed
  console.log(`${payload.username} joined (${payload.userCount} users)`);
});

// Send a message
client.send(SendMessage, { text: "Hello everyone!" });

// Listen for messages
client.on(NewMessage, (payload) => {
  console.log(`${payload.username}: ${payload.text}`);
});
```

## Migration from Zod to Valibot

1. **Replace imports:**

```typescript
// Before
import { z, message, createRouter } from "@ws-kit/zod";

// After
import { v, message, createRouter } from "@ws-kit/valibot";
```

2. **Update validators:**

```typescript
// Before (Zod)
import { z } from "@ws-kit/zod";
z.string().min(3).max(20).email();

// After (Valibot)
import { v } from "@ws-kit/valibot";
v.pipe(v.string(), v.minLength(3), v.maxLength(20), v.email());
```

3. **Update client imports:**

```typescript
// Before
import { wsClient } from "@ws-kit/client/zod";

// After
import { wsClient } from "@ws-kit/client/valibot";
```

## Import Patterns

Always use the canonical import source to prevent dual-package hazards:

```typescript
// ✅ CORRECT: Single source
import { v, message, createRouter } from "@ws-kit/valibot";

// ❌ AVOID: Mixing imports
import * as v from "valibot"; // Different instance
import { message } from "@ws-kit/valibot"; // Uses @ws-kit/valibot's v
// Discriminated unions will break!
```

## Performance Tips

Valibot's functional API enables excellent tree-shaking:

```typescript
// ✅ CORRECT: Import from @ws-kit/valibot for consistency
import { v } from "@ws-kit/valibot";

const username = v.pipe(
  v.string(),
  v.minLength(3),
  v.maxLength(20),
  // Additional validators only if needed
);

// Unused validators are automatically eliminated by bundlers
// Only the validators you use are included in your bundle
```

## See Also

- `docs/message-schemas.md` — Message schema details
- `docs/examples.md` — Real-world example code
- `docs/client-setup.md` — Client setup and usage
- [@ws-kit/valibot on GitHub](https://github.com/kriasoft/ws-kit/tree/main/packages/valibot) — Package details
