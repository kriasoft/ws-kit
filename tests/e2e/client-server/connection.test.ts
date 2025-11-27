// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * E2E test: Client-server WebSocket connection flow.
 *
 * Tests the full lifecycle of a WebSocket connection using real
 * network communication (localhost).
 */

import type { MessageDescriptor } from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { withMessaging } from "@ws-kit/zod";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  collectMessages,
  createTestServer,
  waitForOpen,
  type TestServer,
} from "../../helpers/server.js";

// Simple schema helper for testing
function schema(type: string): MessageDescriptor {
  return { type, kind: "event" } as const;
}

describe("E2E: Client-Server Connection", () => {
  let testServer: TestServer;
  let clients: WebSocket[] = [];

  beforeEach(() => {
    const router = createRouter().plugin(withMessaging());

    // Simple echo handler
    router.on(schema("PING"), (ctx) => {
      const payload = ctx.payload as { text: string };
      ctx.send(schema("PONG"), { reply: `Pong: ${payload.text}` });
    });

    testServer = createTestServer(router);
  });

  afterEach(() => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
    clients = [];
    testServer.close();
  });

  function createClient(): WebSocket {
    const ws = new WebSocket(testServer.wsUrl);
    clients.push(ws);
    return ws;
  }

  it("should establish WebSocket connection", async () => {
    const client = createClient();
    await waitForOpen(client);
    expect(client.readyState).toBe(WebSocket.OPEN);
  });

  it("should route messages and receive responses", async () => {
    const client = createClient();
    await waitForOpen(client);

    // Send a ping message (payload must be nested)
    client.send(JSON.stringify({ type: "PING", payload: { text: "Hello" } }));

    // Wait for pong response
    const messages = await collectMessages(client, 1);

    expect(messages[0]).toMatchObject({
      type: "PONG",
      payload: { reply: "Pong: Hello" },
    });
  });

  it("should handle multiple sequential messages", async () => {
    const client = createClient();
    await waitForOpen(client);

    // Send multiple pings
    client.send(JSON.stringify({ type: "PING", payload: { text: "One" } }));
    client.send(JSON.stringify({ type: "PING", payload: { text: "Two" } }));
    client.send(JSON.stringify({ type: "PING", payload: { text: "Three" } }));

    const messages = await collectMessages(client, 3);

    expect(
      messages.map((m: any) => ({ type: m.type, reply: m.payload?.reply })),
    ).toEqual([
      { type: "PONG", reply: "Pong: One" },
      { type: "PONG", reply: "Pong: Two" },
      { type: "PONG", reply: "Pong: Three" },
    ]);
  });

  it("should handle multiple concurrent clients", async () => {
    const client1 = createClient();
    const client2 = createClient();

    await Promise.all([waitForOpen(client1), waitForOpen(client2)]);

    // Both clients send messages
    client1.send(
      JSON.stringify({ type: "PING", payload: { text: "Client1" } }),
    );
    client2.send(
      JSON.stringify({ type: "PING", payload: { text: "Client2" } }),
    );

    const [msg1, msg2] = await Promise.all([
      collectMessages(client1, 1),
      collectMessages(client2, 1),
    ]);

    expect(msg1[0]).toMatchObject({
      type: "PONG",
      payload: { reply: "Pong: Client1" },
    });
    expect(msg2[0]).toMatchObject({
      type: "PONG",
      payload: { reply: "Pong: Client2" },
    });
  });
});
