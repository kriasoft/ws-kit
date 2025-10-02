// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * bun-ws-router v0.4.0 - Breaking Change
 *
 * Direct imports from "bun-ws-router" are no longer supported.
 * Please use explicit adapter imports:
 *
 * For Zod:
 *   import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
 *
 * For Valibot:
 *   import { WebSocketRouter, createMessageSchema } from "bun-ws-router/valibot";
 *
 * See BREAKING_CHANGES.md for migration guide.
 */

// Only export shared types that are validator-agnostic
export type { UpgradeOptions, WebSocketData } from "./shared/types";

// Throw helpful error if someone tries to import non-existent exports
const errorMessage = `
bun-ws-router v0.4.0 Breaking Change:

Direct imports from "bun-ws-router" are no longer supported to fix discriminated union support.

Migration steps:
1. Choose your validation library (Zod or Valibot)
2. Update your imports:

   For existing Zod users:
   ────────────────────────────────────────────────────────
   // Before (broken)
   import { WebSocketRouter, messageSchema } from "bun-ws-router";

   // After (works)
   import { z } from "zod";
   import { WebSocketRouter, createMessageSchema } from "bun-ws-router/zod";
   const { messageSchema } = createMessageSchema(z);
   ────────────────────────────────────────────────────────

   For existing Valibot users:
   ────────────────────────────────────────────────────────
   // Before (broken)
   import { WebSocketRouter, messageSchema } from "bun-ws-router";

   // After (works)
   import * as v from "valibot";
   import { WebSocketRouter, createMessageSchema } from "bun-ws-router/valibot";
   const { messageSchema } = createMessageSchema(v);
   ────────────────────────────────────────────────────────

3. Your message schemas remain unchanged, just use the factory's messageSchema

See BREAKING_CHANGES.md for the complete migration guide.
`;

export const WebSocketRouter = new Proxy(
  {},
  {
    get() {
      throw new Error(errorMessage);
    },
  },
);

export const messageSchema = new Proxy(
  {},
  {
    get() {
      throw new Error(errorMessage);
    },
  },
);

export const createMessage = new Proxy(
  {},
  {
    get() {
      throw new Error(errorMessage);
    },
  },
);
