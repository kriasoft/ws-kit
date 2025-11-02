// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { serve } from "@ws-kit/bun";
import type { RouteContext } from "@ws-kit/core";
import { createRouter } from "@ws-kit/zod";

const router = createRouter();
let serverSeq = 0;
const clientStates = new Map<
  string,
  { lastClientSeq: number; lastServerSeq: number }
>();
const stateHistory: { seq: number; payload: unknown }[] = [];

router.use((ctx: RouteContext<unknown>, next: () => void) => {
  if (!clientStates.has(ctx.clientId)) {
    clientStates.set(ctx.clientId, { lastClientSeq: 0, lastServerSeq: 0 });
  }
  next();
});

router.on("STATE_UPDATE", (ctx: RouteContext<unknown>) => {
  const clientSeq = ctx.payload.seq as number;
  const clientState = clientStates.get(ctx.clientId);
  if (!clientState) return;

  // Detect gap
  if (clientSeq > clientState.lastClientSeq + 1) {
    ctx.send("SEQUENCE_GAP", {
      expectedSeq: clientState.lastClientSeq + 1,
      receivedSeq: clientSeq,
      resumeFrom: clientState.lastServerSeq + 1,
    });
    return;
  }

  // Detect duplicate
  if (clientSeq <= clientState.lastClientSeq) {
    return; // Silently ack
  }

  // Accept and broadcast
  clientState.lastClientSeq = clientSeq;
  serverSeq++;
  const message = {
    seq: serverSeq,
    payload: ctx.payload.payload,
  };
  stateHistory.push(message);
  clientState.lastServerSeq = serverSeq;
  ctx.publish("state", "STATE_SYNC", message);
});

router.on("CATCH_UP_REQUEST", (ctx: RouteContext<unknown>) => {
  const fromSeq = ctx.payload.fromSeq as number;
  // Send all missing states starting from fromSeq
  for (const msg of stateHistory) {
    if (msg.seq >= fromSeq) {
      ctx.send("STATE_SYNC", msg);
    }
  }
});

serve(router, { port: 3000 });
