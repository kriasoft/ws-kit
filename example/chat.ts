import { WebSocketRouter, publish } from "../";
import {
  JoinRoom,
  NewMessage,
  SendMessage,
  UserJoined,
  UserLeft,
} from "./schema";

// Store active room connections for later use
type WebSocketData = { roomId?: string } & Record<string, unknown>;

const ws = new WebSocketRouter<WebSocketData>();

ws.onMessage(JoinRoom, (c) => {
  const { roomId } = c.payload;
  const userId = c.meta.clientId;

  // Store roomId in connection data for use in onClose handler
  c.ws.data.roomId = roomId;

  // Subscribe the client to the room
  c.ws.subscribe(roomId);

  console.log(`User ${userId} joined room: ${roomId}`);

  // Send confirmation back to the user who joined
  c.send(UserJoined, {
    roomId,
    userId,
  });

  // Broadcast to other users in the room that someone joined.
  // Only publish if userId is available.
  if (userId) {
    publish(c.ws, roomId, UserJoined, {
      roomId,
      userId,
    });
  }
});

ws.onMessage(SendMessage, (c) => {
  const { roomId, text } = c.payload;
  const userId = c.meta.clientId;
  console.log(`Message from ${userId} in room ${roomId}: ${text}`);

  // Broadcast message to all subscribers, validating with schema
  // Only publish if userId is available
  if (userId) {
    publish(c.ws, roomId, NewMessage, {
      roomId,
      userId,
      text,
      timestamp: Date.now(),
    });
  }
});

ws.onClose((c) => {
  const clientId = c.ws.data.clientId;
  const roomId = c.ws.data.roomId;

  console.log(`Connection closed: ${clientId}`);

  // If user was in a room, notify others they left
  if (roomId && clientId) {
    // Unsubscribe from the room
    c.ws.unsubscribe(roomId);

    // Broadcast user left notification, validating with schema
    publish(c.ws, roomId, UserLeft, {
      roomId,
      userId: clientId,
    });

    console.log(`User ${clientId} left room: ${roomId}`);
  }
});

export { ws as chatRouter };
