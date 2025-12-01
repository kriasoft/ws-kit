// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { serve } from "@ws-kit/bun";
import { createRouter, withZod } from "@ws-kit/zod";
import {
  CatchUpRequestMessage,
  SequenceGapMessage,
  StateSyncMessage,
  StateUpdateMessage,
} from "./schema.js";

const router = createRouter().plugin(withZod());
let serverSeq = 0;
const clientStates = new Map<
  string,
  { lastClientSeq: number; lastServerSeq: number }
>();
const stateHistory: { seq: number; payload: unknown }[] = [];

router.use((ctx, next) => {
  if (!clientStates.has(ctx.clientId)) {
    clientStates.set(ctx.clientId, {
      lastClientSeq: 0,
      lastServerSeq: 0,
    });
  }
  return next();
});

router.on(StateUpdateMessage, (ctx) => {
  const clientSeq = ctx.payload.seq;
  const clientState = clientStates.get(ctx.clientId);
  if (!clientState) return;

  // Detect gap
  if (clientSeq > clientState.lastClientSeq + 1) {
    ctx.send(SequenceGapMessage, {
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
  // Note: ctx.publish() is not available on the typed context
  // In a real app, use router.publish() or implement custom broadcasting
  // router.publish("state", StateSyncMessage, message);
  ctx.send(StateSyncMessage, message);
});

router.on(CatchUpRequestMessage, (ctx) => {
  const fromSeq = ctx.payload.fromSeq;
  // Send all missing states starting from fromSeq
  for (const msg of stateHistory) {
    if (msg.seq >= fromSeq) {
      ctx.send(StateSyncMessage, msg);
    }
  }
});

serve(router, { port: 3000 });
