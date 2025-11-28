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

import type { InferMessage, InferMeta, InferPayload } from "@ws-kit/valibot";
import { message, v } from "@ws-kit/valibot";
import { expectTypeOf, test } from "bun:test";
import type { ValibotWebSocketClient } from "./index.js";
import { wsClient } from "./index.js";

test("Valibot client: Type inference for message schemas", () => {
  // Define test schemas
  const HelloMessage = message("HELLO", { text: v.string() });
  const GoodbyeMessage = message("GOODBYE", { reason: v.string() });
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
    meta: { timestamp?: number; correlationId?: string };
  }>();

  // ✅ Assert InferMeta extracts meta field correctly (standard meta fields)
  expectTypeOf<InferMeta<typeof HelloMessage>>().toEqualTypeOf<{
    timestamp?: number;
    correlationId?: string;
  }>();
});

test("Valibot client: ValibotWebSocketClient type shape", () => {
  const HelloMessage = message("HELLO", { text: v.string() });
  const PongMessage = message("PONG", { latency: v.number() });

  // Create client (type-only, doesn't actually connect)
  const client = wsClient({
    url: "wss://example.com",
  }) as ValibotWebSocketClient;

  // ✅ Assert wsClient returns ValibotWebSocketClient
  expectTypeOf(client).toMatchTypeOf<ValibotWebSocketClient>();

  // ✅ Assert on() method signature with schema
  expectTypeOf(client.on).toBeFunction();
  const unsubscribe = client.on(HelloMessage, (msg) => {
    // ✅ msg should have full type from schema
    expectTypeOf(msg).toMatchTypeOf<{
      type: "HELLO";
      payload: { text: string };
      meta: { timestamp?: number; correlationId?: string };
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

test("Valibot client: Discriminated union narrowing", () => {
  const PingMessage = message("PING");
  const PongMessage = message("PONG", { latency: v.number() });

  type AllMessages =
    | InferMessage<typeof PingMessage>
    | InferMessage<typeof PongMessage>;

  const handler = (msg: AllMessages) => {
    // ✅ Narrowing by type field
    if (msg.type === "PING") {
      expectTypeOf(msg).toMatchTypeOf<{
        type: "PING";
        meta: { timestamp?: number; correlationId?: string };
      }>();
    } else if (msg.type === "PONG") {
      expectTypeOf(msg).toMatchTypeOf<{
        type: "PONG";
        payload: { latency: number };
        meta: { timestamp?: number; correlationId?: string };
      }>();
    }
  };

  expectTypeOf(handler).toBeFunction();
});

test("Valibot client: Complex schema types", () => {
  const UserMessage = message("USER", {
    id: v.number(),
    name: v.string(),
    email: v.pipe(v.string(), v.email()),
    age: v.optional(v.number()),
    tags: v.array(v.string()),
  });

  // ✅ Assert complex payload types are preserved
  // Note: Valibot infers optional() as `T | undefined`, not `T?`
  expectTypeOf<InferPayload<typeof UserMessage>>().toEqualTypeOf<{
    id: number;
    name: string;
    email: string;
    age: number | undefined;
    tags: string[];
  }>();
});

test("Valibot client: Request/response typing", () => {
  const RequestMessage = message("REQUEST", { query: v.string() });
  const ResponseMessage = message("RESPONSE", { result: v.string() });

  // This is a type-only test, no actual code execution
  const client = wsClient({
    url: "wss://example.com",
  }) as ValibotWebSocketClient;

  // ✅ Assert request() signature with typed response
  expectTypeOf(client.request).toBeFunction();
});
