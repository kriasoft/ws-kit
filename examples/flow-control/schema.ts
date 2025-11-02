// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { message, z } from "@ws-kit/zod";

export const SendDataMessage = message("SEND_DATA", {
  data: z.string().describe("Payload data"),
});

export const ResourceExhaustedMessage = message("RESOURCE_EXHAUSTED", {
  policy: z
    .enum(["drop-oldest", "drop-new", "queue"])
    .describe("Policy applied"),
  retryAfterMs: z
    .number()
    .nonnegative()
    .describe("Milliseconds before retry is safe"),
  queueDepth: z.number().nonnegative().describe("Current queue depth"),
});

export const DataAckMessage = message("DATA_ACK", {
  id: z.string().describe("Message id being acknowledged"),
});
