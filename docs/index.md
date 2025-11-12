---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "WebSocket Toolkit"
  text: "Build type-safe WebSocket APIs with confidence"
  tagline: "Message routing, RPC, and broadcasting with Zod or Valibot validation for Bun, Cloudflare, browsers"
  image:
    src: /hero.svg
    alt: WS-Kit
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kriasoft/ws-kit

features:
  - icon: 🛡️
    title: Type-Safe Routing
    details: Define message schemas with Zod or Valibot and get full TypeScript type inference from schema to handler without type assertions
  - icon: 🔄
    title: Request-Response Pattern
    details: Built-in RPC with auto-correlation, timeouts, and streaming progress updates using rpc() helper and ctx.reply()
  - icon: 📡
    title: Broadcasting & PubSub
    details: Type-safe publish/subscribe with topic-based routing. Use ctx.publish() in handlers or router.publish() for system events
  - icon: 🔌
    title: Middleware Support
    details: Global and per-route middleware with async/await support for authentication, rate limiting, and authorization
  - icon: ⚡
    title: Multi-Platform
    details: Works with Bun's high-performance WebSocket server and Cloudflare Durable Objects with platform-specific optimizations
  - icon: 🔧
    title: Structured Error Handling
    details: 13 gRPC-aligned error codes with WsKitError class following WHATWG Error standard. Automatic error responses, cause chaining, and JSON serialization for observability tools
---

## Quick Start

Build a collaborative chat room in minutes with type-safe messages and broadcasting:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define message schemas — fully typed end-to-end
const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const SendMessage = message("SEND_MESSAGE", { text: z.string() });
const RoomUpdate = message("ROOM_UPDATE", {
  userId: z.string(),
  action: z.enum(["joined", "left"]),
  messageCount: z.number(),
});

// Create type-safe router with user context
type AppData = { userId?: string; roomId?: string };
const router = createRouter<AppData>();

// Handle room joins with pub/sub
router.on(JoinRoom, async (ctx) => {
  ctx.assignData({ roomId: ctx.payload.roomId });
  await ctx.topics.subscribe(ctx.payload.roomId); // Join topic

  // Broadcast to all room subscribers (type-safe!)
  await router.publish(ctx.payload.roomId, RoomUpdate, {
    userId: ctx.ws.data.userId || "anonymous",
    action: "joined",
    messageCount: 1,
  });
});

// Handle messages with full type inference
router.on(SendMessage, async (ctx) => {
  const roomId = ctx.ws.data?.roomId;
  await router.publish(roomId, RoomUpdate, {
    userId: ctx.ws.data?.userId || "anonymous",
    action: "joined",
    messageCount: 2, // In real app, track actual count
  });
});

// Authenticate and serve
serve(router, {
  port: 3000,
  authenticate(req) {
    const userId = req.headers.get("x-user-id");
    return userId ? { userId } : undefined;
  },
});
```

Type-safe messaging, pub/sub broadcasting, and authentication — all built-in. [Explore more examples →](/examples)
