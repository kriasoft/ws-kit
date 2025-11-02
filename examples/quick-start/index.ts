// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";
import { chatRouter } from "./chat";

// Create a WebSocket router and merge chat routes
const router = createRouter<{ roomId?: string; clientId: string }>();
router.merge(chatRouter);

// Serve with Bun using the unified serve() helper
serve(router, {
  port: parseInt(process.env.PORT || "3000"),
  authenticate() {
    // Generate unique client ID for this connection
    return { clientId: crypto.randomUUID() };
  },
});
