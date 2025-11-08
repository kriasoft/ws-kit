// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client Outbound Normalization Tests
 *
 * Critical security boundary: client MUST strip reserved/managed keys
 * from user-provided opts.meta before sending.
 *
 * See @docs/specs/client.md#client-normalization
 * See @docs/specs/rules.md#client-side-constraints
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "../../src/index.js";
import { z, message } from "@ws-kit/zod";
import { createMockWebSocket } from "./helpers.js";

// Test schemas
const TestMsg = message("TEST", { id: z.number() });
const RoomMsg = message(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Required meta field
);

describe("Client: Outbound Normalization", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;
  let client: ReturnType<typeof createClient>;

  beforeEach(async () => {
    mockWs = createMockWebSocket();
    client = createClient({
      url: "ws://test",
      wsFactory: () => {
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
    });
    await client.connect();
  });

  afterEach(async () => {
    await client.close();
  });

  it("strips clientId from user meta (security boundary)", async () => {
    client.send(TestMsg, { id: 123 }, { meta: { clientId: "fake-id" } as any });

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].meta).not.toHaveProperty("clientId");
    expect(sent[0].meta).toHaveProperty("timestamp"); // Auto-injected
  });

  it("strips receivedAt from user meta (security boundary)", async () => {
    client.send(TestMsg, { id: 123 }, { meta: { receivedAt: 999 } as any });

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].meta).not.toHaveProperty("receivedAt");
    expect(sent[0].meta).toHaveProperty("timestamp");
  });

  it("strips correlationId from user meta (client-managed field)", async () => {
    // User tries to set correlationId via meta (ignored)
    client.send(
      TestMsg,
      { id: 123 },
      {
        meta: { correlationId: "sneaky" } as any,
        correlationId: "correct", // Only this is used
      },
    );

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    // Only opts.correlationId is used, meta.correlationId stripped
    expect(sent[0].meta.correlationId).toBe("correct");
  });

  it("preserves user-provided timestamp", async () => {
    // User provides timestamp
    client.send(TestMsg, { id: 123 }, { meta: { timestamp: 999 } });

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].meta.timestamp).toBe(999); // User value preserved
  });

  it("auto-injects timestamp if missing", async () => {
    const beforeSend = Date.now();
    client.send(TestMsg, { id: 123 });
    const afterSend = Date.now();

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    const sentTimestamp = sent[0].meta.timestamp;

    expect(sentTimestamp).toBeGreaterThanOrEqual(beforeSend);
    expect(sentTimestamp).toBeLessThanOrEqual(afterSend);
  });

  it("preserves extended meta fields", async () => {
    client.send(RoomMsg, { text: "hello" }, { meta: { roomId: "general" } });

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].meta.roomId).toBe("general");
    expect(sent[0].meta).toHaveProperty("timestamp");
  });

  it("merges meta in correct order: defaults < user < correlationId", async () => {
    // User provides timestamp + correlationId
    client.send(
      RoomMsg,
      { text: "hi" },
      {
        meta: { roomId: "general", timestamp: 123 },
        correlationId: "req-123",
      },
    );

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    const { meta } = sent[0];

    // User timestamp preserved (overrides default)
    expect(meta.timestamp).toBe(123);
    // Extended meta preserved
    expect(meta.roomId).toBe("general");
    // correlationId added last (highest precedence)
    expect(meta.correlationId).toBe("req-123");
  });

  it("strips all reserved keys simultaneously", async () => {
    client.send(
      TestMsg,
      { id: 123 },
      {
        meta: {
          clientId: "fake",
          receivedAt: 111,
          correlationId: "sneaky",
        } as any,
        correlationId: "correct",
      },
    );

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    const { meta } = sent[0];

    // Reserved keys stripped
    expect(meta).not.toHaveProperty("clientId");
    expect(meta).not.toHaveProperty("receivedAt");

    // correlationId from opts wins (meta.correlationId stripped)
    expect(meta.correlationId).toBe("correct");

    // Timestamp auto-injected
    expect(meta).toHaveProperty("timestamp");
  });

  it("handles missing meta gracefully", async () => {
    client.send(TestMsg, { id: 123 }); // No opts.meta

    const sent = mockWs._getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].meta).toHaveProperty("timestamp");
    expect(Object.keys(sent[0].meta)).toHaveLength(1); // Only timestamp
  });
});
