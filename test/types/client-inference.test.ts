// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests for typed client adapters (ADR-002).
 * Validates full type inference in handlers, send, and request methods.
 *
 * @see specs/adrs.md#ADR-002 - Type override implementation
 * @see specs/test-requirements.md#client-type-inference - Test requirements
 */

import { expectTypeOf, test } from "bun:test";
import { z } from "zod";
import * as v from "valibot";
import { createMessageSchema as createZodSchema } from "../../zod/index.js";
import { createMessageSchema as createValibotSchema } from "../../valibot/index.js";
import { createClient as createZodClient } from "../../packages/client/zod/src/index.js";
import { createClient as createValibotClient } from "../../packages/client/valibot/src/index.js";
import { createClient as createGenericClient } from "../../packages/client/src/index.js";

// Zod schemas for testing
const { messageSchema: zodMessageSchema } = createZodSchema(z);
const ZodJoinRoomOK = zodMessageSchema("JOIN_ROOM_OK", { roomId: z.string() });
const ZodNoPayload = zodMessageSchema("NO_PAYLOAD");
const ZodRequest = zodMessageSchema("REQ", { id: z.number() });
const ZodReply = zodMessageSchema("REPLY", { result: z.boolean() });
const ZodRoomMsg = zodMessageSchema(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Required meta
);
const ZodOptionalMeta = zodMessageSchema(
  "NOTIFY",
  { text: z.string() },
  { priority: z.enum(["low", "high"]).optional() },
);

// Valibot schemas for testing
const { messageSchema: valibotMessageSchema } = createValibotSchema(v);
const ValibotJoinRoomOK = valibotMessageSchema("JOIN_ROOM_OK", {
  roomId: v.string(),
});
const ValibotNoPayload = valibotMessageSchema("NO_PAYLOAD");
const ValibotRequest = valibotMessageSchema("REQ", { id: v.number() });
const ValibotReply = valibotMessageSchema("REPLY", { result: v.boolean() });

// ============================================================================
// Zod Client Type Tests
// ============================================================================

test("Zod: on() handler receives fully typed message", () => {
  const client = createZodClient({ url: "ws://test" });

  client.on(ZodJoinRoomOK, (msg) => {
    // ✅ Positive: msg fully typed
    expectTypeOf(msg).toEqualTypeOf<{
      type: "JOIN_ROOM_OK";
      meta: { timestamp?: number; correlationId?: string };
      payload: { roomId: string };
    }>();
    expectTypeOf(msg.payload.roomId).toBeString();
    expectTypeOf(msg.type).toEqualTypeOf<"JOIN_ROOM_OK">();
    expectTypeOf(msg.meta.timestamp).toEqualTypeOf<number | undefined>();
  });
});

test("Zod: on() handler has no payload access for no-payload schema", () => {
  const client = createZodClient({ url: "ws://test" });

  client.on(ZodNoPayload, (msg) => {
    expectTypeOf(msg.type).toEqualTypeOf<"NO_PAYLOAD">();
    expectTypeOf(msg.meta).not.toBeUnknown();

    // @ts-expect-error - payload should not exist
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    msg.payload;
  });
});

test("Zod: request() returns typed promise (with payload)", () => {
  const client = createZodClient({ url: "ws://test" });

  const promise = client.request(ZodRequest, { id: 42 }, ZodReply);

  // ✅ reply fully typed
  expectTypeOf(promise).toEqualTypeOf<
    Promise<{
      type: "REPLY";
      meta: { timestamp?: number; correlationId?: string };
      payload: { result: boolean };
    }>
  >();
});

test("Zod: request() without payload for no-payload schema", () => {
  const client = createZodClient({ url: "ws://test" });

  // Type-only check: request() with no-payload schema omits payload param
  type RequestCall = ReturnType<
    typeof client.request<typeof ZodNoPayload, typeof ZodReply>
  >;

  expectTypeOf<RequestCall>().toEqualTypeOf<
    Promise<{
      type: "REPLY";
      meta: { timestamp?: number; correlationId?: string };
      payload: { result: boolean };
    }>
  >();
});

test("Zod: extended meta with required fields", () => {
  const client = createZodClient({ url: "ws://test" });

  // RoomMsg has required meta.roomId field
  client.on(ZodRoomMsg, (msg) => {
    expectTypeOf(msg.meta.roomId).toBeString();
    expectTypeOf(msg.payload.text).toBeString();
  });
});

