// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { chatRouter } from "./chat";

// Create a WebSocket router and merge chat routes
const router = createRouter<{ roomId?: string; clientId: string }>();
router.merge(chatRouter);

// Get port from environment (default 3000)
// Tip: Set PORT=0 to let the OS choose any available port if 3000 is busy
const port = parseInt(process.env.PORT || "3000");

// Serve with Bun using the unified serve() helper
serve(router, {
  port,
  authenticate() {
    // Generate unique client ID for this connection
    return { clientId: crypto.randomUUID() };
  },
});
