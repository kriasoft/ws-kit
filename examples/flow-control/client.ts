// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { wsClient } from "@ws-kit/client/zod";
import {
  DataAckMessage,
  ResourceExhaustedMessage,
  SendDataMessage,
} from "./schema";

const client = wsClient({ url: "ws://localhost:3000" });

let retryAfter = 0;

client.onceOpen().then(() => {
  client.send(SendDataMessage, { data: "hello" });
});

client.on(DataAckMessage, (msg) => {
  console.log(`Message acknowledged: ${msg.payload.id}`);
});

client.on(ResourceExhaustedMessage, (msg) => {
  retryAfter = Date.now() + msg.payload.retryAfterMs;
  console.error(
    `Queue full (${msg.payload.policy}): backing off for ${msg.payload.retryAfterMs}ms`,
  );
});

async function sendWithBackoff(data: string) {
  if (Date.now() < retryAfter) {
    const wait = retryAfter - Date.now();
    console.log(`Waiting ${wait}ms before retry...`);
    await new Promise((r) => setTimeout(r, wait));
  }

  client.send(SendDataMessage, { data });
}

client.connect();
