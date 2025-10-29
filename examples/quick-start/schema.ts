// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z);

export const JoinRoom = messageSchema("JOIN_ROOM", {
  roomId: z.string(),
});

export const UserJoined = messageSchema("USER_JOINED", {
  roomId: z.string(),
  userId: z.string().optional(),
});

export const UserLeft = messageSchema("USER_LEFT", {
  roomId: z.string(),
  userId: z.string(),
});

export const SendMessage = messageSchema("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string(),
});

export const NewMessage = messageSchema("NEW_MESSAGE", {
  roomId: z.string(),
  userId: z.string(),
  text: z.string(),
  timestamp: z.number().optional(),
});
