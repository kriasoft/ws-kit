// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { BunPubSub } from "../src/pubsub";

describe("BunPubSub", () => {
  let mockServer: any;

  beforeEach(() => {
    // Create a mock Bun Server with publish method
    const publishCalls: [string, string | ArrayBuffer][] = [];

    mockServer = {
      publish: mock((topic: string, data: string | ArrayBuffer) => {
        publishCalls.push([topic, data]);
      }),
      publishCalls,
    };
  });

  it("should create BunPubSub instance", () => {
    const pubsub = new BunPubSub(mockServer);
    expect(pubsub).toBeDefined();
  });

  it("should publish string messages directly", async () => {
    const pubsub = new BunPubSub(mockServer);
    const message = "Hello, WebSocket!";

    await pubsub.publish("room:123", message);

    expect(mockServer.publishCalls).toHaveLength(1);
    expect(mockServer.publishCalls[0]).toEqual(["room:123", message]);
  });

  it("should JSON-stringify object messages", async () => {
    const pubsub = new BunPubSub(mockServer);
    const message = { text: "Hello", userId: 123 };

    await pubsub.publish("room:123", message);

    expect(mockServer.publishCalls).toHaveLength(1);
    const [topic, data] = mockServer.publishCalls[0];
    expect(topic).toBe("room:123");
    expect(data).toBe(JSON.stringify(message));
  });

  it("should pass through Uint8Array messages", async () => {
    const pubsub = new BunPubSub(mockServer);
    const message = new Uint8Array([1, 2, 3, 4, 5]);

    await pubsub.publish("room:123", message);

    expect(mockServer.publishCalls).toHaveLength(1);
    const [topic, data] = mockServer.publishCalls[0];
    expect(topic).toBe("room:123");
    expect(data).toEqual(message);
  });

  it("should pass through ArrayBuffer messages", async () => {
    const pubsub = new BunPubSub(mockServer);
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    view[0] = 1;
    view[1] = 2;

    await pubsub.publish("room:123", buffer);

    expect(mockServer.publishCalls).toHaveLength(1);
    const [topic, data] = mockServer.publishCalls[0];
    expect(topic).toBe("room:123");
    expect(data).toBe(buffer);
  });

  it("should handle multiple publish calls to different channels", async () => {
    const pubsub = new BunPubSub(mockServer);

    await pubsub.publish("room:123", "message1");
    await pubsub.publish("room:456", "message2");
    await pubsub.publish("room:123", "message3");

    expect(mockServer.publishCalls).toHaveLength(3);
    expect(mockServer.publishCalls[0]).toEqual(["room:123", "message1"]);
    expect(mockServer.publishCalls[1]).toEqual(["room:456", "message2"]);
    expect(mockServer.publishCalls[2]).toEqual(["room:123", "message3"]);
  });

  it("should have no-op subscribe method", () => {
    const pubsub = new BunPubSub(mockServer);
    const handler = () => {};

    // Should not throw
    expect(() => {
      pubsub.subscribe("room:123", handler);
    }).not.toThrow();
  });

  it("should have no-op unsubscribe method", () => {
    const pubsub = new BunPubSub(mockServer);
    const handler = () => {};

    // Should not throw
    expect(() => {
      pubsub.unsubscribe("room:123", handler);
    }).not.toThrow();
  });

  it("should serialize numbers to JSON", async () => {
    const pubsub = new BunPubSub(mockServer);

    await pubsub.publish("channel", 42);

    expect(mockServer.publishCalls).toHaveLength(1);
    const [, data] = mockServer.publishCalls[0];
    expect(data).toBe("42");
  });

  it("should serialize booleans to JSON", async () => {
    const pubsub = new BunPubSub(mockServer);

    await pubsub.publish("channel", true);

    expect(mockServer.publishCalls).toHaveLength(1);
    const [, data] = mockServer.publishCalls[0];
    expect(data).toBe("true");
  });

  it("should serialize arrays to JSON", async () => {
    const pubsub = new BunPubSub(mockServer);
    const message = [1, 2, 3];

    await pubsub.publish("channel", message);

    expect(mockServer.publishCalls).toHaveLength(1);
    const [, data] = mockServer.publishCalls[0];
    expect(data).toBe(JSON.stringify(message));
  });

  it("should serialize null to JSON", async () => {
    const pubsub = new BunPubSub(mockServer);

    await pubsub.publish("channel", null);

    expect(mockServer.publishCalls).toHaveLength(1);
    const [, data] = mockServer.publishCalls[0];
    expect(data).toBe("null");
  });
});
