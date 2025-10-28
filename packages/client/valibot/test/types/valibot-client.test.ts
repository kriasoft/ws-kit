// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type tests for @ws-kit/client/valibot
 *
 * Verifies:
 * - ValibotWebSocketClient type inference
 * - Handler typing with Valibot schema inference
 * - Message payload/meta typing
 * - Discriminated union narrowing
 */

import { expectTypeOf, test } from "bun:test";
import * as v from "valibot";
import { createClient } from "../../src/index.js";
import { createMessageSchema } from "../../../../valibot/src/index.js";
import type {
  InferMessage,
  InferPayload,
  InferMeta,
  MessageSchemaType,
} from "../../../../valibot/src/types.js";
import type { ValibotWebSocketClient } from "../../src/index.js";
import type { ClientState } from "../../../src/types.js";

// Create message schemas
const { messageSchema } = createMessageSchema(v);
const UserJoinedMessage = messageSchema("USER_JOINED", {
  userId: v.string(),
  userName: v.string(),
});
const MessageSentMessage = messageSchema("MESSAGE_SENT", {
  text: v.string(),
  authorId: v.string(),
});
const PingMessage = messageSchema("PING", {
  id: v.number(),
});

test("Valibot: createClient returns ValibotWebSocketClient", () => {
  const client = createClient({ url: "ws://localhost" });
  expectTypeOf(client).toMatchTypeOf<ValibotWebSocketClient>();
});

test("Valibot: on() handler receives fully typed message", () => {
  const client = createClient({ url: "ws://localhost" });

  client.on(UserJoinedMessage, (msg) => {
    // msg should be inferred as InferMessage<typeof UserJoinedMessage>
    expectTypeOf(msg).toMatchTypeOf<InferMessage<typeof UserJoinedMessage>>();
    expectTypeOf(msg.type).toEqualTypeOf<"USER_JOINED">();
    expectTypeOf(msg.payload.userId).toBeString();
    expectTypeOf(msg.payload.userName).toBeString();
  });
});

test("Valibot: on() with different schema", () => {
  const client = createClient({ url: "ws://localhost" });

  client.on(MessageSentMessage, (msg) => {
    expectTypeOf(msg.type).toEqualTypeOf<"MESSAGE_SENT">();
    expectTypeOf(msg.payload.text).toBeString();
    expectTypeOf(msg.payload.authorId).toBeString();
  });
});

test("Valibot: send() with payload", () => {
  const client = createClient({ url: "ws://localhost" });

  const sendResult1 = client.send(UserJoinedMessage, {
    userId: "123",
    userName: "Alice",
  });
  expectTypeOf(sendResult1).toBeBoolean();
});

test("Valibot: send() without payload when no payload in schema", () => {
  const client = createClient({ url: "ws://localhost" });

  const NoPingMessage = messageSchema("NO_PAYLOAD", {});
  const sendResult2 = client.send(NoPingMessage);
  expectTypeOf(sendResult2).toBeBoolean();
});

test("Valibot: request() with typed reply", () => {
  const client = createClient({ url: "ws://localhost" });

  const requestPromise = client.request(
    UserJoinedMessage,
    { userId: "123", userName: "Alice" },
    MessageSentMessage,
  );
  expectTypeOf(requestPromise).resolves.toMatchTypeOf<
    InferMessage<typeof MessageSentMessage>
  >();
});

test("Valibot: discriminated union narrowing", () => {
  type JoinMessage = typeof UserJoinedMessage;
  type TextMessage = typeof MessageSentMessage;
  type AnyMessage = JoinMessage | TextMessage;

  const handler = (msg: InferMessage<AnyMessage>) => {
    if (msg.type === "USER_JOINED") {
      // Should narrow to JoinMessage
      expectTypeOf(msg.payload.userId).toBeString();
    } else if (msg.type === "MESSAGE_SENT") {
      // Should narrow to TextMessage
      expectTypeOf(msg.payload.text).toBeString();
    }
  };

  expectTypeOf(handler).toBeFunction();
});

test("Valibot: ClientState and isConnected properties", () => {
  const client = createClient({ url: "ws://localhost" });

  const state: ClientState = client.state;
  expectTypeOf(state).toMatchTypeOf<ClientState>();

  const isConnected = client.isConnected;
  expectTypeOf(isConnected).toBeBoolean();
});
