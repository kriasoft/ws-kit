// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createClient } from "@ws-kit/client";

const client = createClient<
  { SEND_DATA: { data: string } },
  {
    RESOURCE_EXHAUSTED: {
      policy: string;
      retryAfterMs: number;
      queueDepth: number;
    };
    DATA_ACK: { id: string };
  }
>("ws://localhost:3000");

let retryAfter = 0;

client.on("open", () => {
  client.send("SEND_DATA", { data: "hello" });
});

client.on("DATA_ACK", (msg: { id: string }) => {
  console.log(`Message acknowledged: ${msg.id}`);
});

client.on(
  "RESOURCE_EXHAUSTED",
  (msg: { policy: string; retryAfterMs: number; queueDepth: number }) => {
    retryAfter = Date.now() + msg.retryAfterMs;
    console.error(
      `Queue full (${msg.policy}): backing off for ${msg.retryAfterMs}ms`,
    );
  },
);

async function sendWithBackoff(data: string) {
  if (Date.now() < retryAfter) {
    const wait = retryAfter - Date.now();
    console.log(`Waiting ${wait}ms before retry...`);
    await new Promise((r) => setTimeout(r, wait));
  }

  client.send("SEND_DATA", { data });
}

client.connect();
