/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import { messageSchema, WebSocketRouter } from "../valibot";
import type { SendFunction } from "../shared/types";

describe("Valibot messageSchema", () => {
  it("should create a basic message schema without payload", () => {
    const schema = messageSchema("PING");

    const result = v.safeParse(schema, {
      type: "PING",
      meta: {
        clientId: "client-123",
        timestamp: Date.now(),
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.type).toBe("PING");
      expect(result.output.meta.clientId).toBe("client-123");
    }
  });

  it("should create a message schema with payload", () => {
    const schema = messageSchema(
      "JOIN_ROOM",
      v.object({
        roomId: v.string(),
        userId: v.string(),
      }),
    );

    const result = v.safeParse(schema, {
      type: "JOIN_ROOM",
      meta: {
        clientId: "client-123",
        timestamp: Date.now(),
      },
      payload: {
        roomId: "room-1",
        userId: "user-123",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.type).toBe("JOIN_ROOM");
      expect(result.output.payload.roomId).toBe("room-1");
      expect(result.output.payload.userId).toBe("user-123");
    }
  });

  it("should validate and reject invalid payloads", () => {
    const schema = messageSchema(
      "JOIN_ROOM",
      v.object({
        roomId: v.string(),
        userId: v.string(),
      }),
    );

    const result = v.safeParse(schema, {
      type: "JOIN_ROOM",
      meta: {
        clientId: "client-123",
        timestamp: Date.now(),
      },
      payload: {
        roomId: 123, // Invalid: should be string
        userId: "user-123",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("Valibot WebSocketRouter", () => {
  it("should create a router instance", () => {
    const router = new WebSocketRouter();
    expect(router).toBeDefined();
    expect(router.websocket).toBeDefined();
  });

  it("should register message handlers", () => {
    const router = new WebSocketRouter<{ userId?: string }>();
    const schema = messageSchema("PING");

    const handler = ({ meta, send }: { meta: unknown; send: SendFunction }) => {
      send(schema, undefined, {
        correlationId: (meta as { correlationId?: string }).correlationId,
      });
    };

    expect(() => {
      router.onMessage(schema, handler);
    }).not.toThrow();
  });
});
