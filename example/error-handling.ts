import { WebSocketRouter } from "../zod";
import { AuthenticateMessage } from "./auth-schema";

const router = new WebSocketRouter();

/**
 * Example of enhanced validation with Zod v4's string validators
 */
router.onMessage(AuthenticateMessage, (context) => {
  // This handler only receives messages with:
  // - Valid JWT tokens (validated by z.jwt())
  // - Valid semver pattern (validated by regex)
  console.log("Valid JWT received:", context.payload.token);
  console.log("API Version:", context.payload.apiVersion);

  // Respond with success
  context.ws.send(
    JSON.stringify({
      type: "AUTH_SUCCESS",
      meta: {
        clientId: context.meta.clientId,
        timestamp: Date.now(),
      },
      payload: {
        userId: "user-123", // In real app, decode from JWT
        sessionId: crypto.randomUUID(),
      },
    }),
  );
});

// Example server setup
const server = Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (req.headers.get("upgrade") === "websocket") {
      return router.upgrade(req, { server });
    }
    return new Response("WebSocket server with enhanced error handling");
  },
  websocket: router.websocket,
});

console.log(`Server running on port ${server.port}`);
console.log("Try sending invalid messages to see prettified errors!");

/**
 * Example invalid messages that will trigger validation errors:
 *
 * 1. Missing JWT token:
 * { "type": "AUTHENTICATE", "meta": {} }
 *
 * 2. Invalid JWT format:
 * { "type": "AUTHENTICATE", "meta": {}, "payload": { "token": "not-a-jwt" } }
 *
 * 3. Invalid API version:
 * { "type": "AUTHENTICATE", "meta": {}, "payload": { "token": "eyJ...", "apiVersion": "invalid" } }
 */
