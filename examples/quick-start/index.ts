// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
import { createZodRouter } from "@ws-kit/zod";
import { chatRouter } from "./chat";

// Create a WebSocket router and add chat routes
const router = createZodRouter({
  platform: createBunAdapter(),
});
router.addRoutes(chatRouter);

// Create Bun HTTP and WebSocket handlers
const { fetch, websocket } = createBunHandler(router._core);

// Serve with Bun
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

Bun.serve({
  port,

  fetch(req, server) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade requests
    if (url.pathname === "/ws") {
      return fetch(req, server);
    }

    // Simple HTTP endpoint
    if (url.pathname === "/") {
      return new Response("Welcome to ws-kit!");
    }

    return new Response("Not Found", { status: 404 });
  },

  // Handle WebSocket connections
  websocket,
});
