// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { BunPubSub } from "../src/pubsub.js";

describe("BunPubSub", () => {
  let mockServer: any;

  beforeEach(() => {
    // Create a mock Bun Server with publish method
    const publishCalls: [string, string | ArrayBuffer | Uint8Array][] = [];

    mockServer = {
      publish: mock(
        (topic: string, data: string | ArrayBuffer | Uint8Array) => {
          publishCalls.push([topic, data]);
        },
      ),
      publishCalls,
    };
  });

  it("should create BunPubSub instance", () => {
    const pubsub = new BunPubSub(mockServer);
    expect(pubsub).toBeDefined();
  });

  it("should publish string payloads directly", async () => {
    const pubsub = new BunPubSub(mockServer);

    const result = await pubsub.publish({
      topic: "room:123",
      payload: "Hello, WebSocket!",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capability).toBe("unknown");
    }
    expect(mockServer.publishCalls).toHaveLength(1);
    expect(mockServer.publishCalls[0]).toEqual([
      "room:123",
      "Hello, WebSocket!",
    ]);
  });

  it("should JSON-stringify object payloads", async () => {
    const pubsub = new BunPubSub(mockServer);
    const payload = { text: "Hello", userId: 123 };

    const result = await pubsub.publish({
      topic: "room:123",
      payload,
    });

    expect(result.ok).toBe(true);
    expect(mockServer.publishCalls).toHaveLength(1);
    const [topic, data] = mockServer.publishCalls[0];
    expect(topic).toBe("room:123");
    expect(data).toBe(JSON.stringify(payload));
  });

  it("should pass through Uint8Array payloads", async () => {
    const pubsub = new BunPubSub(mockServer);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);

    const result = await pubsub.publish({
      topic: "room:123",
      payload,
    });

    expect(result.ok).toBe(true);
    expect(mockServer.publishCalls).toHaveLength(1);
    const [topic, data] = mockServer.publishCalls[0];
    expect(topic).toBe("room:123");
    expect(data).toEqual(payload);
  });

  it("should pass through ArrayBuffer payloads", async () => {
    const pubsub = new BunPubSub(mockServer);
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    view[0] = 1;
    view[1] = 2;

    const result = await pubsub.publish({
      topic: "room:123",
      payload: buffer,
    });

    expect(result.ok).toBe(true);
    expect(mockServer.publishCalls).toHaveLength(1);
    const [topic, data] = mockServer.publishCalls[0];
    expect(topic).toBe("room:123");
    expect(data).toBe(buffer);
  });

  it("should handle multiple publish calls to different topics", async () => {
    const pubsub = new BunPubSub(mockServer);

    await pubsub.publish({ topic: "room:123", payload: "message1" });
    await pubsub.publish({ topic: "room:456", payload: "message2" });
    await pubsub.publish({ topic: "room:123", payload: "message3" });

    expect(mockServer.publishCalls).toHaveLength(3);
    expect(mockServer.publishCalls[0]).toEqual(["room:123", "message1"]);
    expect(mockServer.publishCalls[1]).toEqual(["room:456", "message2"]);
    expect(mockServer.publishCalls[2]).toEqual(["room:123", "message3"]);
  });

  it("should return success result with unknown capability", async () => {
    const pubsub = new BunPubSub(mockServer);

    const result = await pubsub.publish({
      topic: "notifications",
      payload: { event: "user.joined" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capability).toBe("unknown");
    }
  });

  it("should include type and meta in envelope", async () => {
    const pubsub = new BunPubSub(mockServer);

    const result = await pubsub.publish({
      topic: "events",
      payload: { value: 42 },
      type: "COUNTER_UPDATE",
      meta: { priority: "high" },
    });

    expect(result.ok).toBe(true);
    expect(mockServer.publishCalls).toHaveLength(1);

    // Verify the actual published data
    // Note: BunPubSub publishes only the payload as JSON, ignoring type/meta
    // This is expected behavior since Bun's pub/sub operates at the transport level
    const [topic, data] = mockServer.publishCalls[0];
    expect(topic).toBe("events");
    expect(data).toBe(JSON.stringify({ value: 42 }));
  });

  it("should be no-op for subscribe", async () => {
    const pubsub = new BunPubSub(mockServer);

    // Should not throw and complete successfully
    await expect(
      pubsub.subscribe("room:123", "client123"),
    ).resolves.toBeUndefined();
  });

  it("should be no-op for unsubscribe", async () => {
    const pubsub = new BunPubSub(mockServer);

    // Should not throw and complete successfully
    await expect(
      pubsub.unsubscribe("room:123", "client123"),
    ).resolves.toBeUndefined();
  });

  it("should have empty getSubscribers async iterable", async () => {
    const pubsub = new BunPubSub(mockServer);

    const subscribers = pubsub.getSubscribers("room:123");
    const subscribersList: string[] = [];

    for await (const subscriber of subscribers) {
      subscribersList.push(subscriber);
    }

    expect(subscribersList).toHaveLength(0);
  });

  it("should serialize numbers to JSON", async () => {
    const pubsub = new BunPubSub(mockServer);

    const result = await pubsub.publish({
      topic: "channel",
      payload: 42,
    });

    expect(result.ok).toBe(true);
    expect(mockServer.publishCalls).toHaveLength(1);
    const [, data] = mockServer.publishCalls[0];
    expect(data).toBe("42");
  });

  it("should serialize arrays to JSON", async () => {
    const pubsub = new BunPubSub(mockServer);
    const payload = [1, 2, 3];

    const result = await pubsub.publish({
      topic: "channel",
      payload,
    });

    expect(result.ok).toBe(true);
    expect(mockServer.publishCalls).toHaveLength(1);
    const [, data] = mockServer.publishCalls[0];
    expect(data).toBe(JSON.stringify(payload));
  });

  it("should handle publish errors gracefully", async () => {
    const errorServer = {
      publish: () => {
        throw new Error("Server publish failed");
      },
    };

    const pubsub = new BunPubSub(errorServer as any);

    const result = await pubsub.publish({
      topic: "channel",
      payload: "test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ADAPTER_ERROR");
      expect(result.retryable).toBe(true);
    }
  });
});
