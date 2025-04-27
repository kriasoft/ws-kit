import { z } from "zod";
import { MessageSchema } from "../schema";

export const JoinRoomSchema = MessageSchema.extend({
  type: z.literal("JOIN_ROOM"),
  payload: z.object({
    roomId: z.string(),
  }),
});

export const UserJoinedSchema = MessageSchema.extend({
  type: z.literal("USER_JOINED"),
  payload: z.object({
    roomId: z.string(),
    userId: z.string().optional(),
  }),
});
