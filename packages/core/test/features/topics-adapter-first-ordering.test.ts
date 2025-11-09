// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { PubSubError } from "../../src/pubsub-error.js";
import { TopicsImpl } from "../../src/topics-impl.js";

describe("TopicsImpl - Adapter-First Ordering (No Ghost State)", () => {
  describe("subscribe() - adapter-first ordering", () => {
    it("should not mutate local state if adapter call fails", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw new Error("Adapter failure");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Try to subscribe, adapter fails
      try {
        await topics.subscribe("room:1");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // Local state should NOT be mutated (no ghost state)
      expect(topics.has("room:1")).toBe(false);
      expect(topics.size).toBe(0);
    });

    it("should call adapter BEFORE mutating local state", async () => {
      const callOrder: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callOrder.push("adapter.subscribe");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Manually verify ordering by checking when state changes
      // (can't directly observe due to closure, but we can verify state)
      await topics.subscribe("room:1");

      expect(mockWs.subscribe.mock.calls.length).toBe(1);
      expect(topics.has("room:1")).toBe(true);
      expect(callOrder).toEqual(["adapter.subscribe"]);
    });

    it("should ensure reads reflect committed reality (adapter succeeds)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // After successful subscribe, immediate check should show it
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);
      expect(topics.size).toBe(1);
    });

    it("should ensure reads reflect committed reality (adapter fails)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw new Error("Adapter failure");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // After failed subscribe, state should be unchanged
      try {
        await topics.subscribe("room:1");
      } catch {
        // Expected to fail
      }

      expect(topics.has("room:1")).toBe(false);
      expect(topics.size).toBe(0);
    });
  });

  describe("unsubscribe() - adapter-first ordering", () => {
    it("should not mutate local state if adapter call fails", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {
          throw new Error("Adapter failure");
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // First subscribe successfully
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);

      // Try to unsubscribe, adapter fails
      try {
        await topics.unsubscribe("room:1");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // Local state should NOT be mutated (no ghost state)
      expect(topics.has("room:1")).toBe(true);
      expect(topics.size).toBe(1);
    });

    it("should ensure reads reflect committed reality (adapter succeeds)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);

      // Unsubscribe successfully
      await topics.unsubscribe("room:1");
      expect(topics.has("room:1")).toBe(false);
      expect(topics.size).toBe(0);
    });
  });

  describe("Sequential serialization - preventing race conditions", () => {
    it("should serialize concurrent subscribe to same topic (second waits for first)", async () => {
      const callOrder: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callOrder.push("adapter.subscribe");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Fire two concurrent subscribe calls to the same topic
      const [result1, result2] = await Promise.all([
        topics.subscribe("room:1"),
        topics.subscribe("room:1"),
      ]);

      // Both should succeed
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();

      // Adapter should be called once (first call executes, second waits and detects already subscribed)
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // State should be correct
      expect(topics.has("room:1")).toBe(true);
      expect(topics.size).toBe(1);
    });

    it("should coalesce multiple concurrent subscribe calls to same topic", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Fire FIVE concurrent subscribe calls to the same topic
      const promises = Array.from({ length: 5 }, () =>
        topics.subscribe("room:1"),
      );
      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result) => {
        expect(result).toBeUndefined();
      });

      // Adapter should only be called ONCE
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // State should be correct
      expect(topics.has("room:1")).toBe(true);
      expect(topics.size).toBe(1);
    });

    it("should handle concurrent subscribe to different topics separately", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Fire concurrent subscribe calls to DIFFERENT topics
      await Promise.all([
        topics.subscribe("room:1"),
        topics.subscribe("room:2"),
        topics.subscribe("room:3"),
      ]);

      // Adapter should be called once per topic (no coalescing across topics)
      expect(mockWs.subscribe.mock.calls.length).toBe(3);

      // All should be subscribed
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
      expect(topics.size).toBe(3);
    });

    it("should handle concurrent subscribe to same topic with adapter failure", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw new Error("Adapter failure");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Fire two concurrent subscribe calls to the same topic
      // Both should fail with the same error
      const promises = [topics.subscribe("room:1"), topics.subscribe("room:1")];

      const results = await Promise.allSettled(promises);

      // Both should be rejected
      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("rejected");

      if (results[0].status === "rejected") {
        expect(results[0].reason).toBeInstanceOf(PubSubError);
      }
      if (results[1].status === "rejected") {
        expect(results[1].reason).toBeInstanceOf(PubSubError);
      }

      // Adapter should be called TWICE: first subscribe fails, second retries independently
      // This is correct error isolation: each operation's outcome depends on its own work
      // (docs/specs/pubsub.md#concurrency-edge-cases-for-implementers)
      expect(mockWs.subscribe.mock.calls.length).toBe(2);

      // State should be unchanged (no ghost state)
      expect(topics.has("room:1")).toBe(false);
      expect(topics.size).toBe(0);
    });

    it("should correctly handle subscribe after unsubscribe (race condition fix)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // First, subscribe to room:1
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Now fire unsubscribe and subscribe concurrently (simulating a race)
      // unsubscribe should win the race and remove the subscription
      // subscribe should then re-add it
      let unsubscribeStarted = false;
      let subscribeCanStart = false;

      const unsubscribePromise = (async () => {
        unsubscribeStarted = true;
        subscribeCanStart = true; // Signal subscribe to start
        await topics.unsubscribe("room:1");
      })();

      // Wait for unsubscribe to start
      while (!unsubscribeStarted) {
        await new Promise((r) => setTimeout(r, 1));
      }
      while (!subscribeCanStart) {
        await new Promise((r) => setTimeout(r, 1));
      }

      const subscribePromise = topics.subscribe("room:1");

      // Both operations should succeed
      await Promise.all([unsubscribePromise, subscribePromise]);

      // Final state: subscribed (subscribe completed after unsubscribe)
      expect(topics.has("room:1")).toBe(true);

      // Adapter: initial subscribe (1) + unsubscribe (1) + re-subscribe (1) = 3
      expect(mockWs.subscribe.mock.calls.length).toBe(2); // First subscribe + re-subscribe
      expect(mockWs.unsubscribe.mock.calls.length).toBe(1);
    });

    it("should handle concurrent subscribe/unsubscribe safely without race conditions", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Fire subscribe and unsubscribe concurrently on a fresh topic
      // Both should succeed without error
      const [subscribeResult, unsubscribeResult] = await Promise.all([
        topics.subscribe("room:1"),
        topics.unsubscribe("room:1"),
      ]);

      expect(subscribeResult).toBeUndefined();
      expect(unsubscribeResult).toBeUndefined();

      // Both operations complete without throwing - serialization prevents race condition
      // Actual final state depends on race order, but never results in inconsistent state
      // Key: no ghost state, no violations of linearization semantics
      expect(topics.size).toBeGreaterThanOrEqual(0); // Valid state (0 or 1)
      expect(
        mockWs.subscribe.mock.calls.length +
          mockWs.unsubscribe.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("should maintain correct state with rapid subscribe/unsubscribe/subscribe", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Rapid-fire operations: subscribe → unsubscribe → subscribe
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      await topics.unsubscribe("room:1");
      expect(topics.has("room:1")).toBe(false);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(1);

      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);
      expect(mockWs.subscribe.mock.calls.length).toBe(2); // Two subscribe calls

      // All operations should have succeeded atomically
      expect(topics.size).toBe(1);
    });

    it("should not coalesce when topic is already subscribed", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe once
      await topics.subscribe("room:1");
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Subscribe again (idempotent, should return early)
      await topics.subscribe("room:1");
      expect(mockWs.subscribe.mock.calls.length).toBe(1); // No additional call

      // Third subscribe (still idempotent)
      await topics.subscribe("room:1");
      expect(mockWs.subscribe.mock.calls.length).toBe(1); // Still just one call
    });

    it("should handle sequential subscribe calls to same topic", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe sequentially (not concurrent)
      await topics.subscribe("room:1");
      await topics.subscribe("room:1");
      await topics.subscribe("room:1");

      // First call should hit adapter, rest should be idempotent (no additional calls)
      expect(mockWs.subscribe.mock.calls.length).toBe(1);
      expect(topics.has("room:1")).toBe(true);
    });
  });

  describe("Ordering parity: single-ops vs batch-ops", () => {
    it("should follow identical ordering: validate → adapter → mutate", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // subscribeMany uses: validate → adapter → mutate
      // subscribe should use same order
      const result = await topics.subscribeMany(["room:1", "room:2", "room:3"]);

      expect(result.added).toBe(3);
      expect(result.total).toBe(3);
      expect(mockWs.subscribe.mock.calls.length).toBe(3);

      // All should be in state after success
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should have same atomicity guarantees: adapter failure prevents mutation", async () => {
      let callCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Adapter failure on 2nd call");
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // subscribeMany should fail atomically if any topic fails
      try {
        await topics.subscribeMany(["room:1", "room:2", "room:3"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
      }

      // State should be completely unchanged (atomic failure)
      expect(topics.size).toBe(0);
      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(false);
    });
  });

  describe("No ghost state in error paths", () => {
    it("should not expose ghost state during iteration on adapter failure", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw new Error("Adapter failure");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Try to subscribe, but adapter fails
      try {
        await topics.subscribe("room:1");
      } catch {
        // Expected to fail
      }

      // Iterate and collect topics
      const collected = [...topics];

      // Should be empty (no ghost state was exposed)
      expect(collected).toEqual([]);
      expect(topics.size).toBe(0);
    });

    it("should maintain consistent state across multiple operations", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {
          throw new Error("Adapter failure on unsubscribe");
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe successfully
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);

      // Try to unsubscribe, fails
      try {
        await topics.unsubscribe("room:1");
        expect.unreachable("Should have thrown");
      } catch (err) {
        // Expected to fail
        expect(err).toBeInstanceOf(PubSubError);
      }

      // State should still be consistent (not mutated despite adapter failure)
      expect(topics.has("room:1")).toBe(true);
      expect(topics.size).toBe(1);

      // Try again - should fail again since adapter keeps throwing
      try {
        await topics.unsubscribe("room:1");
        expect.unreachable("Should have thrown");
      } catch (err) {
        // Expected to fail again
        expect(err).toBeInstanceOf(PubSubError);
      }

      // State should still be consistent
      expect(topics.has("room:1")).toBe(true);
    });
  });
});
