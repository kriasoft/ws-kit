// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Example of using the type-safe browser client
 * NOTE: This example demonstrates the client API. For actual browser usage,
 * import from "@ws-kit/client" (not available in this server-side example).
 */

import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z);

/**
 * Browser client usage example
 * In a real browser environment, you would:
 *
 * import { createClient } from "@ws-kit/client";
 * import { JoinRoomMessage, SendChatMessage, ... } from "./shared/schemas";
 */
export function exampleBrowserClient() {
  // Note: This is pseudocode since we can't actually run browser code here
  // Schemas would be defined and shared between client and server in real app
  /*
  // Define schemas (would be shared with server in real app)
  const JoinRoomMessage = messageSchema("JOIN_ROOM", {
    roomId: z.string(),
  });

  const UserJoinedMessage = messageSchema("USER_JOINED", {
    roomId: z.string(),
    userId: z.string(),
  });

  const SendChatMessage = messageSchema("SEND_MESSAGE", {
    roomId: z.string(),
    text: z.string(),
  });

  const NewMessageReceived = messageSchema("NEW_MESSAGE", {
    roomId: z.string(),
    userId: z.string(),
    text: z.string(),
    timestamp: z.number(),
  });

  const PingMessage = messageSchema("PING");
  const PongMessage = messageSchema("PONG", {
    timestamp: z.number(),
  });

  // Client setup and usage
  const client = createClient({
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
 * Legacy example: Manual WebSocket with createMessage helper
 * This approach is still supported but the createClient API is recommended for browsers.
 */
export function exampleManualWebSocket() {
  const { createMessage } = createMessageSchema(z);

  const PingMessage = messageSchema("PING");
  const JoinRoomMessage = messageSchema("JOIN_ROOM", {
    roomId: z.string(),
  });

  const ws = new WebSocket("ws://localhost:3000/ws");

  ws.onopen = () => {
    console.log("Connected to server");

    // Send a ping message without payload
    const ping = createMessage(PingMessage, undefined);
    if (ping.success) {
      ws.send(JSON.stringify(ping.data));
    }

    // Join a room
    const joinMsg = createMessage(JoinRoomMessage, { roomId: "general" });
    if (joinMsg.success) {
      ws.send(JSON.stringify(joinMsg.data));
    }
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
 * Legacy example: Authentication with complex schemas using createMessage
 */
export function exampleAuthentication(ws: WebSocket) {
  const { createMessage } = createMessageSchema(z);

  const AuthMessage = messageSchema("AUTH", {
    username: z.string(),
    password: z.string(),
  });

  const authMsg = createMessage(
    AuthMessage,
    { username: "user123", password: "secure-pass" },
    { timestamp: Date.now() },
  );

  if (authMsg.success) {
    ws.send(JSON.stringify(authMsg.data));
  } else {
    // Handle validation errors
    console.error("Invalid auth data:", authMsg.error.issues);
  }
}

/**
 * Legacy example: Union types for different message variants
 */
export function exampleActionMessages(ws: WebSocket) {
  const { createMessage } = createMessageSchema(z);

  const ActionMessage = messageSchema("ACTION", {
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
  const startMsg = createMessage(ActionMessage, {
    action: "start",
    gameId: "game123",
  });

  // Pause action
  const pauseMsg = createMessage(ActionMessage, {
    action: "pause",
    position: { x: 10, y: 20 },
  });

  // Stop action
  const stopMsg = createMessage(ActionMessage, {
    action: "stop",
    reason: "User requested",
  });

  // Send all messages
  [startMsg, pauseMsg, stopMsg].forEach((msg) => {
    if (msg.success) {
      ws.send(JSON.stringify(msg.data));
    }
  });
}
