// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createClient } from "@ws-kit/client";

const client = createClient<
  {
    STATE_SYNC: { seq: number; payload: unknown };
    SEQUENCE_GAP: {
      expectedSeq: number;
      receivedSeq: number;
      resumeFrom: number;
    };
  },
  {
    STATE_UPDATE: { seq: number; payload: unknown };
    CATCH_UP_REQUEST: { fromSeq: number };
  }
>("ws://localhost:3000");

let clientSeq = 0;
let expectedSeq = 1;

client.on("open", () => {
  client.send("STATE_UPDATE", {
    seq: ++clientSeq,
    payload: { status: "online" },
  });
});

client.on("STATE_SYNC", (msg: { seq: number; payload: unknown }) => {
  if (msg.seq > expectedSeq) {
    console.error(`Gap detected: expected ${expectedSeq}, got ${msg.seq}`);
    client.send("CATCH_UP_REQUEST", { fromSeq: expectedSeq });
    expectedSeq = msg.seq + 1;
    return;
  }
  expectedSeq = msg.seq + 1;
  console.log(`State sync seq=${msg.seq}:`, msg.payload);
});

client.on(
  "SEQUENCE_GAP",
  (msg: { expectedSeq: number; receivedSeq: number; resumeFrom: number }) => {
    console.error(
      `Sequence gap: expected ${msg.expectedSeq}, got ${msg.receivedSeq}`,
    );
    client.send("CATCH_UP_REQUEST", { fromSeq: msg.resumeFrom });
  },
);

client.connect();
