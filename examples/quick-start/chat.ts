// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Chat feature module demonstrating schema-driven type inference + composition (ADR-023, Pillar A+G).
 *
 * This module exports a sub-router (createChatRouter) that:
 * 1. Uses schema-driven type inference—handlers infer payload type purely from schema
 * 2. Is composed into the main app router via merge()—no type erasure
 * 3. Can be tested independently without the full app context
 *
 * Example: Handler infers `c.payload` as { roomId: string } from JoinRoom schema,
 * with TypeScript preventing access to non-existent properties.
 *
 * Pattern: feature module → sub-router → merge() at app level
 * See: ADR-023 (Schema-Driven Type Inference), docs/patterns/composition.md
 */

import type { WebSocketData } from "@ws-kit/core";
import { createRouter, withZod } from "@ws-kit/zod";
import {
  JoinRoom,
  NewMessage,
  SendMessage,
  UserJoined,
  UserLeft,
} from "./schema";

// Type annotation for connection data (extends WebSocketData)
export type ChatData = WebSocketData & { roomId?: string; clientId: string };

/**
 * Create a chat feature sub-router.
 *
 * This router handles room-based messaging:
 * - JoinRoom: Subscribe to room topic, broadcast user joined
 * - SendMessage: Broadcast message to room subscribers
 * - onClose: Notify room that user left
 *
 * @typeParam TContext - Application data type (must include clientId)
 * @returns A configured router that can be merged into the main app router
 *
 * @example
 * ```typescript
 * type AppData = { userId?: string; clientId: string; roomId?: string };
 * const appRouter = createRouter<AppData>()
 *   .merge(createChatRouter<AppData>())
 *   .merge(createPresenceRouter<AppData>());
 * ```
 */
export function createChatRouter<TContext extends ChatData = ChatData>() {
  const router = createRouter<TContext>().plugin(withZod());

  router
    // Handler 1: User joins a room
    .on(JoinRoom, async (c) => {
      const { roomId } = c.payload; // ✅ Inferred as string from schema
      const clientId = c.ws.data?.clientId;

      // Store roomId in connection data for use in onClose handler
      if (c.ws.data) {
        c.ws.data.roomId = roomId;
      }

      console.log(`Client ${clientId} joined room: ${roomId}`);

      // Subscribe to room broadcasts
      await c.topics.subscribe(`room:${roomId}`);

      // Send confirmation back to the user who joined
      c.send(UserJoined, {
        roomId,
        userId: clientId,
      });

      // Broadcast to other users in the room that someone joined
      await c.publish(`room:${roomId}`, UserJoined, {
        roomId,
        userId: clientId,
      });
    })

    // Handler 2: User sends a message to the room
    .on(SendMessage, async (c) => {
      const { roomId, text } = c.payload; // ✅ Inferred as string from schema
      const clientId = c.ws.data?.clientId;
      console.log(`Message from ${clientId} in room ${roomId}: ${text}`);

      // Broadcast message to all subscribers in the room
      await c.publish(`room:${roomId}`, NewMessage, {
        roomId,
        userId: clientId,
        text,
        timestamp: Date.now(),
      });
    })

    // Lifecycle hook: User disconnected
    .onClose((c) => {
      const clientId = c.ws.data?.clientId;
      const roomId = c.ws.data?.roomId as string | undefined;

      console.log(`Connection closed: ${clientId}`);

      // Notify room that user left
      if (roomId && clientId) {
        // Use router.publish() for lifecycle hooks (not available on context)
        void router.publish(`room:${roomId}`, UserLeft, {
          roomId,
          userId: clientId,
        });

        console.log(`User ${clientId} left room: ${roomId}`);
      }
    });

  return router;
}
