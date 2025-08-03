/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Example of using createMessage helper for client-side WebSocket communication
 */

import { z } from "zod";
import { messageSchema, createMessage } from "../zod";

// Define message schemas
const JoinRoomMessage = messageSchema("JOIN_ROOM", {
  roomId: z.string(),
});

const SendChatMessage = messageSchema("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string(),
});

const PingMessage = messageSchema("PING");

// Client-side usage example
class WebSocketClient {
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.setupHandlers();
  }

  private setupHandlers() {
    this.ws.onopen = () => {
      console.log("Connected to server");

      // Send a ping message without payload
      const ping = createMessage(PingMessage, undefined);
      if (ping.success) {
        this.ws.send(JSON.stringify(ping.data));
      }

      // Join a room
      this.joinRoom("general");
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("Received:", message);
    };
  }

  joinRoom(roomId: string) {
    // Create a JOIN_ROOM message with payload
    const message = createMessage(JoinRoomMessage, { roomId });

    if (message.success) {
      this.ws.send(JSON.stringify(message.data));
      console.log("Joining room:", roomId);
    } else {
      console.error("Failed to create JOIN_ROOM message:", message.error);
    }
  }

  sendMessage(roomId: string, text: string) {
    // Create a SEND_MESSAGE with payload and custom metadata
    const message = createMessage(
      SendChatMessage,
      { roomId, text },
      { correlationId: crypto.randomUUID() }, // Add correlation ID for tracking
    );

    if (message.success) {
      this.ws.send(JSON.stringify(message.data));
      console.log("Sent message to room:", roomId);
    } else {
      console.error("Failed to create message:", message.error);
    }
  }
}

// Usage
const client = new WebSocketClient("ws://localhost:3000");

// Send messages after connection is established
setTimeout(() => {
  client.sendMessage("general", "Hello, everyone!");
}, 1000);

// Example: Authentication with complex schemas
export function exampleAuthentication(ws: WebSocket) {
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

// Example: Union types for different message variants
export function exampleActionMessages(ws: WebSocket) {
  const ActionMessage = messageSchema(
    "ACTION",
    z.union([
      z.object({ action: z.literal("start"), gameId: z.string() }),
      z.object({ action: z.literal("stop"), reason: z.string().optional() }),
      z.object({
        action: z.literal("move"),
        position: z.object({ x: z.number(), y: z.number() }),
      }),
    ]),
  );

  // Start action
  const startMsg = createMessage(ActionMessage, {
    action: "start",
    gameId: "game123",
  });

  // Move action
  const moveMsg = createMessage(ActionMessage, {
    action: "move",
    position: { x: 10, y: 20 },
  });

  // Stop action
  const stopMsg = createMessage(ActionMessage, {
    action: "stop",
    reason: "User requested",
  });

  // Send all messages
  [startMsg, moveMsg, stopMsg].forEach((msg) => {
    if (msg.success) {
      ws.send(JSON.stringify(msg.data));
    }
  });
}
