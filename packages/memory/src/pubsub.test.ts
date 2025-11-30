// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { memoryPubSub } from "./pubsub.js";

/**
 * Collects all values from an async iterable into an array.
 */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

describe("memoryPubSub", () => {
  describe("subscribe/unsubscribe", () => {
    it("adds client to topic", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");

      const subscribers = await collect(pubsub.getSubscribers("room:123"));
      expect(subscribers).toEqual(["client-1"]);
    });

    it("adds multiple clients to same topic", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");
      await pubsub.subscribe("client-2", "room:123");
      await pubsub.subscribe("client-3", "room:123");

      const subscribers = await collect(pubsub.getSubscribers("room:123"));
      expect(subscribers).toHaveLength(3);
      expect(subscribers).toContain("client-1");
      expect(subscribers).toContain("client-2");
      expect(subscribers).toContain("client-3");
    });

    it("is idempotent (no duplicates on re-subscribe)", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");
      await pubsub.subscribe("client-1", "room:123");
      await pubsub.subscribe("client-1", "room:123");

      const subscribers = await collect(pubsub.getSubscribers("room:123"));
      expect(subscribers).toEqual(["client-1"]);
    });

    it("removes client from topic", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");
      await pubsub.subscribe("client-2", "room:123");
      await pubsub.unsubscribe("client-1", "room:123");

      const subscribers = await collect(pubsub.getSubscribers("room:123"));
      expect(subscribers).toEqual(["client-2"]);
    });

    it("is idempotent (no error if not subscribed)", async () => {
      const pubsub = memoryPubSub();

      // Should not throw
      await pubsub.unsubscribe("client-1", "room:123");
      await pubsub.unsubscribe("client-1", "nonexistent");
    });

    it("cleans up empty topics after last unsubscribe", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");
      expect(await pubsub.hasTopic("room:123")).toBe(true);

      await pubsub.unsubscribe("client-1", "room:123");
      expect(await pubsub.hasTopic("room:123")).toBe(false);

      const topics = await pubsub.listTopics();
      expect(topics).not.toContain("room:123");
    });
  });

  describe("getSubscribers", () => {
    it("returns empty iterator for non-existent topic", async () => {
      const pubsub = memoryPubSub();

      const subscribers = await collect(pubsub.getSubscribers("nonexistent"));
      expect(subscribers).toEqual([]);
    });

    it("returns all subscribers for topic", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("a", "topic");
      await pubsub.subscribe("b", "topic");
      await pubsub.subscribe("c", "topic");

      const subscribers = await collect(pubsub.getSubscribers("topic"));
      expect(subscribers).toHaveLength(3);
    });
  });

  describe("publish", () => {
    it("returns matched=0 for non-existent topic", async () => {
      const pubsub = memoryPubSub();

      const result = await pubsub.publish({
        topic: "nonexistent",
        type: "TEST",
        payload: {},
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matched).toBe(0);
        expect(result.capability).toBe("exact");
      }
    });

    it("returns exact matched count", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");
      await pubsub.subscribe("client-2", "room:123");
      await pubsub.subscribe("client-3", "room:123");

      const result = await pubsub.publish({
        topic: "room:123",
        type: "MESSAGE",
        payload: { text: "hello" },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matched).toBe(3);
        expect(result.capability).toBe("exact");
      }
    });

    it("rejects excludeSelf option with UNSUPPORTED error", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");

      const result = await pubsub.publish(
        { topic: "room:123", type: "TEST", payload: {} },
        { excludeSelf: true },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNSUPPORTED");
        expect(result.retryable).toBe(false);
        expect(result.details?.feature).toBe("excludeSelf");
      }
    });
  });

  describe("listTopics", () => {
    it("returns empty array initially", async () => {
      const pubsub = memoryPubSub();

      const topics = await pubsub.listTopics();
      expect(topics).toEqual([]);
    });

    it("returns active topics", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:a");
      await pubsub.subscribe("client-2", "room:b");
      await pubsub.subscribe("client-3", "room:c");

      const topics = await pubsub.listTopics();
      expect(topics).toHaveLength(3);
      expect([...topics].sort()).toEqual(["room:a", "room:b", "room:c"]);
    });

    it("returns frozen array (immutable)", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");

      const topics = await pubsub.listTopics();
      expect(Object.isFrozen(topics)).toBe(true);
    });
  });

  describe("hasTopic", () => {
    it("returns false for non-existent topic", async () => {
      const pubsub = memoryPubSub();

      expect(await pubsub.hasTopic("nonexistent")).toBe(false);
    });

    it("returns true for topic with subscribers", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");

      expect(await pubsub.hasTopic("room:123")).toBe(true);
    });

    it("returns false after last subscriber removed", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:123");
      await pubsub.unsubscribe("client-1", "room:123");

      expect(await pubsub.hasTopic("room:123")).toBe(false);
    });
  });

  describe("replace", () => {
    it("replaces all subscriptions atomically", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:a");
      await pubsub.subscribe("client-1", "room:b");

      await pubsub.replace("client-1", ["room:c", "room:d"]);

      // Old topics should not have client
      expect(await collect(pubsub.getSubscribers("room:a"))).toEqual([]);
      expect(await collect(pubsub.getSubscribers("room:b"))).toEqual([]);

      // New topics should have client
      expect(await collect(pubsub.getSubscribers("room:c"))).toEqual([
        "client-1",
      ]);
      expect(await collect(pubsub.getSubscribers("room:d"))).toEqual([
        "client-1",
      ]);
    });

    it("returns accurate added/removed/total counts", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:a");
      await pubsub.subscribe("client-1", "room:b");
      await pubsub.subscribe("client-1", "room:c");

      // Replace: keep b, remove a/c, add d/e
      const result = await pubsub.replace("client-1", [
        "room:b",
        "room:d",
        "room:e",
      ]);

      expect(result.added).toBe(2); // d, e
      expect(result.removed).toBe(2); // a, c
      expect(result.total).toBe(3); // b, d, e
    });

    it("early exits when sets are equal (no-op)", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:a");
      await pubsub.subscribe("client-1", "room:b");

      const result = await pubsub.replace("client-1", ["room:a", "room:b"]);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(2);
    });

    it("handles adding new topics for new client", async () => {
      const pubsub = memoryPubSub();

      const result = await pubsub.replace("new-client", ["room:x", "room:y"]);

      expect(result.added).toBe(2);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(2);

      expect(await collect(pubsub.getSubscribers("room:x"))).toEqual([
        "new-client",
      ]);
    });

    it("handles removing all topics", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:a");
      await pubsub.subscribe("client-1", "room:b");

      const result = await pubsub.replace("client-1", []);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(2);
      expect(result.total).toBe(0);

      expect(await pubsub.hasTopic("room:a")).toBe(false);
      expect(await pubsub.hasTopic("room:b")).toBe(false);
    });

    it("cleans up empty topics during replacement", async () => {
      const pubsub = memoryPubSub();

      await pubsub.subscribe("client-1", "room:solo");
      expect(await pubsub.hasTopic("room:solo")).toBe(true);

      await pubsub.replace("client-1", ["room:new"]);

      expect(await pubsub.hasTopic("room:solo")).toBe(false);
      expect(await pubsub.hasTopic("room:new")).toBe(true);
    });
  });
});
