// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { PubSubError } from "../../src/core/error.js";
import { createTopics } from "../../src/core/topics.js";

describe("OptimisticTopics - Atomic Batch Operations", () => {
  describe("subscribeMany - atomicity", () => {
    it("should maintain atomicity when adapter fails mid-batch", async () => {
      // Mock WebSocket that fails on 3rd subscribe call
      let callCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          callCount++;
          if (callCount === 3) {
            throw new Error("Adapter failure");
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Try to subscribe to 3 topics; adapter will fail on the 3rd
      try {
        await topics.subscribeMany(["room:1", "room:2", "room:3"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // ATOMIC guarantee: NO topics should be subscribed (all-or-nothing)
      expect(topics.size).toBe(0);
      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(false);
    });

    it("should mutate state only after all adapter calls succeed", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          // All adapter calls succeed
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      const result = await topics.subscribeMany(["room:1", "room:2", "room:3"]);

      // All topics should be subscribed
      expect(topics.size).toBe(3);
      expect(result.added).toBe(3);
      expect(result.total).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should handle idempotency correctly within batch", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // First batch
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Second batch with duplicates and already-subscribed topics
      const result = await topics.subscribeMany([
        "room:1",
        "room:1",
        "room:2",
        "room:3",
      ]);

      // Only room:3 is new
      expect(result.added).toBe(1);
      expect(result.total).toBe(3);
      expect(topics.size).toBe(3);
    });
  });

  describe("unsubscribeMany - atomicity", () => {
    it("should maintain atomicity when adapter fails mid-batch", async () => {
      let callCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {}),
        unsubscribe: mock((topic: string) => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Adapter failure");
          }
        }),
      };

      const topics = createTopics(mockWs);

      // First, subscribe to 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Now try to unsubscribe; adapter will fail on the 2nd call
      callCount = 0;
      try {
        await topics.unsubscribeMany(["room:1", "room:2", "room:3"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // ATOMIC guarantee: ALL topics should still be subscribed (all-or-nothing)
      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should mutate state only after all adapter calls succeed", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {}),
        unsubscribe: mock((topic: string) => {}),
      };

      const topics = createTopics(mockWs);

      // Subscribe first
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Unsubscribe
      const result = await topics.unsubscribeMany([
        "room:1",
        "room:2",
        "room:3",
      ]);

      // All should be unsubscribed
      expect(topics.size).toBe(0);
      expect(result.removed).toBe(3);
      expect(result.total).toBe(0);
      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(false);
    });

    it("should skip non-subscribed topics (soft no-op semantics)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {}),
        unsubscribe: mock((topic: string) => {}),
      };

      const topics = createTopics(mockWs);

      // Subscribe to room:1 and room:2 only
      await topics.subscribeMany(["room:1", "room:2"]);
      expect(topics.size).toBe(2);

      // Try to unsubscribe from room:1, room:2, and room:3 (not subscribed)
      const result = await topics.unsubscribeMany([
        "room:1",
        "room:2",
        "room:3",
      ]);

      // Only room:1 and room:2 are removed
      expect(result.removed).toBe(2);
      expect(result.total).toBe(0);
      expect(topics.has("room:1")).toBe(false);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(false);
    });
  });

  describe("clear - atomicity", () => {
    it("should maintain atomicity when adapter fails", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {}),
        unsubscribe: mock((topic: string) => {
          throw new Error("Adapter failure");
        }),
      };

      const topics = createTopics(mockWs);

      // Subscribe to 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Try to clear; adapter will fail
      try {
        await topics.clear();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // ATOMIC guarantee: ALL topics should still be subscribed (no partial clear)
      expect(topics.size).toBe(3);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);
      expect(topics.has("room:3")).toBe(true);
    });

    it("should clear all subscriptions on success", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {}),
        unsubscribe: mock((topic: string) => {}),
      };

      const topics = createTopics(mockWs);

      // Subscribe to 3 topics
      await topics.subscribeMany(["room:1", "room:2", "room:3"]);
      expect(topics.size).toBe(3);

      // Clear
      const result = await topics.clear();

      expect(result.removed).toBe(3);
      expect(topics.size).toBe(0);
      expect([...topics]).toEqual([]);
    });
  });

  describe("Validation happens before adapter calls", () => {
    it("subscribeMany should validate all topics before any adapter calls", async () => {
      const adapterCalls: string[] = [];
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock((topic: string) => {
          adapterCalls.push(topic);
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Try to subscribe with invalid topic in the middle
      try {
        await topics.subscribeMany([
          "room:1",
          "room:2",
          "invalid topic with spaces", // Invalid
          "room:3",
        ]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("INVALID_TOPIC");
      }

      // NO adapter calls should have been made (validation happened first)
      expect(adapterCalls).toHaveLength(0);
      expect(topics.size).toBe(0);
    });
  });
});
