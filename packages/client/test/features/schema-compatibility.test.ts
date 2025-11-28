// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Schema compatibility tests.
 *
 * Verifies that different schema formats (wrapped, raw Zod) work correctly
 * with the client's handler registration and message routing.
 *
 * Regression: Ensures type extraction doesn't return "object" (the schema kind)
 * instead of the literal message type.
 *
 * Note: Raw Valibot schemas (v.object) can't be used directly with the client
 * because they lack .safeParse() method. Use message() wrapper for Valibot.
 */

import type { WebSocketClient } from "@ws-kit/client";
import { createClient } from "@ws-kit/client";
import { v, message as valibotMessage } from "@ws-kit/valibot";
import { z, message as zodMessage } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockWebSocket } from "../helpers.js";

describe("Client: Schema Compatibility", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;
  let client: WebSocketClient;

  beforeEach(() => {
    mockWs = createMockWebSocket();
    client = createClient({
      url: "ws://test",
      wsFactory: () => {
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });
  });

  afterEach(async () => {
    await client.close();
  });

  function simulateReceive(msg: unknown) {
    mockWs._trigger.message(msg);
  }

  describe("wrapped schemas (messageType property)", () => {
    it("extracts type from Zod message() wrapper", async () => {
      const ZodWrapped = zodMessage("ZOD_WRAPPED", { id: z.number() });
      const received: unknown[] = [];

      await client.connect();
      client.on(ZodWrapped, (msg) => received.push(msg));

      simulateReceive({ type: "ZOD_WRAPPED", payload: { id: 42 } });
      expect(received).toHaveLength(1);
    });

    it("extracts type from Valibot message() wrapper", async () => {
      const ValibotWrapped = valibotMessage("VALIBOT_WRAPPED", {
        id: v.number(),
      });
      const received: unknown[] = [];

      await client.connect();
      client.on(ValibotWrapped, (msg) => received.push(msg));

      simulateReceive({ type: "VALIBOT_WRAPPED", payload: { id: 42 } });
      expect(received).toHaveLength(1);
    });
  });

  describe("raw Zod schemas (shape.type.value fallback)", () => {
    it("extracts type from raw Zod object schema", async () => {
      // Raw schema without message() wrapper - uses shape.type.value fallback
      const ZodRaw = z.object({
        type: z.literal("ZOD_RAW"),
        payload: z.object({ value: z.string() }),
      });
      const received: unknown[] = [];

      await client.connect();
      client.on(ZodRaw as any, (msg) => received.push(msg));

      simulateReceive({ type: "ZOD_RAW", payload: { value: "test" } });
      expect(received).toHaveLength(1);

      // Verify it doesn't incorrectly match "object" type (the bug we're preventing)
      simulateReceive({ type: "object", payload: { value: "wrong" } });
      expect(received).toHaveLength(1); // Still 1, not matched
    });

    it("extracts type from raw Zod strict object schema", async () => {
      const ZodStrict = z
        .object({
          type: z.literal("ZOD_STRICT"),
          payload: z.object({ value: z.string() }),
        })
        .strict();
      const received: unknown[] = [];

      await client.connect();
      client.on(ZodStrict as any, (msg) => received.push(msg));

      simulateReceive({ type: "ZOD_STRICT", payload: { value: "test" } });
      expect(received).toHaveLength(1);
    });
  });

  describe("raw Valibot schemas (Standard Schema)", () => {
    it("supports raw Valibot schemas via Standard Schema", async () => {
      // Raw Valibot schema (not wrapped with message())
      const RawSchema = v.object({
        type: v.literal("RAW_VALIBOT"),
        payload: v.object({ value: v.string() }),
      });
      const received: unknown[] = [];

      await client.connect();
      client.on(RawSchema as any, (msg) => received.push(msg));

      simulateReceive({ type: "RAW_VALIBOT", payload: { value: "test" } });
      expect(received).toHaveLength(1);
    });

    it("rejects invalid data with Standard Schema", async () => {
      const RawSchema = v.object({
        type: v.literal("RAW_VALIBOT"),
        payload: v.object({ value: v.string() }),
      });
      const received: unknown[] = [];

      await client.connect();
      client.on(RawSchema as any, (msg) => received.push(msg));

      // Invalid payload (number instead of string)
      simulateReceive({ type: "RAW_VALIBOT", payload: { value: 123 } });
      expect(received).toHaveLength(0);
    });
  });
});
