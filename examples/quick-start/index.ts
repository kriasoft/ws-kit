// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Quick-start example demonstrating schema-driven type inference + composition.
 *
 * This example shows the recommended pattern for structuring WebSocket applications:
 * 1. Define message schemas (schema.ts)
 * 2. Create feature modules with sub-routers (chat.ts, etc.)
 * 3. Compose features into the main app router at the entry point (this file)
 *
 * See: ADR-023 (Schema-Driven Type Inference), docs/patterns/composition.md
 */

import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { createChatRouter } from "./chat";

declare module "@ws-kit/core" {
  interface ConnectionData {
    roomId?: string;
    clientId: string;
  }
}

// Create the main app router by composing feature sub-routers
const appRouter = createRouter<ConnectionData>()
  // Merge chat feature handlers
  // All handlers maintain full type inference (schema-driven)
  .merge(createChatRouter<ConnectionData>());

// Get port from environment (default 3000)
// Tip: Set PORT=0 to let the OS choose any available port if 3000 is busy
const port = parseInt(process.env.PORT || "3000");

// Serve with Bun using the unified serve() helper
serve(appRouter, {
  port,
  authenticate() {
    // Generate unique client ID for this connection
    return { clientId: crypto.randomUUID() };
  },
});
