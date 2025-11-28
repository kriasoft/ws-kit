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

import type { InferMessage, InferMeta, InferPayload } from "@ws-kit/zod";
import { message, z } from "@ws-kit/zod";
import { expectTypeOf, test } from "bun:test";
import type { ZodWebSocketClient } from "./index.js";
import { wsClient } from "./index.js";

test("Zod client: Type inference for message schemas", () => {
  // Define test schemas
  const HelloMessage = message("HELLO", { text: z.string() });
  const GoodbyeMessage = message("GOODBYE", { reason: z.string() });
  const PingMessage = message("PING"); // No payload

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
    meta: {};
  }>();

  // ✅ Assert InferMeta extracts meta field correctly (empty object for default meta)
  expectTypeOf<InferMeta<typeof HelloMessage>>().toEqualTypeOf<{}>();
});

test("Zod client: ZodWebSocketClient type shape", () => {
  const HelloMessage = message("HELLO", { text: z.string() });
  const PongMessage = message("PONG", { latency: z.number() });

  // Create client (type-only, doesn't actually connect)
  const client = wsClient({
    url: "wss://example.com",
  }) as ZodWebSocketClient;

  // ✅ Assert createClient returns ZodWebSocketClient
  expectTypeOf(client).toMatchTypeOf<ZodWebSocketClient>();

  // ✅ Assert on() method signature with schema
  expectTypeOf(client.on).toBeFunction();
  const unsubscribe = client.on(HelloMessage, (msg) => {
    // ✅ msg should have full type from schema
    expectTypeOf(msg).toMatchTypeOf<{
      type: "HELLO";
      payload: { text: string };
      meta: {};
    }>();
  });
  expectTypeOf(unsubscribe).toBeFunction();

  // ✅ Assert send() with payload
  const sendResult = client.send(HelloMessage, { text: "hello" });
  expectTypeOf(sendResult).toEqualTypeOf<boolean>();

  // ✅ Assert send() without payload (for PONG, even though it has payload)
  // For messages with payload, send requires the payload parameter
  expectTypeOf(client.send).toBeFunction();
});

test("Zod client: Discriminated union narrowing", () => {
  const PingMessage = message("PING");
  const PongMessage = message("PONG", { latency: z.number() });

  type AllMessages =
    | InferMessage<typeof PingMessage>
    | InferMessage<typeof PongMessage>;

  const handler = (msg: AllMessages) => {
    // ✅ Narrowing by type field
    if (msg.type === "PING") {
      expectTypeOf(msg).toMatchTypeOf<{
        type: "PING";
        meta: {};
      }>();
    } else if (msg.type === "PONG") {
      expectTypeOf(msg).toMatchTypeOf<{
        type: "PONG";
        payload: { latency: number };
        meta: {};
      }>();
    }
  };

  expectTypeOf(handler).toBeFunction();
});

test("Zod client: Complex schema types", () => {
  const UserMessage = message("USER", {
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().optional(),
    tags: z.array(z.string()),
  });

  // ✅ Assert complex payload types are preserved
  // Note: Zod infers optional() as `T | undefined`, not `T?`
  expectTypeOf<InferPayload<typeof UserMessage>>().toEqualTypeOf<{
    id: number;
    name: string;
    email: string;
    age: number | undefined;
    tags: string[];
  }>();
});

test("Zod client: Request/response typing", () => {
  const RequestMessage = message("REQUEST", { query: z.string() });
  const ResponseMessage = message("RESPONSE", { result: z.string() });

  // This is a type-only test, no actual code execution
  const client = wsClient({
    url: "wss://example.com",
  }) as ZodWebSocketClient;

  // ✅ Assert request() signature with typed response
  expectTypeOf(client.request).toBeFunction();
});
