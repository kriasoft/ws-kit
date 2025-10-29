// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import { DurablePubSub } from "../src/pubsub.js";

describe("DurablePubSub", () => {
  it("should create an instance", () => {
    const pubsub = new DurablePubSub();
    expect(pubsub).toBeDefined();
  });

  it("should have publish method", async () => {
    const pubsub = new DurablePubSub();
    expect(pubsub.publish).toBeFunction();

    // Should not throw
    await pubsub.publish("test-channel", { text: "hello" });
  });

  it("should have subscribe method", () => {
    const pubsub = new DurablePubSub();
    expect(pubsub.subscribe).toBeFunction();

    const handler = (msg: unknown) => {
      console.log(msg);
    };
    pubsub.subscribe("test-channel", handler);
  });

  it("should have unsubscribe method", () => {
    const pubsub = new DurablePubSub();
    const handler = (msg: unknown) => {
      console.log(msg);
    };

    pubsub.subscribe("test-channel", handler);
    pubsub.unsubscribe("test-channel", handler);
  });

  it("should serialize messages correctly", async () => {
    const pubsub = new DurablePubSub();

    // String message
    await pubsub.publish("channel1", "test");

    // Object message
    await pubsub.publish("channel2", { type: "TEST", data: { id: 123 } });

    // ArrayBuffer
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    await pubsub.publish("channel3", buffer);
  });

  it("should handle destroy", () => {
    const pubsub = new DurablePubSub();
    expect(() => pubsub.destroy()).not.toThrow();
  });
});
