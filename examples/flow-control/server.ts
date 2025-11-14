// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { serve } from "@ws-kit/bun";
import { createRouter, withZod } from "@ws-kit/zod";
import {
  DataAckMessage,
  ResourceExhaustedMessage,
  SendDataMessage,
} from "./schema";

const QUEUE_CAPACITY = 10;
const POLICY = "drop-oldest" as const; // or "drop-new", "queue"

const router = createRouter().plugin(withZod());
const queues = new Map<string, string[]>();

router.on(SendDataMessage, (ctx) => {
  const queue = queues.get(ctx.ws.data.clientId) || [];
  if (!queues.has(ctx.ws.data.clientId)) {
    queues.set(ctx.ws.data.clientId, queue);
  }

  if (queue.length >= QUEUE_CAPACITY) {
    // Drop policies: enforce capacity, send error
    if (POLICY === "drop-oldest") {
      queue.shift();
    } else if (POLICY === "drop-new") {
      // Don't add new message
    }
    ctx.send(ResourceExhaustedMessage, {
      policy: POLICY,
      retryAfterMs: 100,
      queueDepth: queue.length,
    });
    return;
  } else {
    queue.push(ctx.payload.data);
  }

  ctx.send(DataAckMessage, { id: ctx.ws.data.clientId });
});

serve(router, { port: 3000 });
