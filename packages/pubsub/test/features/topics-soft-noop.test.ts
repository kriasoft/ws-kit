// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { PubSubError } from "../../src/core/error.js";
import { TopicsImpl } from "../../src/core/topics.js";

describe("TopicsImpl - Soft No-Op Semantics (unsubscribe)", () => {
  describe("unsubscribe() - single-op soft no-op", () => {
    it("should not throw when topic is not subscribed (valid format)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Unsubscribe from a topic we never subscribed to (should be soft no-op)
      await expect(topics.unsubscribe("room:123")).resolves.toBeUndefined();
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0); // Adapter never called
    });

    it("should not throw when topic is not subscribed and format is invalid", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Unsubscribe from invalid topic string that we never subscribed to
      // Per docs/specs/pubsub.md#idempotency: soft no-op if not subscribed, even if invalid
      await expect(
        topics.unsubscribe("!invalid@format#"),
      ).resolves.toBeUndefined();
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });

    it("should throw on invalid format only when that exact topic IS subscribed", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // First subscribe to a VALID topic string, then manually mark it as subscribed
      // (We can't actually subscribe to invalid topics due to validation)
      // So test: subscribe to valid, then try with different invalid string
      await topics.subscribe("room:123");
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Unsubscribe from a DIFFERENT invalid topic (not subscribed)
      // Should be soft no-op (no throw) because it's not in our subscriptions
      await expect(
        topics.unsubscribe("room:123@invalid!"),
      ).resolves.toBeUndefined();

      // State should still be unchanged (still subscribed to room:123)
      expect(topics.has("room:123")).toBe(true);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0); // Adapter never called for invalid topic
    });

    it("should allow safe cleanup in finally blocks with any topic string", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Simulate an operation that may or may not have subscribed
      const maybeTopicString = "potentially-invalid!@#"; // Invalid format
      let cleanupCalled = false;
      let errorCaught = false;

      try {
        try {
          // Pretend we tried to do something that failed
          throw new Error("Something went wrong");
        } finally {
          // Safe cleanup: unsubscribe should not throw even with invalid string
          await topics.unsubscribe(maybeTopicString);
          cleanupCalled = true;
        }
      } catch (err) {
        // Catch the original error from the try block
        errorCaught = true;
        expect((err as Error).message).toBe("Something went wrong");
      }

      expect(cleanupCalled).toBe(true);
      expect(errorCaught).toBe(true);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0); // Adapter never called
    });

    it("should be idempotent: calling unsubscribe twice with same topic", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // First unsubscribe call (topic not subscribed, soft no-op)
      await topics.unsubscribe("room:123");
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);

      // Second unsubscribe call (still not subscribed, still soft no-op)
      await topics.unsubscribe("room:123");
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });
  });

  describe("unsubscribeMany() - batch soft no-op consistency", () => {
    it("should skip validation for non-subscribed topics", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Unsubscribe from multiple topics, none of which are subscribed
      // Should not throw even if format is invalid
      const result = await topics.unsubscribeMany([
        "room:1",
        "!invalid@#",
        "room:2",
      ]);

      expect(result.removed).toBe(0);
      expect(result.total).toBe(0);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0); // Adapter never called
    });

    it("should only validate subscribed topics, skip non-subscribed ones", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to one valid topic
      await topics.subscribe("room:1");

      // Try to unsubscribe from multiple topics including invalid ones
      // The invalid topic is not subscribed, so should be skipped
      const result = await topics.unsubscribeMany([
        "room:1", // This one is subscribed, will validate and unsubscribe
        "!invalid@#", // Not subscribed, will be skipped (no validation)
        "room:2", // Not subscribed, will be skipped
      ]);

      // Only room:1 should be removed
      expect(result.removed).toBe(1);
      expect(result.total).toBe(0);
      expect((mockWs.unsubscribe as any).mock.calls.length).toBe(1);
    });
  });

  describe("Consistency: single-op unsubscribe vs batch unsubscribeMany", () => {
    it("should have same behavior for invalid topic when not subscribed", async () => {
      const mockWs1 = {
        data: { clientId: "test-1" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const mockWs2 = {
        data: { clientId: "test-2" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics1 = new TopicsImpl(mockWs1);
      const topics2 = new TopicsImpl(mockWs2);

      const invalidTopic = "!invalid@format#";

      // Single-op: should not throw
      await expect(topics1.unsubscribe(invalidTopic)).resolves.toBeUndefined();

      // Batch: should not throw
      const result = await topics2.unsubscribeMany([invalidTopic]);
      expect(result.removed).toBe(0);

      // Both should have never called adapter
      expect(mockWs1.unsubscribe.mock.calls.length).toBe(0);
      expect(mockWs2.unsubscribe.mock.calls.length).toBe(0);
    });

    it("should both skip hooks for non-subscribed topics", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Unsubscribe from non-existent topic (soft no-op)
      await topics.unsubscribe("room:123");

      // Unsubscribe from non-existent topics in batch (soft no-op)
      await topics.unsubscribeMany(["room:1", "room:2"]);

      // Neither should call the adapter
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });
  });

  describe("set() - soft removal semantics", () => {
    it("should be idempotent: replace with same topics returns early", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start with some subscriptions
      await topics.subscribe("room:1");
      await topics.subscribe("room:2");
      const initialCalls = mockWs.subscribe.mock.calls.length;

      // Replace with the exact same set
      const result = await topics.set(["room:1", "room:2"]);

      // Should be idempotent (no-op)
      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(2);

      // No additional adapter calls should be made for replace operation
      expect(mockWs.subscribe.mock.calls.length).toBe(initialCalls);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });

    it("should validate invalid topics in desired set (fails early)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Try to replace with invalid topic in desired set
      try {
        await topics.set(["room:1", "!invalid@#", "room:2"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("INVALID_TOPIC");
      }

      // State should be unchanged (no adapter calls)
      expect(topics.size).toBe(0);
      expect(mockWs.subscribe.mock.calls.length).toBe(0);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });

    it("should handle mixed adds and removes", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Start with room:1 and room:2 subscribed
      await topics.subscribe("room:1");
      await topics.subscribe("room:2");
      const initialSubscribeCalls = mockWs.subscribe.mock.calls.length;
      const initialUnsubscribeCalls = mockWs.unsubscribe.mock.calls.length;

      // Replace with room:1 and room:3 (adds room:3, removes room:2)
      const result = await topics.set(["room:1", "room:3"]);

      expect(result.added).toBe(1); // room:3
      expect(result.removed).toBe(1); // room:2
      expect(result.total).toBe(2); // room:1, room:3

      // Verify subscriptions
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(true);

      // Adapter should be called once more for add (room:3) and once for remove (room:2)
      expect(mockWs.subscribe.mock.calls.length).toBe(
        initialSubscribeCalls + 1,
      );
      expect(mockWs.unsubscribe.mock.calls.length).toBe(
        initialUnsubscribeCalls + 1,
      );
    });

    it("should replace all with empty set", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to some topics
      await topics.subscribe("room:1");
      await topics.subscribe("room:2");
      const initialUnsubscribeCalls = mockWs.unsubscribe.mock.calls.length;

      // Replace with empty set (removes all)
      const result = await topics.set([]);

      expect(result.added).toBe(0);
      expect(result.removed).toBe(2);
      expect(result.total).toBe(0);

      // All should be unsubscribed
      expect(topics.size).toBe(0);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(
        initialUnsubscribeCalls + 2,
      );
    });

    it("should be atomic: if adapter fails, state unchanged", async () => {
      let callCount = 0;
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Adapter failure");
          }
        }),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe to room:1 first
      await topics.subscribe("room:1");

      // Try to replace with room:1, room:2, room:3 (will fail on room:3)
      try {
        await topics.set(["room:1", "room:2", "room:3"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        expect((err as PubSubError).code).toBe("ADAPTER_ERROR");
      }

      // State should be unchanged (still only room:1)
      expect(topics.size).toBe(1);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(false);
      expect(topics.has("room:3")).toBe(false);
    });

    it("should handle deduplication in desired set", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Replace with duplicates in desired set
      const result = await topics.set([
        "room:1",
        "room:1", // Duplicate
        "room:2",
        "room:2", // Duplicate
      ]);

      // Should deduplicate and count unique topics
      expect(result.added).toBe(2);
      expect(result.total).toBe(2);
      expect(topics.size).toBe(2);
      expect(topics.has("room:1")).toBe(true);
      expect(topics.has("room:2")).toBe(true);

      // Adapter should only be called once per unique topic
      expect(mockWs.subscribe.mock.calls.length).toBe(2);
    });

    it("should handle edge case: replace with same topics but different order", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Subscribe in order: room:1, room:2, room:3
      await topics.subscribe("room:1");
      await topics.subscribe("room:2");
      await topics.subscribe("room:3");
      const initialSubscribeCalls = mockWs.subscribe.mock.calls.length;
      const initialUnsubscribeCalls = mockWs.unsubscribe.mock.calls.length;

      // Replace with same topics but different order
      const result = await topics.set(["room:3", "room:1", "room:2"]);

      // Should be idempotent (no change)
      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.total).toBe(3);

      // No additional adapter calls
      expect(mockWs.subscribe.mock.calls.length).toBe(initialSubscribeCalls);
      expect(mockWs.unsubscribe.mock.calls.length).toBe(
        initialUnsubscribeCalls,
      );
    });
  });

  describe("Empty and edge cases", () => {
    it("should handle empty string topic (invalid, not subscribed)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Empty string is invalid format, but since not subscribed, soft no-op
      await expect(topics.unsubscribe("")).resolves.toBeUndefined();
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });

    it("should handle very long invalid topic string (not subscribed)", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Very long string (exceeds 128 char limit), invalid, not subscribed
      const longInvalid = "x".repeat(200);
      await expect(topics.unsubscribe(longInvalid)).resolves.toBeUndefined();
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });

    it("should handle special characters in unvalidated topics", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = new TopicsImpl(mockWs);

      // Unicode, emoji, nulls - all invalid but not subscribed, so soft no-op
      await expect(
        topics.unsubscribeMany([
          "room\x00123", // Null byte
          "room:💀", // Emoji
          "room:\u0000test", // Another null
        ]),
      ).resolves.toBeDefined();
      expect(mockWs.unsubscribe.mock.calls.length).toBe(0);
    });
  });
});
