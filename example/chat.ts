import { WebSocketRouter } from "../router";
import { JoinRoom, UserJoined } from "./schema";

const ws = new WebSocketRouter();

ws.onMessage(JoinRoom, (c) => {
  const { roomId } = c.payload;
  console.log(`User joined room: ${roomId}`);

  c.send(UserJoined, {
    roomId,
    userId: c.meta.clientId,
  });
});

ws.onClose(() => {
  console.log(`Connection closed`);
});

export { ws as chatRouter };
