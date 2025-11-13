// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests verifying schema-driven inference (ADR-023).
 *
 * These are compile-time assertions that verify:
 * 1. Handlers have access to schema type information
 * 2. Type safety works through Router interface
 * 3. Composition preserves inference across merges
 * 4. Schema carries type information that flows to context
 *
 * Pattern: Define handlers separately from on() registration for proper
 * TypeScript bidirectional type inference.
 *
 * Run: bun tsc --noEmit to verify all assertions pass
 */

import { z, message, createRouter } from "../..";
import type { Router } from "@ws-kit/core";
import type { MessageContext } from "@ws-kit/zod";

// ============================================================================
// Test Setup: Message Schemas
// ============================================================================

const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
  userName: z.string().min(1),
});

const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string().min(1),
});

const GetUser = message("GET_USER", {
  id: z.string().uuid(),
});

interface AppData {
  clientId: string;
  userId?: string;
  roomId?: string;
}

// ============================================================================
// Test 1: Handler defined separately with explicit typing
// ============================================================================

async function handleJoinRoom(ctx: MessageContext<typeof JoinRoom, AppData>) {
  // All property accesses are type-safe
  const roomId: string = ctx.payload.roomId;
  const userName: string = ctx.payload.userName;
  const messageType: "JOIN_ROOM" = ctx.type;
  const userId: string | undefined = ctx.ws.data.userId;

  // TypeScript error on invalid properties:
  // ctx.payload.invalidProp; // ❌ Error
}

// ============================================================================
// Test 2: Handlers through interface parameter
// ============================================================================

function setupChatHelper(router: Router<AppData>) {
  // Register pre-defined handlers - types flow from schema to context
  router.on(JoinRoom, handleJoinRoom);

  // Define inline handler with explicit type annotation
  router.on(
    SendMessage,
    async (ctx: MessageContext<typeof SendMessage, AppData>) => {
      const roomId: string = ctx.payload.roomId;
      const text: string = ctx.payload.text;
    },
  );
}

// ============================================================================
// Test 3: Composition pattern preserves types
// ============================================================================

function createChatSubRouter<TData extends AppData>() {
  return createRouter<TData>()
    .on(JoinRoom, async (ctx: MessageContext<typeof JoinRoom, TData>) => {
      const roomId: string = ctx.payload.roomId;
    })
    .on(SendMessage, async (ctx: MessageContext<typeof SendMessage, TData>) => {
      const text: string = ctx.payload.text;
    });
}

function testComposition() {
  const mainRouter = createRouter<AppData>().merge(
    createChatSubRouter<AppData>(),
  );

  // After merge, handlers still have proper types
  const asInterface: Router<AppData> = mainRouter;
  setupChatHelper(asInterface);
}

// ============================================================================
// Test 4: Type safety with middleware
// ============================================================================

function setupMiddlewareWithDataAccess(router: Router<AppData>) {
  // Middleware can access typed connection data
  router.use(async (ctx, next) => {
    const clientId: string = ctx.ws.data.clientId;
    await next();
  });
}

// ============================================================================
// Test 5: Multiple handlers on same router
// ============================================================================

function setupMultipleHandlers(router: Router<AppData>) {
  // Register multiple handlers with proper type inference
  router
    .on(JoinRoom, async (ctx: MessageContext<typeof JoinRoom, AppData>) => {
      const roomId: string = ctx.payload.roomId;
    })
    .on(
      SendMessage,
      async (ctx: MessageContext<typeof SendMessage, AppData>) => {
        const text: string = ctx.payload.text;
      },
    );
}

// ============================================================================
// Test 6: Handler exports from feature modules
// ============================================================================

async function chatHandler(ctx: MessageContext<typeof SendMessage, AppData>) {
  const text: string = ctx.payload.text;
  const roomId: string | undefined = ctx.ws.data.roomId;
}

// ============================================================================
// Helper: Verify all tests compile
// ============================================================================

export function runCompileTimeTests() {
  const router = createRouter<AppData>();

  setupChatHelper(router);
  testComposition();
  setupMiddlewareWithDataAccess(router);
  setupMultipleHandlers(router);
}
