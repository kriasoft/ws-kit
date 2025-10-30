// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Example of using the type-safe browser client
 * NOTE: This example demonstrates the client API. For actual browser usage,
 * import from "@ws-kit/client/zod" (not available in this server-side example).
 */

import { z, message, wsClient } from "@ws-kit/client/zod";

/**
 * Browser client usage example
 * In a real browser environment, you would:
 *
 * import { z, message, wsClient } from "@ws-kit/client/zod";
 * import { JoinRoomMessage, SendChatMessage, ... } from "./shared/schemas";
 */
export function exampleBrowserClient() {
  // Note: This is pseudocode since we can't actually run browser code here
  // Schemas would be defined and shared between client and server in real app
  /*
  // Define schemas (would be shared with server in real app)
  const JoinRoomMessage = message("JOIN_ROOM", {
    roomId: z.string(),
  });

  const UserJoinedMessage = message("USER_JOINED", {
    roomId: z.string(),
    userId: z.string(),
  });

  const SendChatMessage = message("SEND_MESSAGE", {
    roomId: z.string(),
    text: z.string(),
  });

  const NewMessageReceived = message("NEW_MESSAGE", {
    roomId: z.string(),
    userId: z.string(),
    text: z.string(),
    timestamp: z.number(),
  });

  const PingMessage = message("PING");
  const PongMessage = message("PONG", {
    timestamp: z.number(),
  });

  // Client setup and usage
  const client = wsClient({
    url: "wss://api.example.com/ws",
    reconnect: { enabled: true },
    auth: {
      getToken: () => localStorage.getItem("access_token"),
      attach: "query",
    },
  });

  // Wait for connection
  await client.connect();

  // Send fire-and-forget message
  client.send(JoinRoomMessage, { roomId: "general" });

  // Receive messages with type safety
  client.on(UserJoinedMessage, (msg) => {
    console.log(`User ${msg.payload.userId} joined ${msg.payload.roomId}`);
  });

  client.on(NewMessageReceived, (msg) => {
    console.log(`[${msg.payload.roomId}] ${msg.payload.userId}: ${msg.payload.text}`);
  });

  // Request/response pattern
  const reply = await client.request(
    PingMessage,
    undefined,
    PongMessage,
    { timeoutMs: 5000 }
  );
  console.log("Pong received at:", reply.payload.timestamp);

  // Send chat message with correlation ID
  client.send(SendChatMessage, {
    roomId: "general",
    text: "Hello, everyone!",
  }, {
    correlationId: crypto.randomUUID(),
  });

  // Cleanup
  await client.close({ code: 1000, reason: "Done" });
  */
}

/**
 * Alternative example: Manual WebSocket with message helper
 * For browsers, the wsClient() API above is recommended.
 * This shows how to work with raw WebSocket connections.
 */
export function exampleManualWebSocket() {
  const PingMessage = message("PING");
  const JoinRoomMessage = message("JOIN_ROOM", {
    roomId: z.string(),
  });

  const ws = new WebSocket("ws://localhost:3000/ws");

  ws.onopen = () => {
    console.log("Connected to server");

    // Send a ping message without payload
    ws.send(
      JSON.stringify({
        type: "PING",
        meta: { timestamp: Date.now() },
      }),
    );

    // Join a room
    ws.send(
      JSON.stringify({
        type: "JOIN_ROOM",
        meta: { timestamp: Date.now() },
        payload: { roomId: "general" },
      }),
    );
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log("Received:", message);
  };

  ws.onclose = () => {
    console.log("Disconnected");
  };
}

/**
 * Example: Authentication with type-safe schemas
 */
export function exampleAuthentication(ws: WebSocket) {
  const AuthMessage = message("AUTH", {
    username: z.string(),
    password: z.string(),
  });

  // Send auth message
  ws.send(
    JSON.stringify({
      type: "AUTH",
      meta: { timestamp: Date.now() },
      payload: { username: "user123", password: "secure-pass" },
    }),
  );
}

/**
 * Example: Union types for different message variants
 */
export function exampleActionMessages(ws: WebSocket) {
  const ActionMessage = message("ACTION", {
    action: z.union([
      z.literal("start"),
      z.literal("stop"),
      z.literal("pause"),
    ]),
    gameId: z.string().optional(),
    reason: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  });

  // Start action
  ws.send(
    JSON.stringify({
      type: "ACTION",
      meta: { timestamp: Date.now() },
      payload: {
        action: "start",
        gameId: "game123",
      },
    }),
  );

  // Pause action
  ws.send(
    JSON.stringify({
      type: "ACTION",
      meta: { timestamp: Date.now() },
      payload: {
        action: "pause",
        position: { x: 10, y: 20 },
      },
    }),
  );

  // Stop action
  ws.send(
    JSON.stringify({
      type: "ACTION",
      meta: { timestamp: Date.now() },
      payload: {
        action: "stop",
        reason: "User requested",
      },
    }),
  );
}
