// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Runtime tests for capability gating.
 * Verify that ctx.publish() and ctx.topics exist when withPubSub() is plugged,
 * and that clientId is correctly propagated to the adapter.
 */

import { createRouter, type ServerWebSocket } from "@ws-kit/core";
import { withPubSub } from "@ws-kit/pubsub";
import { message, withZod } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";
import { z } from "zod";

/**
 * Create a mock WebSocket for testing message dispatch.
 */
function createMockWebSocket(clientId = "test-client-123"): ServerWebSocket {
  return {
    send: () => {},
    close: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    data: { clientId },
    readyState: 1,
  } as unknown as ServerWebSocket;
}

describe("Capability Gating (Runtime)", () => {
  it("should provide ctx.publish and ctx.topics when withPubSub is installed", async () => {
    const adapter = {
      async publish() {
        return { ok: true as const, capability: "exact" as const };
      },
      async subscribe() {},
      async unsubscribe() {},
      async *getSubscribers() {},
    };

    const router = createRouter()
      .plugin(withZod())
      .plugin(withPubSub({ adapter }));

    const Message = message("MSG", { text: z.string() });

    let contextChecks = {
      hasPublish: false,
      hasTopics: false,
      hasClientId: false,
      clientIdValue: "",
    };

    router.on(Message, (ctx) => {
      contextChecks = {
        hasPublish: typeof ctx.publish === "function",
        hasTopics:
          typeof ctx.topics === "object" &&
          typeof ctx.topics.subscribe === "function",
        hasClientId: typeof ctx.clientId === "string",
        clientIdValue: ctx.clientId,
      };
    });

    const ws = createMockWebSocket("client-abc");
    await router.websocket.open(ws);
    await router.websocket.message(
      ws,
      JSON.stringify({ type: "MSG", payload: { text: "hello" } }),
    );

    expect(contextChecks.hasPublish).toBe(true);
    expect(contextChecks.hasTopics).toBe(true);
    expect(contextChecks.hasClientId).toBe(true);
    expect(contextChecks.clientIdValue.length).toBeGreaterThan(0);
  });

  it("should pass clientId to adapter.subscribe", async () => {
    const subscribeCalls: { clientId: string; topic: string }[] = [];

    const adapter = {
      async publish() {
        return { ok: true as const, capability: "exact" as const };
      },
      async subscribe(clientId: string, topic: string) {
        subscribeCalls.push({ clientId, topic });
      },
      async unsubscribe() {},
      async *getSubscribers() {},
    };

    const router = createRouter()
      .plugin(withZod())
      .plugin(withPubSub({ adapter }));

    const Message = message("SUB_MSG", { topic: z.string() });

    router.on(Message, async (ctx) => {
      await ctx.topics.subscribe(ctx.payload.topic);
    });

    const ws = createMockWebSocket("user-456");
    await router.websocket.open(ws);
    await router.websocket.message(
      ws,
      JSON.stringify({ type: "SUB_MSG", payload: { topic: "room:123" } }),
    );

    expect(subscribeCalls).toHaveLength(1);
    const call = subscribeCalls[0]!;
    expect(call.topic).toBe("room:123");
    // clientId should be a non-empty string (exact value depends on router internals)
    expect(call.clientId.length).toBeGreaterThan(0);
  });

  it("should call adapter.replace with empty array on connection close", async () => {
    const replaceCalls: { clientId: string; topics: string[] }[] = [];

    const adapter = {
      async publish() {
        return { ok: true as const, capability: "exact" as const };
      },
      async subscribe() {},
      async unsubscribe() {},
      async *getSubscribers() {},
      async replace(clientId: string, topics: string[]) {
        replaceCalls.push({ clientId, topics });
        return { added: 0, removed: 0, total: 0 };
      },
    };

    const router = createRouter()
      .plugin(withZod())
      .plugin(withPubSub({ adapter }));

    const ws = createMockWebSocket("cleanup-test");
    await router.websocket.open(ws);
    await router.websocket.close(ws);

    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0]!.topics).toEqual([]);
    expect(replaceCalls[0]!.clientId.length).toBeGreaterThan(0);
  });

  it("should provide consistent clientId across multiple messages", async () => {
    const adapter = {
      async publish() {
        return { ok: true as const, capability: "exact" as const };
      },
      async subscribe() {},
      async unsubscribe() {},
      async *getSubscribers() {},
    };

    const router = createRouter()
      .plugin(withZod())
      .plugin(withPubSub({ adapter }));

    const Message = message("TRACK", { seq: z.number() });
    const clientIds: string[] = [];

    router.on(Message, (ctx) => {
      clientIds.push(ctx.clientId);
    });

    const ws = createMockWebSocket("stable-client");
    await router.websocket.open(ws);

    // Send multiple messages on same connection
    await router.websocket.message(
      ws,
      JSON.stringify({ type: "TRACK", payload: { seq: 1 } }),
    );
    await router.websocket.message(
      ws,
      JSON.stringify({ type: "TRACK", payload: { seq: 2 } }),
    );
    await router.websocket.message(
      ws,
      JSON.stringify({ type: "TRACK", payload: { seq: 3 } }),
    );

    expect(clientIds).toHaveLength(3);
    // All messages should have the same clientId
    expect(clientIds[0]).toBe(clientIds[1]);
    expect(clientIds[1]).toBe(clientIds[2]);
  });
});