test("Zod: extended meta with optional fields", () => {
  const client = createZodClient({ url: "ws://test" });

  // OptionalMeta has optional meta.priority field
  client.on(ZodOptionalMeta, (msg) => {
    expectTypeOf(msg.meta.priority).toEqualTypeOf<"low" | "high" | undefined>();
    expectTypeOf(msg.payload.text).toBeString();
  });
});

test("Zod: send() with optional meta (priority field)", () => {
  const client = createZodClient({ url: "ws://test" });

  // Type-level validation: send() accepts optional meta with priority field
  // Since ZodOptionalMeta has payload, it uses the 3-param overload:
  // send(schema, payload, opts?)

  // Verify the method signature accepts optional meta
  client.send(
    ZodOptionalMeta,
    { text: "test" },
    { meta: { priority: "high" } },
  );

  client.send(
    ZodOptionalMeta,
    { text: "test" },
    { meta: {} }, // priority is optional
  );

  client.send(
    ZodOptionalMeta,
    { text: "test" },
    // opts entirely optional
  );
});

// ============================================================================
// Valibot Client Type Tests
// ============================================================================

// Note: Valibot runtime tests require client support for Valibot schema type extraction
// These are type-only validation tests that confirm the type system works correctly

test("Valibot: type inference works at compile time", () => {
  const client = createValibotClient({ url: "ws://test" });

  // Type-only check: handler parameter should be typed
  type HandlerMsg = Parameters<
    Parameters<typeof client.on<typeof ValibotJoinRoomOK>>[1]
  >[0];

  expectTypeOf<HandlerMsg>().toEqualTypeOf<{
    type: "JOIN_ROOM_OK";
    meta: { timestamp?: number; correlationId?: string };
    payload: { roomId: string };
  }>();
});

test("Valibot: no-payload schema type inference", () => {
  const client = createValibotClient({ url: "ws://test" });

  // Type-only check: no-payload handler has no payload field
  type HandlerMsg = Parameters<
    Parameters<typeof client.on<typeof ValibotNoPayload>>[1]
  >[0];

  expectTypeOf<HandlerMsg>().toEqualTypeOf<{
    type: "NO_PAYLOAD";
    meta: { timestamp?: number; correlationId?: string };
  }>();
});

test("Valibot: request() without payload for no-payload schema", () => {
  const ValibotRequest = valibotMessageSchema("REQ_NO_PAYLOAD");
  const ValibotReply = valibotMessageSchema("REPLY", { result: v.boolean() });

  const client = createValibotClient({ url: "ws://test" });

  // Type-only check: request() with no-payload schema omits payload param
  type RequestCall = ReturnType<
    typeof client.request<typeof ValibotRequest, typeof ValibotReply>
  >;
  type ReplyType = Awaited<RequestCall>;

  // Reply includes full message structure (type, meta, payload)
  expectTypeOf<ReplyType>().toMatchTypeOf<{
    type: "REPLY";
    payload: { result: boolean };
  }>();
});

// ============================================================================
// Generic Client Type Tests (Fallback Behavior)
// ============================================================================

test("Generic client: handlers receive unknown (no type inference)", () => {
  const client = createGenericClient({ url: "ws://test" });

  client.on(ZodJoinRoomOK, (msg) => {
    // ⚠️ msg is unknown in generic client
    expectTypeOf(msg).toBeUnknown();

    // Manual type assertion required
    const typed = msg as { type: string; payload: { roomId: string } };
    expectTypeOf(typed.payload.roomId).toBeString();
  });
});

// ============================================================================
// Cross-Validator Compatibility Tests
// ============================================================================

test("Typed clients provide better inference than generic client", () => {
  const zodClient = createZodClient({ url: "ws://test" });
  const genericClient = createGenericClient({ url: "ws://test" });

  // Zod client: handler infers message type
  zodClient.on(ZodJoinRoomOK, (msg) => {
    expectTypeOf(msg).not.toBeUnknown();
    expectTypeOf(msg.payload.roomId).toBeString();
  });

  // Generic client: handler receives unknown
  genericClient.on(ZodJoinRoomOK, (msg) => {
    expectTypeOf(msg).toBeUnknown();
  });
});
