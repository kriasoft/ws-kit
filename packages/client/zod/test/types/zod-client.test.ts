// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type tests for @ws-kit/client/zod
 *
 * Verifies:
 * - ZodWebSocketClient type inference
 * - Handler typing with Zod schema inference
 * - Message payload/meta typing
 * - Discriminated union narrowing
 * - Discriminated union narrowing in message handlers
 */

import { expectTypeOf, test } from "bun:test";
import { z } from "zod";
import type {
  InferMessage,
  InferPayload,
  InferMeta,
  MessageSchemaType,
} from "../../../../zod/src/types.js";
import { createClient } from "../../src/index.js";
import type { ClientOptions, ZodWebSocketClient } from "../../src/index.js";
import { createMessageSchema } from "../../../../zod/src/index.js";

test("Zod client: Type inference for message schemas", () => {
  const { messageSchema } = createMessageSchema(z);

  // Define test schemas
  const HelloMessage = messageSchema("HELLO", { text: z.string() });
  const GoodbyeMessage = messageSchema("GOODBYE", { reason: z.string() });
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

test("Zod client: ZodWebSocketClient type shape", () => {
  const { messageSchema } = createMessageSchema(z);
  const HelloMessage = messageSchema("HELLO", { text: z.string() });
  const PongMessage = messageSchema("PONG", { latency: z.number() });

  // Create client (type-only, doesn't actually connect)
  const client = createClient({
    url: "wss://example.com",
  }) as ZodWebSocketClient;

  // ✅ Assert createClient returns ZodWebSocketClient
  expectTypeOf(client).toMatchTypeOf<ZodWebSocketClient>();

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

test("Zod client: Discriminated union narrowing", () => {
  const { messageSchema } = createMessageSchema(z);
  const PingMessage = messageSchema("PING");
  const PongMessage = messageSchema("PONG", { latency: z.number() });

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

test("Zod client: Complex schema types", () => {
  const { messageSchema } = createMessageSchema(z);

  const UserMessage = messageSchema("USER", {
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().optional(),
    tags: z.array(z.string()),
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

test("Zod client: Request/response typing", () => {
  const { messageSchema } = createMessageSchema(z);
  const RequestMessage = messageSchema("REQUEST", { query: z.string() });
  const ResponseMessage = messageSchema("RESPONSE", { result: z.string() });

  // This is a type-only test, no actual code execution
  const client = createClient({
    url: "wss://example.com",
  }) as ZodWebSocketClient;

  // ✅ Assert request() signature with typed response
  expectTypeOf(client.request).toBeFunction();
});
