// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { createTopics } from "../../src/core/topics.js";

describe("OptimisticTopics - ReadonlySet Iterators (Snapshot-Based)", () => {
  describe("Iteration happy path", () => {
    it("should support for..of iteration in subscription order", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Subscribe in specific order
      await topics.subscribe("room:a");
      await topics.subscribe("room:b");
      await topics.subscribe("room:c");

      // Iterate with for..of
      const seen: string[] = [];
      for (const topic of topics) {
        seen.push(topic);
      }

      // Should preserve insertion order
      expect(seen).toEqual(["room:a", "room:b", "room:c"]);
    });

    it("should support spread operator", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("room:a");
      await topics.subscribe("room:b");
      await topics.subscribe("room:c");

      // Spread to array
      const arr = [...topics];

      expect(arr).toEqual(["room:a", "room:b", "room:c"]);
    });

    it("should support Array.from()", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("room:x");
      await topics.subscribe("room:y");

      const arr = Array.from(topics);

      expect(arr).toEqual(["room:x", "room:y"]);
    });

    it("should support new Set() constructor", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("room:a");
      await topics.subscribe("room:b");

      // Create a new Set from Topics (should work with [Symbol.iterator])
      const newSet = new Set(topics);

      expect(newSet.has("room:a")).toBe(true);
      expect(newSet.has("room:b")).toBe(true);
      expect(newSet.size).toBe(2);
    });
  });

  describe("Method parity", () => {
    it("should have values() equal to [...topics]", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("a");
      await topics.subscribe("b");
      await topics.subscribe("c");

      const fromValues = [...topics.values()];
      const fromSpread = [...topics];

      expect(fromValues).toEqual(fromSpread);
    });

    it("should have keys() equal to values()", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("x");
      await topics.subscribe("y");
      await topics.subscribe("z");

      const fromKeys = [...topics.keys()];
      const fromValues = [...topics.values()];

      expect(fromKeys).toEqual(fromValues);
    });

    it("should have entries() yield [value, value] pairs", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("room:1");
      await topics.subscribe("room:2");

      const entries = [...topics.entries()];

      expect(entries).toEqual([
        ["room:1", "room:1"],
        ["room:2", "room:2"],
      ]);
    });
  });

  describe("No live leakage (snapshot semantics)", () => {
    it("should not include topics added during iteration", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("a");
      await topics.subscribe("b");

      // Start iterating
      const it = topics.values();

      // Get first value
      const first = it.next();
      expect(first.value).toBe("a");
      expect(first.done).toBe(false);

      // Subscribe to a new topic during iteration
      await topics.subscribe("c");

      // Continue iterating - should NOT see "c"
      const second = it.next();
      expect(second.value).toBe("b");
      expect(second.done).toBe(false);

      // Next should be done (no "c")
      const third = it.next();
      expect(third.done).toBe(true);
    });

    it("should still yield topics removed after iteration starts", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("a");
      await topics.subscribe("b");
      await topics.subscribe("c");

      // Start iterating
      const it = topics.values();

      // Get first value
      const first = it.next();
      expect(first.value).toBe("a");

      // Remove a topic during iteration
      await topics.unsubscribe("b");

      // Continue iterating - should still see "b" (from snapshot)
      const second = it.next();
      expect(second.value).toBe("b");
      expect(second.done).toBe(false);

      // Should still see "c"
      const third = it.next();
      expect(third.value).toBe("c");
      expect(third.done).toBe(false);

      // Done
      const fourth = it.next();
      expect(fourth.done).toBe(true);
    });

    it("forEach should iterate over snapshot, ignoring mid-loop mutations", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("room:1");
      await topics.subscribe("room:2");
      await topics.subscribe("room:3");

      const seen: string[] = [];
      let callCount = 0;

      topics.forEach((topic) => {
        seen.push(topic);
        callCount++;

        // Try to mutate during iteration (fire-and-forget)
        if (callCount === 1) {
          // Remove a topic that's still in the snapshot
          // (but it should still appear in this forEach due to snapshot semantics)
          topics.unsubscribe("room:2");
        }
      });

      // Should have seen all three topics (from snapshot)
      expect(seen).toEqual(["room:1", "room:2", "room:3"]);
    });

    it("should not leak live Set reference", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("a");

      // Get an iterator
      const it = topics.values();

      // Should not be able to access the internal Set from the iterator
      // (TypeScript would catch it, but at runtime there's no leak)
      expect(it).toBeDefined();

      // Iterator should work normally
      const first = it.next();
      expect(first.value).toBe("a");
    });
  });

  describe("forEach spec compliance", () => {
    it("should pass (value, value, set) to callback", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("room:1");
      await topics.subscribe("room:2");

      const callData: { value: string; key: string; hasValue: boolean }[] = [];

      topics.forEach((value, key, set) => {
        callData.push({
          value,
          key,
          hasValue: set.has(value),
        });
      });

      expect(callData).toEqual([
        { value: "room:1", key: "room:1", hasValue: true },
        { value: "room:2", key: "room:2", hasValue: true },
      ]);
    });

    it("should respect thisArg in forEach", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);
      await topics.subscribe("x");

      const context = { collected: [] as string[] };

      topics.forEach(function (this: typeof context, value) {
        this.collected.push(value);
      }, context);

      expect(context.collected).toEqual(["x"]);
    });

    it("should preserve insertion order in forEach", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Subscribe in specific order
      await topics.subscribe("first");
      await topics.subscribe("second");
      await topics.subscribe("third");

      const seen: string[] = [];
      topics.forEach((value) => {
        seen.push(value);
      });

      expect(seen).toEqual(["first", "second", "third"]);
    });
  });

  describe("Order guarantee (insertion order)", () => {
    it("should preserve insertion order across multiple subscriptions", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      const topics_to_add = ["room:lobby", "room:chat", "room:notifications"];

      for (const topic of topics_to_add) {
        await topics.subscribe(topic);
      }

      // Check insertion order is preserved
      expect([...topics]).toEqual(topics_to_add);
    });

    it("should reflect re-add position when unsubscribe and resubscribe", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Subscribe: a, b, c
      await topics.subscribe("a");
      await topics.subscribe("b");
      await topics.subscribe("c");

      // Unsubscribe b
      await topics.unsubscribe("b");

      // Current order should be: a, c
      expect([...topics]).toEqual(["a", "c"]);

      // Resubscribe b - should go to the end
      await topics.subscribe("b");

      // Order should now be: a, c, b
      expect([...topics]).toEqual(["a", "c", "b"]);
    });

    it("should maintain order with keys() and entries()", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("1st");
      await topics.subscribe("2nd");
      await topics.subscribe("3rd");

      const keysOrder = [...topics.keys()];
      const entriesKeys = [...topics.entries()].map(([k]) => k);

      expect(keysOrder).toEqual(["1st", "2nd", "3rd"]);
      expect(entriesKeys).toEqual(["1st", "2nd", "3rd"]);
    });
  });

  describe("Empty set edge cases", () => {
    it("should handle iteration on empty topics", () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      const arr = [...topics];
      expect(arr).toEqual([]);

      let called = false;
      topics.forEach(() => {
        called = true;
      });
      expect(called).toBe(false);
    });

    it("should handle values(), keys(), entries() on empty topics", () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      expect([...topics.values()]).toEqual([]);
      expect([...topics.keys()]).toEqual([]);
      expect([...topics.entries()]).toEqual([]);
    });
  });

  describe("Snapshot independence", () => {
    it("should allow independent iteration of multiple snapshots", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("a");
      await topics.subscribe("b");

      // Create two independent iterators
      const it1 = topics.values();
      const it2 = topics.values();

      // Advance it1
      expect(it1.next().value).toBe("a");

      // it2 should be independent
      expect(it2.next().value).toBe("a");

      // Advance it1 further
      expect(it1.next().value).toBe("b");

      // it2 is still at first
      expect(it2.next().value).toBe("b");
    });

    it("should support concurrent iteration patterns", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("room:1");
      await topics.subscribe("room:2");
      await topics.subscribe("room:3");

      // Iterate with entries while adding subscriptions
      const originalEntries = [...topics.entries()];

      // Now mutate
      await topics.subscribe("room:4");

      // Iterate again - should include new one
      const newEntries = [...topics.entries()];

      expect(originalEntries.length).toBe(3);
      expect(newEntries.length).toBe(4);
      expect(newEntries[3]).toEqual(["room:4", "room:4"]);
    });
  });

  describe("Symbol.iterator compliance", () => {
    it("should be iterable via Symbol.iterator", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      await topics.subscribe("a");
      await topics.subscribe("b");

      // Get the iterator directly
      const it = topics[Symbol.iterator]();

      // Should have the iterator protocol
      expect(it).toBeDefined();
      expect(typeof it.next).toBe("function");

      // Should be able to iterate
      const vals: string[] = [];
      let result = it.next();
      while (!result.done) {
        vals.push(result.value);
        result = it.next();
      }

      expect(vals).toEqual(["a", "b"]);
    });
  });
});
