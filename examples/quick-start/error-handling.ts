// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
import { createZodRouter } from "@ws-kit/zod";
import { AuthenticateMessage } from "./auth-schema";

const router = createZodRouter({
  platform: createBunAdapter(),
});

/**
 * Example of enhanced validation with Zod v4's string validators
 *
 * The handler only receives messages that pass validation:
 * - Valid JWT tokens (validated by z.jwt())
 * - Valid semver pattern (validated by regex)
 */
router.onMessage(AuthenticateMessage, (context) => {
  // Type-safe payload access - fully typed without assertions!
  const { token, apiVersion } = context.payload;

  console.log("Valid JWT received:", token);
  console.log("API Version:", apiVersion);

  // Respond with success
  context.send(AuthenticateMessage, {
    token: "response",
    apiVersion: "1.0.0",
  });
});

// Example server setup
const { fetch: wsHandler, websocket } = createBunHandler(router);

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

Bun.serve({
  port,
  fetch(req, server) {
    if (req.headers.get("upgrade") === "websocket") {
      return wsHandler(req, server);
    }
    return new Response("WebSocket server with enhanced error handling");
  },
  websocket,
});

console.log(`Server running on port ${port}`);
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
