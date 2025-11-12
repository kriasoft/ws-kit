// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { TopicsImpl } from "../../src/core/topics.js";
import { PubSubError } from "../../src/core/error.js";

describe("TopicsImpl - status() Method", () => {
  describe("Four-State Semantics", () => {
    it("should return 'absent' for unsubscribed topics", () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      expect(topics.status("room:1")).toBe("absent");
      expect(topics.status("room:2")).toBe("absent");
    });

    it("should return 'settled' after successful subscribe", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe
      await topics.subscribe("room:1");

      // Should be settled (adapter called and completed)
      expect(topics.status("room:1")).toBe("settled");
    });

    it("should return 'pending-subscribe' while subscribe is in-flight", async () => {
      let resolveSubscribe: () => void;
      const subscribePromise = new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await subscribePromise;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start subscribe (will be pending)
      const subPromise = topics.subscribe("room:1");

      // Check status while in-flight
      expect(topics.status("room:1")).toBe("pending-subscribe");
      expect(topics.has("room:1")).toBe(true); // Optimistic

      // Resolve the in-flight operation
      resolveSubscribe!();
      await subPromise;

      // Now should be settled
      expect(topics.status("room:1")).toBe("settled");
    });

    it("should return 'pending-unsubscribe' while unsubscribe is in-flight", async () => {
      let resolveUnsubscribe: () => void;
      const unsubscribePromise = new Promise<void>((resolve) => {
        resolveUnsubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(async () => {
          await unsubscribePromise;
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribe("room:1");
      expect(topics.status("room:1")).toBe("settled");

      // Start unsubscribe (will be pending)
      const unsubPromise = topics.unsubscribe("room:1");

      // Check status while in-flight
      expect(topics.status("room:1")).toBe("pending-unsubscribe");
      expect(topics.has("room:1")).toBe(false); // Optimistic local state changed

      // Resolve the in-flight operation
      resolveUnsubscribe!();
      await unsubPromise;

      // Now should be absent
      expect(topics.status("room:1")).toBe("absent");
    });
  });

  describe("Optimistic vs Confirmed Semantics", () => {
    it("has() shows optimistic state; status() shows precise state", async () => {
      let resolveSubscribe: () => void;
      const subscribePromise = new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await subscribePromise;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start subscribe (pending)
      const subPromise = topics.subscribe("room:1");

      // has() returns optimistic (true), status() shows pending
      expect(topics.has("room:1")).toBe(true);
      expect(topics.status("room:1")).toBe("pending-subscribe");

      // Resolve
      resolveSubscribe!();
      await subPromise;

      // Both now show settled state
      expect(topics.has("room:1")).toBe(true);
      expect(topics.status("room:1")).toBe("settled");
    });

    it("has() returns false during pending-unsubscribe, status() shows pending-unsubscribe", async () => {
      let resolveUnsubscribe: () => void;
      const unsubscribePromise = new Promise<void>((resolve) => {
        resolveUnsubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(async () => {
          await unsubscribePromise;
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribe("room:1");

      // Start unsubscribe (pending)
      const unsubPromise = topics.unsubscribe("room:1");

      // has() shows optimistic (false), status() shows pending
      expect(topics.has("room:1")).toBe(false);
      expect(topics.status("room:1")).toBe("pending-unsubscribe");

      // Resolve
      resolveUnsubscribe!();
      await unsubPromise;

      // Both now show absent
      expect(topics.has("room:1")).toBe(false);
      expect(topics.status("room:1")).toBe("absent");
    });
  });

  describe("Status Transitions", () => {
    it("should transition: absent → pending-subscribe → settled", async () => {
      let resolveSubscribe: () => void;
      const subscribePromise = new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await subscribePromise;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Initial: absent
      expect(topics.status("room:1")).toBe("absent");

      // Start subscribe
      const subPromise = topics.subscribe("room:1");

      // In-flight: pending-subscribe
      expect(topics.status("room:1")).toBe("pending-subscribe");

      // Resolve
      resolveSubscribe!();
      await subPromise;

      // Settled: settled
      expect(topics.status("room:1")).toBe("settled");
    });

    it("should transition: settled → pending-unsubscribe → absent", async () => {
      let resolveUnsubscribe: () => void;
      const unsubscribePromise = new Promise<void>((resolve) => {
        resolveUnsubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(async () => {
          await unsubscribePromise;
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribe("room:1");
      expect(topics.status("room:1")).toBe("settled");

      // Start unsubscribe
      const unsubPromise = topics.unsubscribe("room:1");

      // In-flight: pending-unsubscribe
      expect(topics.status("room:1")).toBe("pending-unsubscribe");

      // Resolve
      resolveUnsubscribe!();
      await unsubPromise;

      // Settled: absent
      expect(topics.status("room:1")).toBe("absent");
    });
  });

  describe("Concurrent Operations and Serialization", () => {
    it("should show pending-subscribe for concurrent subscribes to same topic", async () => {
      let resolveSubscribe: () => void;
      const subscribePromise = new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await subscribePromise;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start first subscribe
      const sub1 = topics.subscribe("room:1");

      expect(topics.status("room:1")).toBe("pending-subscribe");

      // Second subscribe to same topic (idempotent, waits for first)
      const sub2 = topics.subscribe("room:1");

      expect(topics.status("room:1")).toBe("pending-subscribe");

      // Resolve
      resolveSubscribe!();
      await Promise.all([sub1, sub2]);

      expect(topics.status("room:1")).toBe("settled");
    });

    it("should show correct status when subscribe and unsubscribe interleave", async () => {
      let resolveSubscribe: () => void;
      let resolveUnsubscribe: () => void;
      const subscribePromise = new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      });
      const unsubscribePromise = new Promise<void>((resolve) => {
        resolveUnsubscribe = resolve;
      });

      const callOrder: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          callOrder.push("subscribe-start");
          await subscribePromise;
          callOrder.push("subscribe-end");
        }),
        unsubscribe: mock(async () => {
          callOrder.push("unsubscribe-start");
          await unsubscribePromise;
          callOrder.push("unsubscribe-end");
        }),
      };

      const topics = new TopicsImpl(mockWs);

      // Start subscribe
      const subPromise = topics.subscribe("room:1");
      expect(topics.status("room:1")).toBe("pending-subscribe");

      // Try to unsubscribe while subscribe is in-flight
      // (subscribe is serialized first, so unsubscribe waits)
      const unsubPromise = topics.unsubscribe("room:1");

      // While subscribe is in-flight, status shows pending-subscribe
      expect(topics.status("room:1")).toBe("pending-subscribe");

      // Resolve subscribe
      resolveSubscribe!();
      await subPromise;

      // Now subscribe is settled; unsubscribe may still be in progress
      // The status depends on timing: if unsubscribe hasn't started yet, confirmed; if started, pending-remove
      const statusAfterSub = topics.status("room:1");
      expect(["settled", "pending-unsubscribe"]).toContain(statusAfterSub);

      // Resolve unsubscribe
      resolveUnsubscribe!();
      await unsubPromise;

      // Now should be absent
      expect(topics.status("room:1")).toBe("absent");

      // Verify operations completed
      expect(callOrder).toContain("subscribe-start");
      expect(callOrder).toContain("subscribe-end");
      expect(callOrder).toContain("unsubscribe-start");
      expect(callOrder).toContain("unsubscribe-end");
    });

    it("should show correct status for concurrent different topics", async () => {
      let resolveRoom1: () => void;
      let resolveRoom2: () => void;
      const room1Promise = new Promise<void>((resolve) => {
        resolveRoom1 = resolve;
      });
      const room2Promise = new Promise<void>((resolve) => {
        resolveRoom2 = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async (topic: string) => {
          if (topic === "room:1") await room1Promise;
          else if (topic === "room:2") await room2Promise;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start subscribes to different topics (parallel, no serialization between topics)
      const sub1 = topics.subscribe("room:1");
      const sub2 = topics.subscribe("room:2");

      // Both should be pending-subscribe
      expect(topics.status("room:1")).toBe("pending-subscribe");
      expect(topics.status("room:2")).toBe("pending-subscribe");

      // Resolve room:1 first
      resolveRoom1!();
      // Small delay to let room:1 settle
      await new Promise((r) => setTimeout(r, 10));

      // room:1 should be settled; room:2 may still be pending
      expect(topics.status("room:1")).toBe("settled");
      // room:2 status depends on timing
      const room2Status = topics.status("room:2");
      expect(["pending-subscribe", "settled"]).toContain(room2Status);

      // Resolve room:2
      resolveRoom2!();
      await Promise.all([sub1, sub2]);

      // Both settled
      expect(topics.status("room:1")).toBe("settled");
      expect(topics.status("room:2")).toBe("settled");
    });
  });

  describe("Adapter Failures", () => {
    it("should return 'absent' if subscribe fails and no state mutation occurs", async () => {
      const adapterError = new Error("Adapter failed");
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw adapterError;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      try {
        await topics.subscribe("room:1");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
      }

      // State unchanged; status should be absent
      expect(topics.status("room:1")).toBe("absent");
      expect(topics.has("room:1")).toBe(false);
    });
  });

  describe("Batch Operations", () => {
    it("should show settled for all topics in subscribeMany after completion", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // subscribeMany completes (batch operation)
      const result = await topics.subscribeMany(["room:1", "room:2", "room:3"]);

      expect(result.added).toBe(3);

      // All should be settled
      expect(topics.status("room:1")).toBe("settled");
      expect(topics.status("room:2")).toBe("settled");
      expect(topics.status("room:3")).toBe("settled");
    });

    it("should show absent for all topics in unsubscribeMany after completion", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe first
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Unsubscribe all
      const result = await topics.unsubscribeMany([
        "room:1",
        "room:2",
        "room:3",
      ]);
      expect(result.removed).toBe(3);

      // All should be absent
      expect(topics.status("room:1")).toBe("absent");
      expect(topics.status("room:2")).toBe("absent");
      expect(topics.status("room:3")).toBe("absent");
    });

    it("should show final state after set() operation", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Initial subscription
      await topics.subscribe("room:1");
      expect(topics.status("room:1")).toBe("settled");

      // set() that removes room:1 and adds room:2
      const result = await topics.set(["room:2"]);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);

      // Final state
      expect(topics.status("room:1")).toBe("absent");
      expect(topics.status("room:2")).toBe("settled");
    });

    it("should handle update() and show final status", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Initial subscriptions
      await topics.subscribeMany(["room:1", "room:2"]);

      // Update via callback
      const result = await topics.update((draft) => {
        draft.delete("room:1");
        draft.add("room:3");
      });

      expect(result.added).toBe(1);
      expect(result.removed).toBe(1);

      // Final states
      expect(topics.status("room:1")).toBe("absent");
      expect(topics.status("room:2")).toBe("settled");
      expect(topics.status("room:3")).toBe("settled");
    });
  });

  describe("Pairing status() with flush()", () => {
    it("should support deterministic flows: check status, then flush if pending", async () => {
      let resolveSubscribe: () => void;
      const subscribePromise = new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      });

      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(async () => {
          await subscribePromise;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start subscribe
      const subPromise = topics.subscribe("room:1");

      // Check status
      if (topics.status("room:1") === "pending-subscribe") {
        // Wait for settlement
        const flushPromise = topics.flush("room:1", { timeoutMs: 5000 });

        // Resolve subscribe while flush is waiting
        resolveSubscribe!();

        // Both should complete
        await Promise.all([subPromise, flushPromise]);
      }

      // After flush, status is guaranteed settled or error thrown
      expect(topics.status("room:1")).toBe("settled");
    });

    it("should skip flush if already settled", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe (synchronous adapter)
      await topics.subscribe("room:1");

      // Status is settled
      expect(topics.status("room:1")).toBe("settled");

      // Flush should return immediately (no-op)
      const startTime = Date.now();
      await topics.flush("room:1", { timeoutMs: 5000 });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100); // Very fast
    });
  });

  describe("Edge Cases", () => {
    it("should handle status() on already-cleared topics", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe, then clear
      await topics.subscribe("room:1");
      expect(topics.status("room:1")).toBe("settled");

      await topics.clear();
      expect(topics.status("room:1")).toBe("absent");
    });

    it("should handle status() on non-existent topics", () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Multiple calls should always return absent
      expect(topics.status("unknown:1")).toBe("absent");
      expect(topics.status("unknown:2")).toBe("absent");
      expect(topics.status("random:uuid")).toBe("absent");
    });

    it("status() should be consistent with iteration", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to multiple topics
      await topics.subscribe("room:1");
      await topics.subscribe("room:2");
      await topics.subscribe("room:3");

      // All should be settled and in the set
      const topicsInSet = Array.from(topics);
      expect(topicsInSet).toEqual(["room:1", "room:2", "room:3"]);

      for (const topic of topicsInSet) {
        expect(topics.status(topic)).toBe("settled");
      }
    });
  });
});
