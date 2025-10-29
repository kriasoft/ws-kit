/**
 * Cloudflare Durable Objects Sharding Example
 *
 * Demonstrates scaling pub/sub across multiple DO instances
 * by sharding subscriptions based on scope/room name.
 *
 * Each room (scope) consistently routes to the same DO instance,
 * enabling linear scaling without cross-DO communication.
 */

import { z, message, createRouter } from "@ws-kit/zod";
import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";

// Message schemas
const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const LeaveRoom = message("LEAVE_ROOM", { roomId: z.string() });
const RoomMessage = message("ROOM_MESSAGE", { text: z.string() });
const RoomUpdate = message("ROOM_UPDATE", {
  roomId: z.string(),
  text: z.string(),
  userId: z.string(),
});

// Hash function: consistent scope → DO instance mapping
function scopeToDoId(scope: string): string {
  let hash = 0;
  for (let i = 0; i < scope.length; i++) {
    const char = scope.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const doCount = 10; // Configure based on expected load
  return `router-${Math.abs(hash) % doCount}`;
}

// Type-safe app data
type AppData = {
  userId?: string;
  roomId?: string;
};

// Router instance
const router = createRouter<AppData>();

// Join room: subscribe to scoped channel
router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.ws.data?.userId || "anonymous";

  // Subscribe to room-scoped updates
  ctx.subscribe(`room:${roomId}`);
  ctx.assignData({ roomId });

  // Notify room members
  router.publish(`room:${roomId}`, RoomUpdate, {
    roomId,
    text: `${userId} joined`,
    userId,
  });
});

// Send message: broadcast to room
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

// Leave room
router.on(LeaveRoom, (ctx) => {
  const roomId = ctx.ws.data?.roomId;
  if (roomId) {
    ctx.unsubscribe(`room:${roomId}`);
  }
});

// Export Cloudflare Durable Object
export default {
  fetch: createDurableObjectHandler(router, {
    authenticate(req) {
      const token = req.headers.get("authorization");
      return token ? { userId: token.replace("Bearer ", "") } : undefined;
    },
  }),
} satisfies ExportedHandler;

// Type: export type DurableObjectNamespace = {
//   get(id: DurableObjectId): DurableObjectStub;
// };
