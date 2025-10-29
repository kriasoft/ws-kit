// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createRouter, message, z } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve/bun";

/**
 * Example of enhanced validation with Zod v4's string validators
 *
 * The handler only receives messages that pass validation:
 * - Valid JWT tokens (validated by z.jwt())
 * - Valid semver pattern (validated by regex)
 */
const AuthenticateMessage = message("AUTHENTICATE", {
  token: z.jwt(),
  apiVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(), // Semver pattern
});

type AppData = { clientId?: string };

const router = createRouter<AppData>();

// Example middleware for additional validation
router.use((ctx, next) => {
  console.log(`Message: ${ctx.type}`);
  return next();
});

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

// Serve with Bun using the unified serve() helper
serve(router, {
  port: parseInt(process.env.PORT || "3000"),
  authenticate() {
    return { clientId: crypto.randomUUID() };
  },
});

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
