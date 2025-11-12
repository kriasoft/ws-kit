// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { TopicsImpl } from "../../src/core/topics.js";
import { PubSubError } from "../../src/core/error.js";

describe("TopicsImpl - set()", () => {
  describe("basic replace semantics", () => {
    it("should replace topics: add and remove in one operation", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Initially subscribe to room:1 and room:2
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Replace with room:2 and room:3 (remove room:1, keep room:2, add room:3)
      const result = await topics.set(["room:2", "room:3"]);

      expect(result.added).toBe(1); // room:3
      expect(result.removed).toBe(1); // room:1
      expect(result.total).toBe(2); // room:2, room:3

      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should handle empty replacement (unsubscribe all)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to some topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Replace with empty set (unsubscribe all)
      const result = await topics.set([]);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(3);
      expect(result.total).toBe(0);
      expect(topics.size).toBe(0);
    });

    it("should handle subscripting to all new topics", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start empty
      expect(topics.size).toBe(0);

      // Replace with 3 new topics
      const result = await topics.set(["room:1", "room:2", "room:3"]);

      expect(result.added).toBe(3);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(3);
      expect(topics.size).toBe(3);
    });
  });

  describe("idempotency", () => {
    it("should be idempotent (no-op when desired set equals current set)", async () => {
      const adapterCalls = { subscribe: 0, unsubscribe: 0 };
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          adapterCalls.subscribe++;
        }),
        unsubscribe: mock(() => {
          adapterCalls.unsubscribe++;
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to some topics
      adapterCalls.subscribe = 0;
      adapterCalls.unsubscribe = 0;
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(adapterCalls.subscribe).toBe(3);

      // Replace with the SAME set (idempotent no-op)
      adapterCalls.subscribe = 0;
      adapterCalls.unsubscribe = 0;
      const result = await topics.set(["room:1", "room:2", "room:3"]);

      // No adapter calls should be made
      expect(adapterCalls.subscribe).toBe(0);
      expect(adapterCalls.unsubscribe).toBe(0);

      // But result should still indicate the final state
      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(3);
    });

    it("should return early without adapter calls when delta is empty", async () => {
      let setupPhase = true;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          if (!setupPhase) {
            throw new Error("Should not be called in replace phase");
          }
        }),
        unsubscribe: mock(() => {
          if (!setupPhase) {
            throw new Error("Should not be called in replace phase");
          }
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to topics first (setup phase)
      await topics.subscribeMany(["room:1", "room:2"]);
      setupPhase = false; // Now enter replace phase where adapter calls should not happen

      // Replace with same set - should not throw, should not call adapter
      const result = await topics.set(["room:1", "room:2"]);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(2);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate input topics", async () => {
      const adapterCalls: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          adapterCalls.push(topic);
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Replace with duplicates
      adapterCalls.length = 0;
      const result = await topics.set(["room:1", "room:1", "room:2", "room:1"]);

      // Only 2 unique topics should be subscribed
      expect(result.added).toBe(2);
      expect(result.total).toBe(2);
      expect(topics.size).toBe(2);

      // Adapter should receive each unique topic once
      expect(adapterCalls.sort()).toEqual(["room:1", "room:2"]);
    });
  });

  describe("validation", () => {
    it("should validate all desired topics before adapter calls", async () => {
      const adapterCalls: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          adapterCalls.push(topic);
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Try to replace with an invalid topic in the middle
      try {
        await topics.set(["room:1", "invalid topic!!!", "room:2"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("INVALID_TOPIC");
      }

      // NO adapter calls should have been made
      expect(adapterCalls).toHaveLength(0);
      expect(topics.size).toBe(0);
    });

    it("should throw on invalid topic format", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      try {
        await topics.set(["topic with spaces"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("INVALID_TOPIC");
      }

      expect(topics.size).toBe(0);
    });
  });

  describe("atomicity", () => {
    it("should maintain atomicity when adapter fails on subscribe", async () => {
      let subscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          subscribeCount++;
          if (subscribeCount === 2) {
            throw new Error("Adapter failure");
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to initial topics
      await topics.subscribeMany(["room:1"]);
      expect(topics.size).toBe(1);

      // Try to replace with new topics; adapter will fail
      try {
        await topics.set(["room:2", "room:3", "room:4"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // ATOMIC guarantee: state should be unchanged
      expect(topics.size).toBe(1);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.has("room:4")).toBe(false);
    });

    it("should maintain atomicity when adapter fails on unsubscribe", async () => {
      let unsubscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock((topic: string) => {
          unsubscribeCount++;
          if (unsubscribeCount === 1) {
            throw new Error("Adapter failure");
          }
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to initial topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Try to replace; adapter will fail on first unsubscribe
      try {
        await topics.set(["room:1"]); // Should remove room:2 and room:3
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // ATOMIC guarantee: all topics should still be subscribed
      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should apply all changes atomically on success", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to initial topics
      await topics.subscribeMany(["room:1", "room:2", "room:3", "room:4"]);
      expect(topics.size).toBe(4);

      // Replace with mixed set
      const result = await topics.set([
        "room:2", // keep
        "room:5", // add
        "room:6", // add
      ]);

      // All changes applied atomically
      expect(result.added).toBe(2); // room:5, room:6
      expect(result.removed).toBe(3); // room:1, room:3, room:4
      expect(result.total).toBe(3); // room:2, room:5, room:6

      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.has("room:4")).toBe(false);
      expect(topics.has("room:5")).toBe(true);
      expect(topics.has("room:6")).toBe(true);
    });

    it("should rollback in correct order when adapter fails during subscribe at capacity", async () => {
      // This test verifies the fix for the rollback order bug.
      // When at capacity and swapping topics, if subscribe fails after unsubscribe succeeds,
      // rollback must free space first (unsubscribe new) before restoring old (re-subscribe).
      let subscribeCountInPhase = 0;
      let inReplacePhase = false;
      const adapterState = {
        subscriptions: new Set<string>(["room:1", "room:2", "room:3"]),
        capacity: 3,
      };

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          if (inReplacePhase) {
            subscribeCountInPhase++;
            // Fail on the 2nd subscribe call in replace phase (room:5) to trigger rollback
            if (subscribeCountInPhase === 2) {
              throw new Error("Adapter failure");
            }
          }
          // Simulate adapter enforcing capacity limit
          if (
            !adapterState.subscriptions.has(topic) &&
            adapterState.subscriptions.size >= adapterState.capacity
          ) {
            throw new Error("CAPACITY_EXCEEDED");
          }
          adapterState.subscriptions.add(topic);
        }),
        unsubscribe: mock((topic: string) => {
          adapterState.subscriptions.delete(topic);
        }),
      };

      const topics = new TopicsImpl(mockWs, 3);

      // Initial state: subscribed to room:1, room:2, room:3 (at capacity)
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);
      expect(adapterState.subscriptions).toEqual(
        new Set(["room:1", "room:2", "room:3"]),
      );

      // Now attempt a replace that will fail during subscribe during rollback
      // Scenario: we're at capacity (3/3), want to replace with room:3, room:4, room:5 (stays at capacity 3)
      // Forward phase:
      //   - Unsubscribe room:1, room:2 → adapter now has room:3 (size=1)
      //   - Subscribe room:4 → adapter has room:3, room:4 (size=2) - succeeds, subscribeCountInPhase=1
      //   - Subscribe room:5 → fails, subscribeCountInPhase=2
      // Rollback must (in reverse order):
      //   1. Unsubscribe room:4 (the newly-added one) → adapter has room:3 (size=1)
      //   2. Re-subscribe room:1 and room:2 → adapter has room:3, room:1, room:2 (size=3) - succeeds
      // If wrong order (re-sub first with room:4 still subscribed), adapter would be at capacity and reject
      inReplacePhase = true;
      subscribeCountInPhase = 0;
      try {
        await topics.set(["room:3", "room:4", "room:5"]);
        expect.unreachable("Should have thrown due to adapter failure");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // CRITICAL: After rollback, state should be fully restored (no partial state)
      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
      expect(topics.has("room:4")).toBe(false);
      expect(topics.has("room:5")).toBe(false);

      // Adapter state should match local state (no divergence)
      expect(adapterState.subscriptions).toEqual(
        new Set(["room:1", "room:2", "room:3"]),
      );
    });
  });

  describe("edge cases", () => {
    it("should handle large topic sets", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Create a large initial set
      const initial = Array.from({ length: 100 }, (_, i) => `room:${i}`);
      await topics.subscribeMany(initial);
      expect(topics.size).toBe(100);

      // Replace with a different large set
      const desired = Array.from({ length: 100 }, (_, i) => `topic:${i}`);
      const result = await topics.set(desired);

      expect(result.added).toBe(100);
      expect(result.removed).toBe(100);
      expect(result.total).toBe(100);

      // Verify new state
      for (let i = 0; i < 100; i++) {
        expect(topics.has(`room:${i}`)).toBe(false);
        expect(topics.has(`topic:${i}`)).toBe(true);
      }
    });

    it("should handle partial overlap correctly", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to rooms 1-5
      await topics.subscribeMany([
        "room:1",
        "room:2",
        "room:3",
        "room:4",
        "room:5",
      ]);

      // Replace with rooms 3-7 (keep 3,4,5; remove 1,2; add 6,7)
      const result = await topics.set([
        "room:3",
        "room:4",
        "room:5",
        "room:6",
        "room:7",
      ]);

      expect(result.added).toBe(2); // 6, 7
      expect(result.removed).toBe(2); // 1, 2
      expect(result.total).toBe(5); // 3,4,5,6,7

      expect([...topics].sort()).toEqual([
        "room:3",
        "room:4",
        "room:5",
        "room:6",
        "room:7",
      ]);
    });

    it("should handle iterator input (not just arrays)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start with some topics
      await topics.subscribeMany(["room:1", "room:2"]);

      // Replace using a Set (iterable)
      const desiredSet = new Set(["room:2", "room:3"]);
      const result = await topics.set(desiredSet);

      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);
      expect(result.total).toBe(2);
    });

    it("should handle topics at the boundary of length limits", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Maximum length topic (128 chars)
      const maxLengthTopic = "a".repeat(128);

      const result = await topics.set([maxLengthTopic]);

      expect(result.added).toBe(1);
      expect(topics.has(maxLengthTopic)).toBe(true);
    });
  });

  describe("return values", () => {
    it("should return correct counts for mixed add/remove operations", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start with some topics
      await topics.subscribeMany(["keep:1", "keep:2", "remove:1", "remove:2"]);

      // Replace: keep some, remove some, add new
      const result = await topics.set([
        "keep:1",
        "keep:2",
        "add:1",
        "add:2",
        "add:3",
      ]);

      expect(result.added).toBe(3);
      expect(result.removed).toBe(2);
      expect(result.total).toBe(5);
    });

    it("should return correct total even on no-op", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start with 5 topics
      await topics.subscribeMany([
        "room:1",
        "room:2",
        "room:3",
        "room:4",
        "room:5",
      ]);

      // Replace with the same set (no-op)
      const result = await topics.set([
        "room:1",
        "room:2",
        "room:3",
        "room:4",
        "room:5",
      ]);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(5); // Total should still be 5
    });
  });

  describe("ReadonlySet interface", () => {
    it("should maintain ReadonlySet compatibility after replace", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Replace with some topics
      await topics.set(["room:1", "room:2", "room:3"]);

      // All ReadonlySet methods should work
      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:99")).toBe(false);

      // Iteration should work
      const topicList = [...topics];
      expect(topicList.length).toBe(3);
      expect(topicList.sort()).toEqual(["room:1", "room:2", "room:3"]);

      // forEach should work
      const collected: string[] = [];
      topics.forEach((topic) => collected.push(topic));
      expect(collected.sort()).toEqual(["room:1", "room:2", "room:3"]);
    });
  });
});

describe("forEach security", () => {
  it("should pass readonly facade via forEach callback (not mutable internal Set)", async () => {
    const mockWs = {
      data: { clientId: "test-123" },
      subscribe: () => {},
      unsubscribe: () => {},
    };

    const topics = new TopicsImpl(mockWs);

    // Subscribe to some topics
    await topics.subscribeMany(["room:1", "room:2"]);
    expect(topics.size).toBe(2);

    // Verify that forEach calls callback with correct arguments
    const calls: any[] = [];
    topics.forEach((value, key, set) => {
      calls.push({ value, key, set, isSameAsTopics: set === topics });
    });

    // Should have been called twice (once per topic)
    expect(calls.length).toBe(2);

    // Each call should pass the TopicsImpl instance as the facade
    // (typed as ReadonlySet at the API boundary)
    for (const call of calls) {
      expect(call.value).toMatch(/^room:/);
      expect(call.key).toBe(call.value);
      expect(call.set).toBe(topics);
      expect(call.isSameAsTopics).toBe(true);
    }

    // Internal state should still be correct
    expect(topics.size).toBe(2);
  });
});
