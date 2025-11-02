// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { serve } from "@ws-kit/bun";
import { createRouter } from "@ws-kit/zod";

const QUEUE_CAPACITY = 10;
const POLICY = "drop-oldest"; // or "drop-new", "queue"

const router = createRouter();
const queues = new Map<string, string[]>();

router.on("SEND_DATA", (ctx) => {
  const queue = queues.get(ctx.clientId) || [];
  if (!queues.has(ctx.clientId)) {
    queues.set(ctx.clientId, queue);
  }

  if (POLICY === "queue") {
    // Queue policy: accumulate without bounds
    queue.push(ctx.payload.data as string);
  } else if (queue.length >= QUEUE_CAPACITY) {
    // Drop policies: enforce capacity, send error
    if (POLICY === "drop-oldest") {
      queue.shift();
    } else if (POLICY === "drop-new") {
      // Don't add new message
    }
    ctx.send("RESOURCE_EXHAUSTED", {
      policy: POLICY,
      retryAfterMs: 100,
      queueDepth: queue.length,
    });
    return;
  } else {
    queue.push(ctx.payload.data as string);
  }

  ctx.send("DATA_ACK", { id: ctx.clientId });
});

serve(router, { port: 3000 });
