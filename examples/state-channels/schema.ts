// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { message, z } from "@ws-kit/zod";

export const StateUpdateMessage = message("STATE_UPDATE", {
  seq: z.number().positive("Client sequence number"),
  payload: z.unknown().describe("Update data"),
});

export const StateSyncMessage = message("STATE_SYNC", {
  seq: z.number().positive("Server sequence number"),
  payload: z.unknown().describe("State data"),
});

export const SequenceGapMessage = message("SEQUENCE_GAP", {
  expectedSeq: z.number().describe("Expected client sequence"),
  receivedSeq: z.number().describe("Received sequence"),
  resumeFrom: z.number().describe("Server sequence to resume from"),
});

export const CatchUpRequestMessage = message("CATCH_UP_REQUEST", {
  fromSeq: z.number().describe("Server sequence to resume from"),
});
