# Broadcasting and Topic Subscriptions

**Status**: ✅ Implemented

## Overview

Broadcasting enables multicast messaging to multiple WebSocket clients via topic subscriptions. Uses Bun's native WebSocket pubsub (`subscribe()`, `publish()`, `unsubscribe()`).

**Key patterns**:

- **Unicast**: `ctx.send()` sends to single connection (see @router.md#Type-Safe-Sending)
- **Multicast**: `publish()` broadcasts to topic subscribers (this spec)
- **Throttled Broadcast**: Coalesce rapid publishes to reduce bandwidth 80-95% (see @patterns.md#Throttled-Broadcast-Pattern, ADR-010)

## Type-Safe Publishing with `router.publish()`

The router provides a type-safe `publish()` method for broadcasting validated messages:

```typescript
import { createRouter, message } from "@ws-kit/zod";

const UserJoined = message("USER_JOINED", { roomId: z.string() });
const router = createRouter<AppData>();

router.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  // Subscribe to topic (adapter-dependent)
  ctx.subscribe(roomId);

  // Publish type-safe message to topic
  router.publish(roomId, UserJoined, {
    roomId,
  });
});

router.onClose((ctx) => {
  const roomId = ctx.ws.data.roomId;
  if (roomId) {
    // Unsubscribe from topic
    ctx.unsubscribe(roomId);
  }
});
```

## Context Methods: Subscribe / Unsubscribe

Use `ctx.subscribe()` and `ctx.unsubscribe()` for topic management:

```typescript
router.onMessage(JoinRoom, (ctx) => {
  const roomId = ctx.payload.roomId;

  // Subscribe to room updates
  ctx.subscribe(`room:${roomId}`);

  // Store for cleanup (optional, depends on adapter)
  ctx.assignData({ roomId });
});

router.onClose((ctx) => {
  // Clean up subscriptions
  if (ctx.ws.data.roomId) {
    ctx.unsubscribe(`room:${ctx.ws.data.roomId}`);
  }
});
```

**Semantics:**

- `ctx.subscribe(topic)` - Subscribe connection to a topic (adapter-dependent)
- `ctx.unsubscribe(topic)` - Unsubscribe connection from a topic
- Subscriptions are per-connection, not per-router
- Adapter support varies (Bun: in-process, Cloudflare DO: scoped to instance, Redis: full pub/sub)

## Origin Option: Sender Tracking {#Origin-Option}

Include sender identity in broadcasts via extended meta schemas:

```typescript
// Define extended meta to include sender ID
const ChatMessage = message(
  "CHAT",
  { text: z.string() },
  { senderId: z.string().optional() }, // Extended meta
);

router.onMessage(SendChat, (ctx) => {
  router.publish(
    `room:${ctx.ws.data.roomId}`,
    ChatMessage,
    { text: ctx.payload.text },
    // Add sender ID to meta
    { senderId: ctx.ws.data.userId },
  );
});
```

Or use connection data directly when sender identity is always available:

```typescript
const ChatMessage = message(
  "CHAT",
  { text: z.string(), userId: z.string() }, // Include in payload
);

router.onMessage(SendChat, (ctx) => {
  router.publish(`room:${ctx.ws.data.roomId}`, ChatMessage, {
    text: ctx.payload.text,
    userId: ctx.ws.data.userId, // Include sender
  });
});
```

**Pattern**:

- **Include in extended meta** — For optional metadata about the message source
- **Include in payload** — For data that's essential to the message semantics
- **Never broadcast `clientId`** — It's transport-layer identity, not application identity

**Broadcast metadata**:

- `timestamp`: Automatically added by `router.publish()` (producer time for UI display; **server logic MUST use `ctx.receivedAt`**, not `meta.timestamp` — see @schema.md#Which-timestamp-to-use)
- `clientId`: **MUST NOT be included** (connection identity, not broadcast metadata)
- Custom meta: Merge via optional `meta` parameter
- Origin tracking: Include sender identity in extended meta or payload

## When to Track Message Origin

**Use `origin` option when:**

- Broadcasting chat messages (need sender for UI display)
- Audit logs (need actor identity)
- Access control checks in handlers (need message originator)

**Don't use `origin` when:**

- System notifications (no sender concept)
- Server-initiated broadcasts (no client origin)
- Origin is already in payload (avoid duplication)

## Patterns

### Room Management

```typescript
import { createRouter, message } from "@ws-kit/zod";

const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const UserJoined = message("USER_JOINED", {
  roomId: z.string(),
  userId: z.string(),
});
const JoinedAck = message("JOINED", { roomId: z.string() });

const router = createRouter<{ roomId?: string; userId?: string }>();

router.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  // Update connection data
  ctx.assignData({ roomId });

  // Subscribe to room updates
  ctx.subscribe(`room:${roomId}`);

  // Direct reply to sender (unicast)
  ctx.send(JoinedAck, { roomId });

  // Broadcast to room (multicast)
  router.publish(`room:${roomId}`, UserJoined, {
    roomId,
    userId: ctx.ws.data.userId || "anon",
  });
});
```

**Key distinction**:

- `ctx.send()`: Sends to single connection (unicast)
- `router.publish()`: Broadcasts to topic subscribers (multicast)
- Both add `timestamp` to `meta` automatically

### Topic Naming

- **Room-based**: `room:${roomId}`
- **User-based**: `user:${userId}`
- **Global**: `global`

### Cleanup on Disconnect

```typescript
router.onClose((ctx) => {
  const roomId = ctx.ws.data.roomId;

  if (roomId) {
    // Unsubscribe from room
    ctx.unsubscribe(`room:${roomId}`);

    // Notify others (if needed)
    router.publish(`room:${roomId}`, UserLeft, {
      roomId,
      userId: ctx.ws.data.userId || "anon",
    });
  }
});
```

## Throttled Broadcasting

For applications with rapid updates (live cursors, presence, frequent state changes), use throttled publishing to coalesce messages and reduce bandwidth overhead:

```typescript
import { createRouter } from "@ws-kit/zod";
import { createThrottledPublish } from "@ws-kit/core";

const router = createRouter();

// Wrap router.publish() with throttle (50ms window)
const throttledPublish = createThrottledPublish(
  router.publish.bind(router),
  50, // milliseconds
);

router.onMessage(CursorMove, (ctx) => {
  // Instead of router.publish(), use throttled version
  throttledPublish(`room:${ctx.ws.data.roomId}`, {
    clientId: ctx.ws.data.clientId,
    x: ctx.payload.x,
    y: ctx.payload.y,
  });
});
```

**Benefits**:

- **Bandwidth reduction**: Typically 80-95% fewer messages in rapid update scenarios (depends on throttle window and update frequency)
- **Lower latency**: Single coalesced broadcast instead of many small ones
- **Fair**: Slower networks naturally handle smaller batches

**Trade-offs**:

- **Latency**: Up to 50ms delay for updates (acceptable for cursor/presence UX)
- **Batch handling**: Clients must handle `{ batch: [...] }` wrapper for multiple messages

For detailed guidance, implementation examples, and detailed trade-off analysis, see @patterns.md#Throttled-Broadcast-Pattern (ADR-010).

## Key Constraints

> See @rules.md for complete rules. Critical for pubsub:

1. **Validate before broadcast** — Use `router.publish()`, not raw `ctx.ws.publish()` (see @rules.md#messaging)
2. **Origin tracking** — Include sender identity in extended meta or payload; NEVER broadcast `clientId` (see @broadcasting.md#Origin-Option)
3. **Unicast vs multicast** — `ctx.send()` = single connection; `router.publish()` = topic subscribers (see @broadcasting.md#Patterns)
4. **Auto-timestamp** — Both inject `timestamp` to `meta` automatically (see @router.md#Type-Safe-Sending)
5. **Cleanup required** — Unsubscribe in `onClose()` handler; store topic IDs in `ctx.ws.data` via `ctx.assignData()` (see @rules.md#lifecycle)
6. **Subscription context** — `ctx.subscribe()` and `ctx.unsubscribe()` manage connection subscriptions (adapter-dependent behavior)
