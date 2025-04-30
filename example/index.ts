import { Hono } from "hono";
import { WebSocketRouter } from "../index";
import { chatRouter } from "./chat";

// HTTP router
const app = new Hono();
app.get("/", (c) => c.text("Welcome to Hono!"));

// WebSocket router
const ws = new WebSocketRouter();
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
