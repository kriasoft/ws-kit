// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { z, message } from "@ws-kit/zod";

export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
});

export const UserJoined = message("USER_JOINED", {
  roomId: z.string(),
  userId: z.string().optional(),
});

export const UserLeft = message("USER_LEFT", {
  roomId: z.string(),
  userId: z.string(),
});

export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string(),
});

export const NewMessage = message("NEW_MESSAGE", {
  roomId: z.string(),
  userId: z.string(),
  text: z.string(),
  timestamp: z.number().optional(),
});
