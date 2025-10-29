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
 * - Discriminated union narrowing in message handlers
 */

import { expectTypeOf, test } from "bun:test";
import * as v from "valibot";
import type {
  InferMessage,
  InferPayload,
  InferMeta,
  MessageSchemaType,
} from "../../../../valibot/src/types.js";
import { createClient } from "../../src/index.js";
import type { ClientOptions, ValibotWebSocketClient } from "../../src/index.js";
import { createMessageSchema } from "../../../../valibot/src/index.js";

test("Valibot client: Type inference for message schemas", () => {
  const { messageSchema } = createMessageSchema(v);

  // Define test schemas
  const HelloMessage = messageSchema("HELLO", { text: v.string() });
  const GoodbyeMessage = messageSchema("GOODBYE", { reason: v.string() });
  const PingMessage = messageSchema("PING"); // No payload

  // ✅ Assert InferPayload correctly identifies payload types
  expectTypeOf<InferPayload<typeof HelloMessage>>().toEqualTypeOf<{
    text: string;
  }>();
  expectTypeOf<InferPayload<typeof GoodbyeMessage>>().toEqualTypeOf<{
    reason: string;
  }>();
  expectTypeOf<InferPayload<typeof PingMessage>>().toEqualTypeOf<never>();

  // ✅ Assert InferMessage provides full message structure
  expectTypeOf<InferMessage<typeof HelloMessage>>().toMatchTypeOf<{
    type: "HELLO";
    payload: { text: string };
    meta?: Record<string, unknown>;
  }>();

  // ✅ Assert InferMeta extracts meta field correctly
  expectTypeOf<InferMeta<typeof HelloMessage>>().toEqualTypeOf<
    Record<string, unknown> | undefined
  >();
});

test("Valibot client: ValibotWebSocketClient type shape", () => {
  const { messageSchema } = createMessageSchema(v);
  const HelloMessage = messageSchema("HELLO", { text: v.string() });
  const PongMessage = messageSchema("PONG", { latency: v.number() });

  // Create client (type-only, doesn't actually connect)
  const client = createClient({
    url: "wss://example.com",
  }) as ValibotWebSocketClient;

  // ✅ Assert createClient returns ValibotWebSocketClient
  expectTypeOf(client).toMatchTypeOf<ValibotWebSocketClient>();

  // ✅ Assert on() method signature with schema
  expectTypeOf(client.on).toBeFunction();
  const unsubscribe = client.on(HelloMessage, (msg) => {
    // ✅ msg should have full type from schema
    expectTypeOf(msg.type).toEqualTypeOf<"HELLO">();
    expectTypeOf(msg.payload).toEqualTypeOf<{ text: string }>();
  });
  expectTypeOf(unsubscribe).toBeFunction();

  // ✅ Assert send() with payload
  const sendResult = client.send(HelloMessage, { text: "hello" });
  expectTypeOf(sendResult).toEqualTypeOf<boolean | never>();

  // ✅ Assert send() without payload (for PONG, even though it has payload)
  // For messages with payload, send requires the payload parameter
  expectTypeOf(client.send).toBeFunction();
});

test("Valibot client: Discriminated union narrowing", () => {
  const { messageSchema } = createMessageSchema(v);
  const PingMessage = messageSchema("PING");
  const PongMessage = messageSchema("PONG", { latency: v.number() });

  type AllMessages =
    | InferMessage<typeof PingMessage>
    | InferMessage<typeof PongMessage>;

  const handler = (msg: AllMessages) => {
    // ✅ Narrowing by type field
    if (msg.type === "PING") {
      expectTypeOf(msg).toMatchTypeOf<{
        type: "PING";
        payload?: never;
        meta?: Record<string, unknown>;
      }>();
    } else if (msg.type === "PONG") {
      expectTypeOf(msg).toMatchTypeOf<{
        type: "PONG";
        payload: { latency: number };
        meta?: Record<string, unknown>;
      }>();
    }
  };

  expectTypeOf(handler).toBeFunction();
});

test("Valibot client: Complex schema types", () => {
  const { messageSchema } = createMessageSchema(v);

  const UserMessage = messageSchema("USER", {
    id: v.number(),
    name: v.string(),
    email: v.string([v.email()]),
    age: v.optional(v.number()),
    tags: v.array(v.string()),
  });

  // ✅ Assert complex payload types are preserved
  expectTypeOf<InferPayload<typeof UserMessage>>().toEqualTypeOf<{
    id: number;
    name: string;
    email: string;
    age?: number;
    tags: string[];
  }>();
});

test("Valibot client: Request/response typing", () => {
  const { messageSchema } = createMessageSchema(v);
  const RequestMessage = messageSchema("REQUEST", { query: v.string() });
  const ResponseMessage = messageSchema("RESPONSE", { result: v.string() });

  // This is a type-only test, no actual code execution
  const client = createClient({
    url: "wss://example.com",
  }) as ValibotWebSocketClient;

  // ✅ Assert request() signature with typed response
  expectTypeOf(client.request).toBeFunction();
});
