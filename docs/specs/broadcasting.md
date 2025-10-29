# Broadcasting and Topic Subscriptions

**Status**: ✅ Implemented

## Overview

Broadcasting enables multicast messaging to multiple WebSocket clients via topic subscriptions. Uses Bun's native WebSocket pubsub (`subscribe()`, `publish()`, `unsubscribe()`).

**Key patterns**:

- **Unicast**: `ctx.send()` sends to single connection (see @router.md#Type-Safe-Sending)
- **Multicast**: `publish()` broadcasts to topic subscribers (this spec)

## Bun Native WebSocket PubSub

Bun provides built-in PubSub via `subscribe()`, `publish()`, `unsubscribe()`:

```typescript
router.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  // Subscribe to topic
  ctx.ws.subscribe(roomId);

  // Publish to topic (raw string)
  ctx.ws.publish(
    roomId,
    JSON.stringify({
      type: "USER_JOINED",
      meta: { timestamp: Date.now() }, // Producer time (UI display); server logic uses ctx.receivedAt
      payload: { roomId, userId: ctx.ws.data.userId },
    }),
  );
});

router.onClose((ctx) => {
  const roomId = ctx.ws.data.roomId;
  if (roomId) {
    ctx.ws.unsubscribe(roomId);
  }
});
```

## Type-Safe Publish Helper

```typescript
import { publish } from "@ws-kit/zod/publish";

publish(ws, topic, schema, payload, metaOrOpts?);
// Validates message against schema before publishing
```

**Signature**:

```typescript
// zod/publish.ts
export function publish<Schema extends MessageSchemaType>(
  ws: ServerWebSocket,
  topic: string,
  schema: Schema,
  payload: z.infer<Schema["shape"]["payload"]>,
  metaOrOpts?:
    | Partial<z.infer<Schema["shape"]["meta"]>>
    | {
        origin?: string; // Field name in ws.data (e.g., "userId")
        key?: string; // Meta field name, defaults to "senderId"
      },
);
```

**Implementation**:

```typescript
// zod/publish.ts
export function publish<Schema extends MessageSchemaType>(
  ws: ServerWebSocket,
  topic: string,
  schema: Schema,
  payload: z.infer<Schema["shape"]["payload"]>,
  metaOrOpts?:
    | Partial<z.infer<Schema["shape"]["meta"]>>
    | { origin?: string; key?: string },
): boolean {
  let meta: Record<string, any> = { timestamp: Date.now() }; // Producer time (UI display); server logic uses ctx.receivedAt

  // Handle origin option for sender tracking
  if (metaOrOpts && "origin" in metaOrOpts) {
    const { origin, key = "senderId", ...rest } = metaOrOpts;
    if (origin && ws.data[origin] !== undefined) {
      meta[key] = ws.data[origin];
    }
    Object.assign(meta, rest);
  } else {
    Object.assign(meta, metaOrOpts);
  }

  const message = {
    type: schema.shape.type.value,
    meta,
    payload,
  };

  const result = schema.safeParse(message);
  if (!result.success) {
    console.error("Publish validation failed", result.error);
    return false;
  }

  ws.publish(topic, JSON.stringify(result.data));
  return true;
}
```

**Broadcast metadata**:

- `timestamp`: Automatically added by `publish()` (producer time for UI display; **server logic MUST use `ctx.receivedAt`**, not `meta.timestamp` — see @schema.md#Which-timestamp-to-use)
- `clientId`: **MUST NOT be injected** (connection identity, not broadcast metadata)
- Custom meta: Merge via optional `meta` parameter
- Origin tracking: Use `origin` option to inject sender identity

## Origin Option: Sender Tracking

The `origin` option injects sender identity from `ws.data` into broadcast `meta`:

```typescript
// Without origin (manual):
publish(
  ctx.ws,
  "room:123",
  ChatMessage,
  { text: "hi" },
  { senderId: ctx.ws.data.userId },
);

// With origin (automatic):
publish(ctx.ws, "room:123", ChatMessage, { text: "hi" }, { origin: "userId" }); // Injects meta.senderId = ws.data.userId

// Custom meta field:
publish(
  ctx.ws,
  "room:123",
  ChatMessage,
  { text: "hi" },
  { origin: "userId", key: "authorId" },
); // Injects meta.authorId
```

**Behavior:**

- `origin`: Field name in `ws.data` (string); injects as `meta[key ?? "senderId"]`
- `key`: Meta field name (defaults to `"senderId"`)
- **If `ws.data[origin]` is `undefined`, no injection occurs (no-op)**
- `clientId` is **never** injected (use `origin` for application-level identity)

**Performance:** Derived identity MUST be computed during `upgrade()` and stored in `ws.data`. Function extractors are NOT supported (hot-path performance). See @test-requirements.md#Runtime-Testing for no-op behavior validation.

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
router.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  ctx.ws.data.roomId = roomId;
  ctx.ws.subscribe(roomId);

  // Direct reply to sender (unicast)
  ctx.send(JoinedRoom, { roomId });

  // Broadcast to room (multicast, including sender)
  publish(
    ctx.ws,
    roomId,
    UserJoined,
    { roomId },
    { origin: "userId" }, // ✅ Canonical pattern: DX sugar for origin
  );
});
```

**Key distinction**:

- `ctx.send()`: Sends to single connection (unicast)
- `publish()`: Broadcasts to topic subscribers (multicast)
- Both add `timestamp` to `meta` automatically

**Origin tracking pattern**:

- **Prefer**: `meta.senderId` for message origin (keeps payload focused on business data)
- **Alternative**: Including origin in payload (e.g., `{ userId }`) is acceptable but less uniform across messages

### Topic Naming

- **Room-based**: `room:${roomId}`
- **User-based**: `user:${userId}`
- **Global**: `global`

### Cleanup on Disconnect

```typescript
router.onClose((ctx) => {
  const { roomId, userId } = ctx.ws.data;

  if (roomId) {
    // Unsubscribe from room
    ctx.ws.unsubscribe(roomId);

    // Notify others
    publish(ctx.ws, roomId, UserLeft, { roomId }, { origin: "userId" });
  }
});
```

## Key Constraints

> See @rules.md for complete rules. Critical for pubsub:

1. **Validate before broadcast** — Use `publish()` helper, not raw `ws.publish()` (see @rules.md#messaging)
2. **Origin tracking** — Use `{ origin: "userId" }` option for sender identity; NEVER broadcast `clientId` (see @broadcasting.md#Origin-Option)
3. **Unicast vs multicast** — `ctx.send()` = single connection; `publish()` = topic subscribers (see @broadcasting.md#Patterns)
4. **Auto-timestamp** — Both inject `timestamp` to `meta` automatically (see @router.md#Type-Safe-Sending)
5. **Cleanup required** — Unsubscribe in `onClose()` handler; store topic IDs in `ctx.ws.data` (see @rules.md#lifecycle)
