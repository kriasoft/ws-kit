// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Cloudflare Durable Object Handler
 *
 * Handles WebSocket connections for a shard in a sharded pub/sub system.
 * The Worker entry point (`router.ts`) routes incoming requests to the appropriate
 * shard using stable hashing on the room/scope name.
 *
 * Each DO instance is limited to 100 concurrent connections.
 * Use `router.ts` with `getShardedStub()` to distribute rooms across multiple shards.
 */

import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
import { createRouter, message, z } from "@ws-kit/zod";

// Message schemas
const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const LeaveRoom = message("LEAVE_ROOM", { roomId: z.string() });
const RoomMessage = message("ROOM_MESSAGE", { text: z.string() });
const RoomUpdate = message("ROOM_UPDATE", {
  roomId: z.string(),
  text: z.string(),
  userId: z.string(),
});

// Type-safe app data
interface AppData {
  clientId: string;
  userId?: string;
  roomId?: string;
}

// Create router for this DO instance
const router = createRouter<AppData>();

// Join room: subscribe to scoped channel
router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data?.userId || "anonymous";

  // Subscribe to room-scoped updates (broadcasts only within this DO instance)
  ctx.subscribe(`room:${roomId}`);
  ctx.assignData({ roomId });

  // Notify room members of join
  router.publish(`room:${roomId}`, RoomUpdate, {
    roomId,
    text: `${userId} joined`,
    userId,
  });
});

// Send message: broadcast to room subscribers
router.on(RoomMessage, (ctx) => {
  const roomId = ctx.ws.data?.roomId;
  const userId = ctx.ws.data?.userId || "anonymous";

  if (!roomId) {
    ctx.error("NOT_FOUND", "Not in a room");
    return;
  }

  router.publish(`room:${roomId}`, RoomUpdate, {
    roomId,
    text: ctx.payload.text,
    userId,
  });
});

// Leave room: cleanup subscription
router.on(LeaveRoom, (ctx) => {
  const roomId = ctx.ws.data?.roomId;
  if (roomId) {
    ctx.unsubscribe(`room:${roomId}`);
  }
});

// Export Cloudflare Durable Object class
export class WebSocketRouter {
  private handler;

  constructor(
    private state: unknown, // DurableObjectState - from @cloudflare/workers-types
    private env: unknown, // DurableObjectEnv - from @cloudflare/workers-types
  ) {
    // Create handler with authentication
    this.handler = createDurableObjectHandler(router, {
      authenticate(req) {
        const token = req.headers.get("authorization");
        const userId = token?.replace("Bearer ", "");
        return userId
          ? {
              clientId: req.headers.get("sec-websocket-key") || "anonymous",
              userId,
            }
          : undefined;
      },
    });
  }

  async fetch(req: Request): Promise<Response> {
    return this.handler.fetch(req);
  }
}
