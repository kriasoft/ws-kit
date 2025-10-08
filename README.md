# Bun WebSocket Router

[![npm version](https://img.shields.io/npm/v/bun-ws-router.svg)](https://www.npmjs.com/package/bun-ws-router)
[![npm downloads](https://img.shields.io/npm/dm/bun-ws-router.svg)](https://www.npmjs.com/package/bun-ws-router)
[![GitHub Actions](https://github.com/kriasoft/bun-ws-router/actions/workflows/main.yml/badge.svg)](https://github.com/kriasoft/bun-ws-router/actions)
[![Chat on Discord](https://img.shields.io/discord/643523529131950086?label=Discord)](https://discord.gg/aW29wXyb7w)

Type-safe WebSocket communication for Bun servers and browsers with **Zod** or **Valibot** validation. Routes messages to handlers with full TypeScript support on both server and client.

### Key Features

**Server (Bun)**

- 🔒 Type-safe message routing with Zod/Valibot validation
- 🚀 Built on Bun's native WebSocket implementation
- 📡 PubSub with schema-validated broadcasts
- 🧩 Composable routers and middleware support

**Client (Browser)**

- 🔄 Auto-reconnection with exponential backoff
- 📦 Configurable offline message queueing
- ⏱️ Request/response pattern with timeouts
- 🔐 Built-in auth (query param or protocol header)

**Shared**

- ✨ Shared schemas between server and client
- ⚡ Choose Zod (familiar) or Valibot (60-80% smaller)
- 🔒 Full TypeScript inference on both sides

## Installation

Choose your validation library:

```bash
# With Zod
bun add bun-ws-router zod
bun add @types/bun -D

# With Valibot (60-80% smaller bundles)
bun add bun-ws-router valibot
bun add @types/bun -D
```

## Getting Started

The following example demonstrates how to set up a Bun server with both (RESTful) HTTP and WebSocket routers.

```ts
import { Hono } from "hono";
import { WebSocketRouter } from "bun-ws-router/zod"; // Explicit Zod import
import { exampleRouter } from "./example";

// HTTP router
const app = new Hono();
app.get("/", (c) => c.text("Welcome to Hono!"));

// WebSocket router
const ws = new WebSocketRouter();
ws.addRoutes(exampleRouter); // Add routes from another file

Bun.serve({
  port: 3000,

  fetch(req, server) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade requests
    if (url.pathname === "/ws") {
      return ws.upgrade(req, {
        server,
      });
    }

    // Handle regular HTTP requests
    return app.fetch(req, { server });
  },

  // Handle WebSocket connections
  websocket: ws.websocket,
});

console.log(`WebSocket server listening on ws://localhost:3000/ws`);
```

## Validation Libraries

You can choose between Zod and Valibot validators using different import paths:

```ts
// Zod - mature ecosystem, method chaining
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { z } from "zod";
const { messageSchema } = createMessageSchema(z);

// Valibot - 90% smaller bundles, functional pipelines
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/valibot";
import * as v from "valibot";
const { messageSchema } = createMessageSchema(v);
```

### Quick Comparison

| Feature     | Zod                      | Valibot                  |
| ----------- | ------------------------ | ------------------------ |
| Bundle Size | ~5-6 kB (Zod v4)         | ~1-2 kB                  |
| Performance | Baseline                 | ~2x faster               |
| API Style   | Method chaining          | Functional               |
| Best for    | Server-side, familiarity | Client-side, performance |

## How to handle authentication

You can handle authentication by checking the `Authorization` header for a JWT token or any other authentication method you prefer. The following example demonstrates how to verify a JWT token and pass the user information to the WebSocket router.

```ts
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { DecodedIdToken } from "firebase-admin/auth";

const { messageSchema } = createMessageSchema(z);
import { verifyIdToken } from "./auth"; // Your authentication logic

type Meta = {
  user?: DecodedIdToken | null;
};

// WebSocket router
const ws = new WebSocketRouter<Meta>();

Bun.serve({
  port: 3000,

  async fetch(req, server) {
    const url = new URL(req.url);

    // Check if the user is authenticated
    const user = await verifyIdToken(req);

    // Handle WebSocket upgrade requests
    if (url.pathname === "/ws") {
      return ws.upgrade(req, {
        server,
        data: { user },
      });
    }

    // Handle regular HTTP requests
    return await app.fetch(req, { server, user });
  },

  // Handle WebSocket connections
  websocket: ws.websocket,
});
```

The `verifyIdToken` function is a placeholder for your authentication logic which could use user ID token verification from `firebase-admin` or any other authentication library.

By verifying the user before the WebSocket connection is established and passing the `user` data, you ensure that only authenticated users can connect, and you have their info ready to use in your `onOpen`, `onMessage`, and `onClose` handlers.

## How to define message types

To define message types, first create a message schema factory using your validation library, then use it to define your message schemas. This approach ensures proper TypeScript support and avoids dual package hazard issues.

### With Zod

```ts
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

// Create the message schema factory with your Zod instance
const { messageSchema } = createMessageSchema(z);

// Now define your message types
export const JoinRoom = messageSchema("JOIN_ROOM", {
  roomId: z.string(),
});

export const UserJoined = messageSchema("USER_JOINED", {
  roomId: z.string(),
  userId: z.string(),
});

export const UserLeft = messageSchema("USER_LEFT", {
  userId: z.string(),
});

export const SendMessage = messageSchema("SEND_MESSAGE", {
  roomId: z.string(),
  message: z.string(),
});
```

### With Valibot

```ts
import * as v from "valibot";
import { createMessageSchema } from "bun-ws-router/valibot";

// Create the message schema factory with your Valibot instance
const { messageSchema } = createMessageSchema(v);

// Now define your message types
export const JoinRoom = messageSchema("JOIN_ROOM", {
  roomId: v.string(),
});

export const UserJoined = messageSchema("USER_JOINED", {
  roomId: v.string(),
  userId: v.string(),
});
```

> **Note**: The factory pattern (`createMessageSchema`) ensures that your schemas use the same validation library instance as your application, enabling features like discriminated unions and preventing type conflicts.

## How to define routes

Define routes using the `WebSocketRouter` instance methods: `onOpen`, `onMessage`, and `onClose`.

```ts
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { JoinRoom, UserJoined, SendMessage, UserLeft } from "./schema";

const { messageSchema } = createMessageSchema(z);

// Define custom connection data type
type ConnectionData = {
  userId?: string;
  roomId?: string;
};

const ws = new WebSocketRouter<ConnectionData>();

// Handle new connections
ws.onOpen((ctx) => {
  console.log(`Client connected: ${ctx.ws.data.clientId}`);
  // ctx.ws.data.clientId is always present (UUID v7)
  // Send welcome message if needed
});

// Handle specific message types
ws.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;

  // Store room in connection data
  ctx.ws.data.roomId = roomId;

  // Subscribe to room topic for broadcasts
  ctx.ws.subscribe(roomId);

  console.log(`User ${userId} joined room: ${roomId}`);
  console.log(`Message received at: ${ctx.receivedAt}`); // Server timestamp

  // Send confirmation back to this client
  ctx.send(UserJoined, { roomId, userId });
});

ws.onMessage(SendMessage, (ctx) => {
  const { message } = ctx.payload;
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;
  const roomId = ctx.ws.data.roomId;

  console.log(`Message in room ${roomId} from ${userId}: ${message}`);
  // See "How to broadcast messages" section for broadcasting logic
});

// Handle disconnections
ws.onClose((ctx) => {
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;
  console.log(`Client disconnected: ${userId}, code: ${ctx.code}`);

  if (ctx.ws.data.roomId) {
    // Unsubscribe and notify others (see broadcasting section)
    ctx.ws.unsubscribe(ctx.ws.data.roomId);
  }
});
```

**Handler Context Fields:**

- `ctx.ws` — ServerWebSocket instance with connection data
- `ctx.ws.data.clientId` — Auto-generated UUID v7 (always present)
- `ctx.type` — Message type literal (e.g., `"JOIN_ROOM"`)
- `ctx.payload` — Typed payload (only exists when schema defines it)
- `ctx.meta` — Client-provided metadata (correlationId, timestamp, custom fields)
- `ctx.receivedAt` — Server receive timestamp (use for rate limiting, ordering, TTL)
- `ctx.send()` — Type-safe send function (sends to this client only)

## How to broadcast messages

Broadcasting messages to multiple clients is a common requirement for real-time applications. `bun-ws-router` complements Bun's built-in PubSub functionality with schema validation support.

### Option 1: Using Bun's native WebSocket PubSub

Bun's WebSocket implementation includes built-in support for the PubSub pattern through `subscribe`, `publish`, and `unsubscribe` methods:

```ts
ws.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;

  // Store room ID in connection data
  ctx.ws.data.roomId = roomId;

  // Subscribe the client to the room's topic
  ctx.ws.subscribe(roomId);

  console.log(`User ${userId} joined room: ${roomId}`);

  // Send confirmation back to the user who joined
  ctx.send(UserJoined, { roomId, userId });

  // Broadcast to all other subscribers that a new user joined
  const message = JSON.stringify({
    type: "USER_JOINED",
    meta: { timestamp: Date.now() },
    payload: { roomId, userId },
  });
  ctx.ws.publish(roomId, message);
});

ws.onClose((ctx) => {
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;
  const roomId = ctx.ws.data.roomId;

  if (roomId) {
    // Unsubscribe from room
    ctx.ws.unsubscribe(roomId);

    // Notify others the user has left
    const message = JSON.stringify({
      type: "USER_LEFT",
      meta: { timestamp: Date.now() },
      payload: { userId },
    });
    ctx.ws.publish(roomId, message);
  }
});
```

### Option 2: Using the publish helper function

The library provides a helper function that combines schema validation with publishing:

```ts
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { publish } from "bun-ws-router/zod/publish";
import { JoinRoom, UserJoined, SendMessage, UserLeft } from "./schema";

const { messageSchema } = createMessageSchema(z);

ws.onMessage(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;

  // Store room ID and subscribe to topic
  ctx.ws.data.roomId = roomId;
  ctx.ws.subscribe(roomId);

  // Send confirmation back to the user who joined
  ctx.send(UserJoined, { roomId, userId });

  // Broadcast to other subscribers with schema validation
  publish(ctx.ws, roomId, UserJoined, { roomId, userId });
});

ws.onMessage(SendMessage, (ctx) => {
  const { roomId, message } = ctx.payload;
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;

  console.log(`Message in room ${roomId} from ${userId}: ${message}`);

  // Broadcast the message to all subscribers in the room
  const NewMessage = messageSchema("NEW_MESSAGE", {
    roomId: z.string(),
    userId: z.string(),
    message: z.string(),
  });

  publish(ctx.ws, roomId, NewMessage, {
    roomId,
    userId,
    message,
  });
});

ws.onClose((ctx) => {
  const userId = ctx.ws.data.userId || ctx.ws.data.clientId;
  const roomId = ctx.ws.data.roomId;

  if (roomId) {
    ctx.ws.unsubscribe(roomId);

    // Notify others using the publish helper
    publish(ctx.ws, roomId, UserLeft, { userId });
  }
});
```

The `publish()` function ensures that all broadcast messages are validated against their schemas before being sent, providing the same type safety for broadcasts that you get with direct messaging.

## Error handling and sending error messages

Effective error handling is crucial for maintaining robust WebSocket connections. `bun-ws-router` provides built-in tools for standardized error messages that align with the library's schema validation pattern.

### Using ErrorCode and ErrorMessage schema

The library includes a standardized error schema and predefined error codes:

```ts
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { ErrorMessage, ErrorCode } = createMessageSchema(z);

ws.onMessage(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;

  // Check if room exists
  const roomExists = await checkRoomExists(roomId);
  if (!roomExists) {
    // Send error with standardized code
    ctx.send(ErrorMessage, {
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: `Room ${roomId} does not exist`,
      context: { roomId }, // Optional context for debugging
    });
    return;
  }

  // Continue with normal flow...
  ctx.ws.data.roomId = roomId;
  ctx.ws.subscribe(roomId);
  // ...
});
```

### Custom error handling

You can add your own error handling middleware by using the `onMessage` handler:

```ts
// Error handling in connection setup
ws.onOpen((ctx) => {
  try {
    // Your connection setup logic
    console.log(`Client ${ctx.ws.data.clientId} connected`);
  } catch (error) {
    console.error("Error in connection setup:", error);
    ctx.send(ErrorMessage, {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: "Failed to set up connection",
    });
  }
});

// Error handling in message handlers
ws.onMessage(AuthenticateUser, (ctx) => {
  try {
    // Validate token
    const { token } = ctx.payload;
    const user = validateToken(token);

    if (!user) {
      ctx.send(ErrorMessage, {
        code: ErrorCode.AUTHENTICATION_FAILED,
        message: "Invalid authentication token",
      });
      return;
    }

    // Store user data for future requests
    ctx.ws.data.userId = user.id;
    ctx.ws.data.userRole = user.role;

    // Send success response
    ctx.send(AuthSuccess, { userId: user.id });
  } catch (error) {
    ctx.send(ErrorMessage, {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: "Authentication process failed",
    });
  }
});
```

### Available Error Codes

The built-in `ErrorCode` enum provides consistent error types:

| Error Code                 | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `INVALID_MESSAGE_FORMAT`   | Message isn't valid JSON or lacks required structure  |
| `VALIDATION_FAILED`        | Message failed schema validation                      |
| `UNSUPPORTED_MESSAGE_TYPE` | No handler registered for this message type           |
| `AUTHENTICATION_FAILED`    | Client isn't authenticated or has invalid credentials |
| `AUTHORIZATION_FAILED`     | Client lacks permission for the requested action      |
| `RESOURCE_NOT_FOUND`       | Requested resource (user, room, etc.) doesn't exist   |
| `RATE_LIMIT_EXCEEDED`      | Client is sending messages too frequently             |
| `INTERNAL_SERVER_ERROR`    | Unexpected server error occurred                      |

You can also broadcast error messages to multiple clients using the `publish` function:

```ts
// Notify all users in a room that it's being deleted
publish(ctx.ws, roomId, ErrorMessage, {
  code: ErrorCode.RESOURCE_NOT_FOUND,
  message: "This room is being deleted and will no longer be available",
  context: { roomId },
});
```

## How to compose routes

You can compose routes from different files into a single router. This is useful for organizing your code and keeping related routes together.

```ts
import { z } from "zod";
import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
import { Meta } from "./schemas";

const { messageSchema } = createMessageSchema(z);
import { chatRoutes } from "./chat";
import { notificationRoutes } from "./notification";

const ws = new WebSocketRouter<Meta>();
ws.addRoutes(chatRoutes);
ws.addRoutes(notificationRoutes);
```

Where `chatRoutes` and `notificationRoutes` are other router instances defined in separate files.

## Browser Client

Type-safe browser WebSocket client with automatic reconnection, authentication, and request/response patterns:

```ts
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";
import { createClient } from "bun-ws-router/zod/client"; // ✅ Typed client

// Define schemas (shared with server)
const { messageSchema } = createMessageSchema(z);
const Hello = messageSchema("HELLO", { name: z.string() });
const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

// Create client with auth and reconnection
const client = createClient({
  url: "wss://api.example.com/ws",
  reconnect: { enabled: true },
  auth: {
    getToken: () => localStorage.getItem("access_token"),
    attach: "query", // Appends ?access_token=...
  },
});

await client.connect();

// Send fire-and-forget message
client.send(Hello, { name: "Anna" });

// Receive messages with full type inference
client.on(HelloOk, (msg) => {
  // ✅ msg.payload.text is typed as string
  console.log("Server says:", msg.payload.text);
});

// Request/response pattern with timeout
try {
  const reply = await client.request(Hello, { name: "Bob" }, HelloOk, {
    timeoutMs: 5000,
  });
  // ✅ reply.payload.text is typed as string
  console.log("Reply:", reply.payload.text);
} catch (err) {
  console.error("Request failed:", err);
}
```

See the [Client Documentation](./docs/client-setup.md) for complete API reference and advanced usage.

## Support

Questions or issues? Join us on [Discord](https://discord.gg/aW29wXyb7w).

## Backers

<a href="https://reactstarter.com/b/1"><img src="https://reactstarter.com/b/1.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/2"><img src="https://reactstarter.com/b/2.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/3"><img src="https://reactstarter.com/b/3.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/4"><img src="https://reactstarter.com/b/4.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/5"><img src="https://reactstarter.com/b/5.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/6"><img src="https://reactstarter.com/b/6.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/7"><img src="https://reactstarter.com/b/7.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/8"><img src="https://reactstarter.com/b/8.png" height="60" /></a>

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
