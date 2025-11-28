// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { PubSubError } from "../../src/core/error.js";
import { createTopics } from "../../src/core/topics.js";
import { createMockWs } from "../helpers.js";

describe("OptimisticTopics - maxTopicsPerConnection limit", () => {
  describe("subscribe() with limit enforcement", () => {
    it("should allow subscriptions up to the limit", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // Should succeed for topics within limit
      await topics.subscribe("topic:1");
      await topics.subscribe("topic:2");
      await topics.subscribe("topic:3");

      expect(topics.size).toBe(3);
      expect(topics.has("topic:1")).toBe(true);
      expect(topics.has("topic:2")).toBe(true);
      expect(topics.has("topic:3")).toBe(true);
    });

    it("should throw TOPIC_LIMIT_EXCEEDED when limit is reached", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 2 });

      // Subscribe to 2 topics (at limit)
      await topics.subscribe("topic:1");
      await topics.subscribe("topic:2");
      expect(topics.size).toBe(2);

      // Third subscribe should fail
      try {
        await topics.subscribe("topic:3");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
        expect((err as PubSubError).details).toEqual({
          limit: 2,
          current: 2,
        });
      }

      // Internal state should be unchanged
      expect(topics.size).toBe(2);
      expect(topics.has("topic:3")).toBe(false);
    });

    it("should allow resubscribe to existing topic even at limit (idempotent)", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 2 });

      await topics.subscribe("topic:1");
      await topics.subscribe("topic:2");

      // Resubscribe to existing topic should be idempotent and not throw
      await topics.subscribe("topic:1");

      expect(topics.size).toBe(2);
    });

    it("should work with limit = 1", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 1 });

      await topics.subscribe("topic:1");
      expect(topics.size).toBe(1);

      try {
        await topics.subscribe("topic:2");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
      }
    });
  });

  describe("subscribeMany() with limit enforcement", () => {
    it("should allow batch subscriptions up to the limit", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 5 });

      const result = await topics.subscribeMany(["room:1", "room:2", "room:3"]);

      expect(result.added).toBe(3);
      expect(result.total).toBe(3);
      expect(topics.size).toBe(3);
    });

    it("should throw TOPIC_LIMIT_EXCEEDED in batch when limit exceeded", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // First batch: subscribe to 2 topics
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Second batch: try to add 3 more topics (would exceed limit)
      try {
        await topics.subscribeMany(["room:3", "room:4", "room:5"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
        expect((err as PubSubError).details).toEqual({
          limit: 3,
          current: 2,
          requested: 3,
        });
      }

      // State should be unchanged (atomic operation failed)
      expect(topics.size).toBe(2);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.has("room:4")).toBe(false);
      expect(topics.has("room:5")).toBe(false);
    });

    it("should succeed when batch fits remaining space", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 5 });

      // First batch: subscribe to 2 topics
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Second batch: add 3 more topics (exactly fits the limit)
      const result = await topics.subscribeMany(["room:3", "room:4", "room:5"]);

      expect(result.added).toBe(3);
      expect(result.total).toBe(5);
      expect(topics.size).toBe(5);
    });

    it("should deduplicate input before checking limit", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // Subscribe with duplicates in the input
      const result = await topics.subscribeMany([
        "room:1",
        "room:1",
        "room:1",
        "room:2",
        "room:2",
      ]);

      // Only 2 unique topics
      expect(result.added).toBe(2);
      expect(result.total).toBe(2);
      expect(topics.size).toBe(2);
    });

    it("should account for already-subscribed topics when calculating new count", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // Subscribe to 2 topics first
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Try to subscribeMany with 1 new + 1 existing topic
      // Should succeed because only 1 new topic
      const result = await topics.subscribeMany(["room:1", "room:3"]);

      expect(result.added).toBe(1); // Only room:3 is new
      expect(result.total).toBe(3);
      expect(topics.size).toBe(3);
    });
  });

  describe("set() with limit enforcement", () => {
    it("should allow replace when resulting size within limit", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 4 });

      // Subscribe to 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);

      // Replace with 4 topics (some new, some removed)
      const result = await topics.set(["room:2", "room:3", "room:4", "room:5"]);

      expect(result.added).toBe(2); // room:4, room:5
      expect(result.removed).toBe(1); // room:1
      expect(result.total).toBe(4); // room:2, room:3, room:4, room:5
    });

    it("should throw TOPIC_LIMIT_EXCEEDED when replace would exceed limit", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // Subscribe to 2 topics
      await topics.subscribeMany(["room:1", "room:2"]);

      // Try to replace with 5 new topics (would remove 2, add 5 = net +3, resulting in 5 total)
      try {
        await topics.set([
          "room:10",
          "room:11",
          "room:12",
          "room:13",
          "room:14",
        ]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
        expect((err as PubSubError).details).toEqual({
          limit: 3,
          current: 2,
          toAdd: 5, // All 5 are new
          toRemove: 2, // room:1, room:2 are removed
          resulting: 5, // 2 - 2 + 5 = 5, exceeds limit of 3
        });
      }

      // State should be unchanged
      expect(topics.size).toBe(2);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:10")).toBe(false);
    });

    it("should succeed when replace removes excess to stay within limit", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // Subscribe to 5 topics (pretend limit was higher initially)
      // Start with a fresh instance with higher limit, then reduce
      const topicsLarge = createTopics(mockWs, {
        maxTopicsPerConnection: 10,
      });
      await topicsLarge.subscribeMany(["a", "b", "c", "d", "e"]);
      expect(topicsLarge.size).toBe(5);

      // Now create new instance with limit 3
      const topicsLimited = createTopics(mockWs, {
        maxTopicsPerConnection: 3,
      });
      // Manually set up state for testing (simulating old subscriptions)
      // Instead, let's test a valid scenario:

      // Start with limit 3
      await topics.subscribeMany(["a", "b", "c"]); // at limit

      // Replace: remove 2, add 1 (net -1, stays within limit)
      const result = await topics.set(["a", "d"]);

      expect(result.removed).toBe(2); // b, c
      expect(result.added).toBe(1); // d
      expect(result.total).toBe(2);
    });

    it("should handle replace with exact limit boundary", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // Start with 2 topics
      await topics.subscribeMany(["a", "b"]);

      // Replace with desired set of 3 (add 1, remove 0)
      const result = await topics.set(["a", "b", "c"]);

      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(3); // Exactly at limit
    });

    it("should fail when replace would put us 1 over limit", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 });

      // Start with 2 topics
      await topics.subscribeMany(["a", "b"]);

      // Try to replace with 4 topics (exceeds limit by 1)
      try {
        await topics.set(["a", "b", "c", "d"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
      }

      // State unchanged
      expect(topics.size).toBe(2);
    });
  });

  describe("limit = Infinity (disabled mode)", () => {
    it("should allow unlimited subscriptions when limit is Infinity", async () => {
      const mockWs = createMockWs();
      // Default: Infinity (no limit)
      const topics = createTopics(mockWs);

      // Subscribe to many topics
      for (let i = 0; i < 1000; i++) {
        await topics.subscribe(`topic:${i}`);
      }

      expect(topics.size).toBe(1000);
    });

    it("should allow unlimited subscribeMany when limit is Infinity", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: Infinity,
      });

      const topicArray = Array.from({ length: 500 }, (_, i) => `topic:${i}`);
      const result = await topics.subscribeMany(topicArray);

      expect(result.added).toBe(500);
      expect(result.total).toBe(500);
    });

    it("should allow unlimited replace when limit is Infinity", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: Infinity,
      });

      const topicArray = Array.from({ length: 1000 }, (_, i) => `topic:${i}`);
      const result = await topics.set(topicArray);

      expect(result.added).toBe(1000);
      expect(result.total).toBe(1000);
    });
  });

  describe("error conditions and edge cases", () => {
    it("should throw TOPIC_LIMIT_EXCEEDED before calling adapter", async () => {
      const adapterCalls: string[] = [];
      const mockWs = createMockWs("test-123", {
        subscribe: mock((topic: string) => {
          adapterCalls.push(topic);
        }),
      });
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 2 });

      adapterCalls.length = 0;
      await topics.subscribe("topic:1");
      expect(adapterCalls.length).toBe(1);

      // Second subscribe: still okay
      adapterCalls.length = 0;
      await topics.subscribe("topic:2");
      expect(adapterCalls.length).toBe(1);

      // Third subscribe: should fail at limit check, before adapter call
      adapterCalls.length = 0;
      try {
        await topics.subscribe("topic:3");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
      }

      // Verify adapter was NOT called for failed subscribe
      expect(adapterCalls.length).toBe(0);
    });

    it("should enforce limit across subscribe() and subscribeMany() calls", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, { maxTopicsPerConnection: 4 });

      // Use subscribe() to add 2 topics
      await topics.subscribe("a");
      await topics.subscribe("b");

      // Use subscribeMany() to add 2 more (at limit)
      await topics.subscribeMany(["c", "d"]);
      expect(topics.size).toBe(4);

      // Use subscribe() to try adding 1 more (should fail)
      try {
        await topics.subscribe("e");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
      }

      // Verify limit works with subscribeMany too
      try {
        await topics.subscribeMany(["e", "f"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
      }
    });

    it("should include helpful debug info in error data", async () => {
      const mockWs = createMockWs();
      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: 10,
      });

      // Subscribe to 7 topics
      await topics.subscribeMany(Array.from({ length: 7 }, (_, i) => `t:${i}`));

      // Try to add 5 more (exceeds by 2)
      try {
        await topics.subscribeMany(
          Array.from({ length: 5 }, (_, i) => `new:${i}`),
        );
        expect.unreachable("Should have thrown");
      } catch (err) {
        const details = (err as PubSubError).details as Record<string, number>;
        expect(details.limit).toBe(10);
        expect(details.current).toBe(7);
        expect(details.requested).toBe(5); // All 5 are new
      }
    });
  });
});
