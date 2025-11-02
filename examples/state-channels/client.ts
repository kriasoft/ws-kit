// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { wsClient } from "@ws-kit/client/zod";
import {
  CatchUpRequestMessage,
  SequenceGapMessage,
  StateSyncMessage,
  StateUpdateMessage,
} from "./schema";

const client = wsClient({ url: "ws://localhost:3000" });

let clientSeq = 0;
let expectedSeq = 1;

client.onceOpen().then(() => {
  client.send(StateUpdateMessage, {
    seq: ++clientSeq,
    payload: { status: "online" },
  });
});

client.on(StateSyncMessage, (msg) => {
  if (msg.payload.seq > expectedSeq) {
    console.error(
      `Gap detected: expected ${expectedSeq}, got ${msg.payload.seq}`,
    );
    client.send(CatchUpRequestMessage, { fromSeq: expectedSeq });
    expectedSeq = msg.payload.seq + 1;
    return;
  }
  expectedSeq = msg.payload.seq + 1;
  console.log(`State sync seq=${msg.payload.seq}:`, msg.payload.payload);
});

client.on(SequenceGapMessage, (msg) => {
  console.error(
    `Sequence gap: expected ${msg.payload.expectedSeq}, got ${msg.payload.receivedSeq}`,
  );
  client.send(CatchUpRequestMessage, { fromSeq: msg.payload.resumeFrom });
});

client.connect();
