// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { PubSubError } from "../../src/core/error.js";
import { createTopics } from "../../src/core/topics.js";

describe("OptimisticTopics - Error Recovery & Rollback", () => {
  describe("Error isolation - rejection handling", () => {
    it("should allow unsubscribe after failed subscribe (soft no-op semantics)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw new Error("Adapter failure");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Subscribe fails with adapter error
      try {
        await topics.subscribe("room:1");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
      }

      // Unsubscribe should return void without throwing (soft no-op)
      // even though the prior operation failed
      const result = await topics.unsubscribe("room:1");
      expect(result).toBeUndefined();

      // Adapter should only be called for subscribe (not unsubscribe, soft no-op)
      expect(mockWs.subscribe.mock.calls.length).toBe(1);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });

    it("should allow retry after failed subscribe (independent error semantics)", async () => {
      let callCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error("Adapter failure on first try");
          }
          // Succeed on second call
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // First subscribe fails
      try {
        await topics.subscribe("room:1");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }
      expect(topics.has("room:1")).toBe(false);

      // Second subscribe should retry and succeed (not inherit first's failure)
      await topics.subscribe("room:1");
      expect(topics.has("room:1")).toBe(true);

      // Adapter should be called twice (first failed, second succeeded)
      expect(mockWs.subscribe.mock.calls.length).toBe(2);
    });

    it("should decouple subscribe and unsubscribe error semantics in concurrent calls", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          throw new Error("Adapter failure");
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Fire subscribe and unsubscribe concurrently
      // subscribe fails, unsubscribe returns void (soft no-op because not subscribed)
      const promises = [
        topics.subscribe("room:1"),
        topics.unsubscribe("room:1"),
      ];
      const results = await Promise.allSettled(promises);

      // subscribe rejects, unsubscribe succeeds (soft no-op - not subscribed)
      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("fulfilled");

      // unsubscribe should NOT be called (soft no-op for non-subscribed topic)
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });
  });

  describe("Batch atomicity - subscribeMany rollback", () => {
    it("should rollback all subscriptions on second topic failure", async () => {
      let subscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          subscribeCount++;
          if (subscribeCount === 2) {
            throw new Error("Adapter failure on second topic");
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Try to subscribe to 3 topics, second fails
      let errorThrown = false;
      try {
        await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      } catch (err) {
        errorThrown = true;
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }
      expect(errorThrown).toBe(true);

      // Local state should be completely unchanged (atomic failure)
      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.size).toBe(0);

      // Adapter: called for room:1 (success), room:2 (fail), then rollback unsubscribe for room:1
      expect(mockWs.subscribe.mock.calls.length).toBe(2); // room:1, room:2
      expect(mockWs.unsubscribe.mock.calls.length).toBe(1); // rollback room:1
    });

    it("should maintain consistency when rollback partially fails", async () => {
      let rollbackCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          // room:1 succeeds, room:2 fails
          if (mockWs.subscribe.mock.calls.length === 2) {
            throw new Error("Adapter failure on second topic");
          }
        }),
        unsubscribe: mock(() => {
          rollbackCount++;
          // Rollback also fails (simulating adapter in inconsistent state)
          if (rollbackCount === 1) {
            throw new Error("Rollback failure");
          }
        }),
      };

      const topics = createTopics(mockWs);

      // Try to subscribe to multiple topics
      let errorThrown = false;
      try {
        await topics.subscribeMany(["room:1", "room:2"]);
      } catch (err) {
        errorThrown = true;
        expect(err).toBeInstanceOf(PubSubError);
        // Should be the original error, not the rollback error
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }
      expect(errorThrown).toBe(true);

      // Local state unchanged (no ghost state)
      expect(topics.size).toBe(0);
    });

    it("should succeed when all topics in subscribeMany succeed", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      const result = await topics.subscribeMany(["room:1", "room:2", "room:3"]);

      expect(result.added).toBe(3);
      expect(result.total).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);

      // No unsubscribe calls (no rollback needed)
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });
  });

  describe("Batch atomicity - unsubscribeMany rollback", () => {
    it("should rollback unsubscribes on second topic failure", async () => {
      let unsubscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {
          unsubscribeCount++;
          if (unsubscribeCount === 2) {
            throw new Error("Adapter failure on second unsubscribe");
          }
        }),
      };

      const topics = createTopics(mockWs);

      // First subscribe to 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Try to unsubscribe from all 3, second fails
      try {
        await topics.unsubscribeMany(["room:1", "room:2", "room:3"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // Local state should be unchanged (atomic failure)
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
      expect(topics.size).toBe(3);

      // Adapter: unsubscribe room:1 (ok), room:2 (fail), then rollback room:1
      expect(mockWs.unsubscribe.mock.calls.length).toBe(2); // room:1, room:2
      expect(mockWs.subscribe.mock.calls.length).toBe(4); // initial 3 + 1 rollback
    });
  });

  describe("Batch atomicity - clear() rollback", () => {
    it("should rollback clears on adapter failure", async () => {
      let unsubscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {
          unsubscribeCount++;
          if (unsubscribeCount === 2) {
            throw new Error("Adapter failure on second unsubscribe");
          }
        }),
      };

      const topics = createTopics(mockWs);

      // Subscribe to 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Try to clear, fails on second unsubscribe
      try {
        await topics.clear();
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // Local state should be unchanged
      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);

      // Adapter: unsubscribe 1 (ok), 2 (fail), then rollback 1
      expect(mockWs.unsubscribe.mock.calls.length).toBe(2);
      expect(mockWs.subscribe.mock.calls.length).toBe(4); // initial 3 + 1 rollback
    });
  });

  describe("Batch atomicity - set() rollback", () => {
    it("should rollback replace on subscribe failure", async () => {
      let callCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callCount++;
          // Fail on first subscribe in replace (after initial 3)
          if (callCount === 4) {
            throw new Error("Adapter failure on new topic");
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Start with 3 topics (calls 1, 2, 3)
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Replace with ["room:2", "room:4", "room:5"]
      // Unsubscribe room:1, room:3 (ok), subscribe room:4 (call 4, fails)
      // Should rollback: re-subscribe rooms unsubscribed, then throw
      let errorThrown = false;
      try {
        await topics.set(["room:2", "room:4", "room:5"]);
      } catch (err) {
        errorThrown = true;
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }
      expect(errorThrown).toBe(true);

      // Local state should be unchanged
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
      expect(topics.size).toBe(3);
    });

    it("should rollback replace on unsubscribe failure", async () => {
      let unsubscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {
          unsubscribeCount++;
          if (unsubscribeCount === 1) {
            throw new Error("Adapter failure on unsubscribe");
          }
        }),
      };

      const topics = createTopics(mockWs);

      // Start with 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Replace with ["room:2", "room:4", "room:5"]
      // room:1 to unsubscribe, room:4 and room:5 to subscribe
      // Unsubscribe room:1 (fails), should rollback room:4 and room:5
      try {
        await topics.set(["room:2", "room:4", "room:5"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // Local state should be unchanged
      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should succeed when replace completes fully", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Start with 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);

      // Replace with ["room:2", "room:4", "room:5"]
      const result = await topics.set(["room:2", "room:4", "room:5"]);

      expect(result.added).toBe(2); // room:4, room:5
      expect(result.removed).toBe(2); // room:1, room:3
      expect(result.total).toBe(3); // room:2, room:4, room:5

      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.has("room:4")).toBe(true);
      expect(topics.has("room:5")).toBe(true);
    });
  });

  describe("Rollback failure telemetry", () => {
    it("should surface rollback failures in error details for subscribeMany", async () => {
      let subscribeCount = 0;
      let unsubscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          subscribeCount++;
          if (subscribeCount === 2) {
            throw new Error("Adapter failure on second subscribe");
          }
        }),
        unsubscribe: mock(() => {
          unsubscribeCount++;
          // Rollback also fails
          throw new Error("Adapter failure on rollback unsubscribe");
        }),
      };

      const topics = createTopics(mockWs);

      try {
        await topics.subscribeMany(["room:1", "room:2"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        const details = (err as any).details;

        // Check telemetry
        expect(details.rollbackFailed).toBe(true);
        expect(details.failedRollbackTopics).toContain("room:1");
        expect(details.cause).toBeDefined();
      }
    });

    it("should surface rollback failures in error details for unsubscribeMany", async () => {
      let subscribeCount = 0;
      let unsubscribeCount = 0;
      let resubscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          subscribeCount++;
          // Initial subscribes succeed, but rollback resubscribe fails
          if (subscribeCount >= 3) {
            resubscribeCount++;
            throw new Error("Adapter rollback resubscribe failed");
          }
        }),
        unsubscribe: mock(() => {
          unsubscribeCount++;
          // First unsubscribe succeeds (room:1)
          // Second unsubscribe fails (room:2), triggering rollback
          if (unsubscribeCount === 2) {
            throw new Error("Adapter unsubscribe failure on second topic");
          }
        }),
      };

      const topics = createTopics(mockWs);

      // First subscribe to topics (subscribeCount: 2)
      await topics.subscribeMany(["room:1", "room:2"]);

      try {
        // Unsubscribe: first succeeds (room:1), second fails (room:2)
        // Rollback tries to resubscribe room:1, which fails
        await topics.unsubscribeMany(["room:1", "room:2"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        const details = (err as any).details;

        // Check telemetry - rollback failed
        expect(details.rollbackFailed).toBe(true);
        expect(details.failedRollbackTopics).toBeDefined();
        expect(Array.isArray(details.failedRollbackTopics)).toBe(true);
        expect(details.failedRollbackTopics.length).toBeGreaterThan(0);
      }
    });

    it("should mark rollbackFailed as false when rollback succeeds", async () => {
      let subscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          subscribeCount++;
          if (subscribeCount === 2) {
            throw new Error("Adapter failure");
          }
        }),
        unsubscribe: mock(() => {
          // Rollback succeeds
        }),
      };

      const topics = createTopics(mockWs);

      try {
        await topics.subscribeMany(["room:1", "room:2"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        const details = (err as any).details;

        // Rollback succeeded, so flag should be false
        expect(details.rollbackFailed).toBe(false);
        expect(details.failedRollbackTopics).toEqual([]);
      }
    });
  });

  describe("set() operation ordering - at limit", () => {
    it("should allow replace when swapping topics at maxTopicsPerConnection", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs, { maxTopicsPerConnection: 3 }); // Limit is 3

      // Subscribe to 3 topics (at limit)
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Replace one topic with another while at limit
      // Desired: ["room:1", "room:2", "room:4"] (swap room:3 for room:4)
      const result = await topics.set(["room:1", "room:2", "room:4"]);

      expect(result.added).toBe(1); // room:4
      expect(result.removed).toBe(1); // room:3
      expect(result.total).toBe(3);

      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.has("room:4")).toBe(true);
    });

    it("should maintain correct adapter call order - unsubscribe before subscribe", async () => {
      const callOrder: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callOrder.push("subscribe");
        }),
        unsubscribe: mock(() => {
          callOrder.push("unsubscribe");
        }),
      };

      const topics = createTopics(mockWs);

      // Subscribe to initial topics
      await topics.subscribeMany(["room:1", "room:2"]);
      callOrder.length = 0; // Reset

      // Replace: should unsubscribe room:1, then subscribe room:3
      await topics.set(["room:2", "room:3"]);

      // Verify order: unsubscribe first, then subscribe
      expect(callOrder).toEqual(["unsubscribe", "subscribe"]);
    });

    it("should rollback correctly when unsubscribe fails in replace", async () => {
      let unsubscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {
          unsubscribeCount++;
          if (unsubscribeCount === 1) {
            // First unsubscribe (removing room:1) fails
            throw new Error("Adapter unsubscribe failed");
          }
        }),
      };

      const topics = createTopics(mockWs);

      // Start with 2 topics
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Replace with room:3, fails when unsubscribing room:1
      try {
        await topics.set(["room:2", "room:3"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
      }

      // Local state should be unchanged
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.size).toBe(2);
    });

    it("should rollback correctly when subscribe fails in replace", async () => {
      let subscribeCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          subscribeCount++;
          // Initial subscribeMany calls (2), then replace unsubscribe, then replace subscribe (which fails)
          if (subscribeCount === 3) {
            throw new Error("Adapter subscribe failed");
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Start with 2 topics
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Replace with room:3, fails when subscribing to room:3
      try {
        await topics.set(["room:2", "room:3"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
      }

      // Local state should be unchanged (room:1 should be re-subscribed during rollback)
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(false);
      expect(topics.size).toBe(2);
    });
  });

  describe("Validation and authorization before adapter calls", () => {
    it("should validate all topics before any adapter calls in batch", async () => {
      let subscribeWasCalled = false;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          subscribeWasCalled = true;
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs, { maxTopicsPerConnection: 5 }); // limit to 5 topics
      const validator = () => {
        throw new PubSubError("INVALID_TOPIC", "Invalid");
      };
      const topicsWithValidator = createTopics(mockWs, {
        maxTopicsPerConnection: 5,
        validator: validator,
      });

      // Try to subscribe with invalid topic
      try {
        await topicsWithValidator.subscribeMany(["invalid:topic"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
      }

      // Adapter should not have been called (validation failed first)
      expect(mockWs.subscribe.mock.calls.length).toBe(0);
    });

    it("should check limits before any adapter calls", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs, { maxTopicsPerConnection: 2 }); // limit to 2 topics

      // Subscribe to 2 topics (should succeed)
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Try to add more when at limit
      try {
        await topics.subscribeMany(["room:3"]);
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("TOPIC_LIMIT_EXCEEDED");
      }

      // State unchanged (no adapter calls)
      expect(topics.size).toBe(2);
      expect(topics.has("room:3")).toBe(false);
    });
  });
});
