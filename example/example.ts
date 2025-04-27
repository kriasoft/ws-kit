import { WebSocketRouter } from "../router";
import { JoinRoomSchema, UserJoinedSchema } from "./schema";

const ws = new WebSocketRouter();

ws.onMessage(JoinRoomSchema, (c) => {
  const { roomId } = c.payload;
  console.log(`User joined room: ${roomId}`);

  c.send(UserJoinedSchema, {
    roomId,
    userId: c.meta.clientId,
  });
});

ws.onClose((c) => {
  console.log(`Connection closed`);
});

export { ws as exampleRouter };
