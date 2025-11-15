# Quick-Start Example

A minimal chat room example demonstrating WS-Kit's core features: type-safe message routing, pub/sub broadcasting, and connection data management.

## Features

- **Type-safe routing**: Messages are fully typed from schema to handler
- **Pub/Sub broadcasting**: Room members receive messages via topic subscriptions
- **Connection data**: Track per-connection state (client ID, room) without globals
- **Clean patterns**: Familiar async/await syntax, no callbacks

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.3.2 or later

### Install Dependencies

From the workspace root:

```bash
bun install
```

This installs all workspace packages and makes `@ws-kit/*` available to the example.

### Run the Dev Server

```bash
bun --filter @examples/quick-start dev
```

Or from this directory:

```bash
bun run dev
```

The server starts on `ws://localhost:3000` by default.

**Tip**: If port 3000 is busy, use a different port:

```bash
PORT=4000 bun run dev
```

Or let the OS choose any available port:

```bash
PORT=0 bun run dev
```

## Testing

### Run the Smoke Test

Verifies that the server accepts connections and routes messages correctly:

**Terminal 1 — Start the server:**

```bash
bun run dev
```

**Terminal 2 — Run the test:**

```bash
bun run smoke
```

This opens a WebSocket client, sends `JoinRoom` and `SendMessage`, verifies the responses, and exits.

**Or run both in one command:**

```bash
# Start server in background
bun run dev &

# Wait a moment and run test
sleep 1 && bun run smoke
```

To test against a different server URL:

```bash
WS_URL=ws://localhost:4000 bun run smoke
```

### Manual Testing

Connect a WebSocket client to `ws://localhost:3000` and send JSON messages:

**Join a room:**

```json
{
  "type": "JOIN_ROOM",
  "meta": { "timestamp": 1234567890 },
  "payload": { "roomId": "general" }
}
```

**Response (sent back to you):**

```json
{
  "type": "USER_JOINED",
  "payload": {
    "roomId": "general",
    "userId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

Also broadcasts to other members in the room (same `USER_JOINED` message).

**Send a message:**

```json
{
  "type": "SEND_MESSAGE",
  "meta": { "timestamp": 1234567890 },
  "payload": { "roomId": "general", "text": "Hello!" }
}
```

**Response (broadcast to all members):**

```json
{
  "type": "NEW_MESSAGE",
  "payload": {
    "roomId": "general",
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello!",
    "timestamp": 1234567890
  }
}
```

### Browser Client

Use your browser's developer tools console:

```javascript
const ws = new WebSocket("ws://localhost:3000");
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "JOIN_ROOM",
      meta: { timestamp: Date.now() },
      payload: { roomId: "general" },
    }),
  );
};
ws.onmessage = (evt) => console.log(JSON.parse(evt.data));
```

Or use `wscat`:

```bash
npm install -g wscat
wscat -c ws://localhost:3000
```

## Code Overview

### Message Definitions (`schema.ts`)

All message types are defined in one place with full schema validation:

```typescript
export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
});

export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string(),
});
```

### Handlers (`chat.ts`)

Handlers receive type-safe payloads. No assertions needed:

```typescript
chatRouter.on(JoinRoom, async (c) => {
  const { roomId } = c.payload; // ✅ Fully typed

  // Subscribe to broadcasts on this topic
  await c.topics.subscribe(`room:${roomId}`);

  // Send acknowledgement to this client only
  c.send(UserJoined, {
    roomId,
    userId: c.clientId,
  });

  // Broadcast to all subscribers
  await chatRouter.publish(`room:${roomId}`, UserJoined, {
    roomId,
    userId: c.clientId,
  });
});
```

Key patterns:

- `c.payload` — message data (validated)
- `c.send()` — send to current connection only
- `c.publish()` — broadcast to topic subscribers
- `c.topics.subscribe()` — join a topic
- `c.data` — connection metadata (e.g., clientId, roomId)
- `c.clientId` — connection identity (always available)

### Server Setup (`index.ts`)

Merge routers and serve:

```typescript
const router = createRouter<{ roomId?: string; clientId: string }>();
router.merge(chatRouter);

serve(router, {
  port: parseInt(process.env.PORT || "3000"),
  authenticate() {
    return { clientId: crypto.randomUUID() };
  },
});
```

## Next Steps

- Read [the full API docs](../../docs/specs/router.md) for request/response (RPC), middleware, error handling
- Explore other [examples](../) for patterns like flow control, delta sync, state channels
- Check [the docs](../../docs/specs/) for architectural patterns and best practices

## Troubleshooting

**Port already in use?**

```bash
PORT=0 bun run dev
```

Lets the OS pick any available port. Check the console for the actual URL.

**Connection refused?**

Make sure the dev server is running in another terminal:

```bash
bun run dev
```

**Messages not routing?**

- Check the server console for handler logs
- Ensure message `type` matches a registered handler
- Verify payload schema (missing required fields will be rejected)

## License

MIT
