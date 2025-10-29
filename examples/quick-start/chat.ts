// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createZodRouter } from "@ws-kit/zod";
import {
  JoinRoom,
  NewMessage,
  SendMessage,
  UserJoined,
  UserLeft,
} from "./schema";

// Store active room connections for later use
type WebSocketData = { roomId?: string; clientId?: string } & Record<
  string,
  unknown
>;

const chatRouter = createZodRouter<WebSocketData>();

chatRouter.onMessage(JoinRoom, async (c) => {
  const { roomId } = c.payload; // ✅ Fully typed, no assertion needed
  const clientId = c.ws.data?.clientId; // Connection identity (not in meta)

  // Store roomId in connection data for use in onClose handler
  if (c.ws.data) {
    c.ws.data.roomId = roomId;
  }

  console.log(`Client ${clientId} joined room: ${roomId}`);

  // Send confirmation back to the user who joined
  c.send(UserJoined, {
    roomId,
    userId: clientId,
  });

  // Broadcast to other users in the room that someone joined
  await chatRouter.publish(roomId, {
    type: "USER_JOINED",
    meta: {},
    payload: {
      roomId,
      userId: clientId,
    },
  });
});

chatRouter.onMessage(SendMessage, async (c) => {
  const { roomId, text } = c.payload; // ✅ Fully typed, no assertion needed
  const clientId = c.ws.data?.clientId; // Connection identity (not in meta)
  console.log(`Message from ${clientId} in room ${roomId}: ${text}`);

  // Broadcast message to all subscribers, validating with schema
  await chatRouter.publish(roomId, {
    type: "NEW_MESSAGE",
    meta: {},
    payload: {
      roomId,
      userId: clientId,
      text,
      timestamp: Date.now(),
    },
  });
});

chatRouter.onClose((c) => {
  const clientId = c.ws.data?.clientId;
  const roomId = (c.ws.data as any)?.roomId;

  console.log(`Connection closed: ${clientId}`);

  // If user was in a room, notify others they left
  if (roomId && clientId) {
    // Broadcast user left notification
    void chatRouter.publish(roomId, {
      type: "USER_LEFT",
      meta: {},
      payload: {
        roomId,
        userId: clientId,
      },
    });

    console.log(`User ${clientId} left room: ${roomId}`);
  }
});

export { chatRouter };
