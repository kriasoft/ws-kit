// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { Hono } from "hono";
import { WebSocketRouter } from "../zod";
import { chatRouter } from "./chat";

// HTTP router
const app = new Hono();
app.get("/", (c) => c.text("Welcome to Hono!"));

// Create a WebSocket router with the same extended data type as chatRouter
const ws = new WebSocketRouter<Record<string, unknown>>();
ws.addRoutes(chatRouter);

Bun.serve({
  port: 3000,

  fetch(req, server) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade requests
    if (url.pathname === "/ws") {
      return ws.upgrade(req, { server });
    }

    // Handle regular HTTP requests
    return app.fetch(req, { server });
  },

  // Handle WebSocket connections
  websocket: ws.websocket,
});
