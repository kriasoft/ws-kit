// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { PubSubError } from "../../src/core/error.js";
import { createTopics, createTopicValidator } from "../../src/core/topics.js";

describe("OptimisticTopics - Validation Reason Field", () => {
  describe("Default validation - reason field", () => {
    it("should include reason: pattern for empty topic", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      try {
        await topics.subscribe("");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect(error.details).toBeDefined();
        expect((error.details as any).reason).toBe("pattern");
      }
    });

    it("should include reason: length for topics exceeding 128 chars", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      const longTopic = "a".repeat(129);

      try {
        await topics.subscribe(longTopic);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect(error.details).toBeDefined();
        const details = error.details as any;
        expect(details.reason).toBe("length");
        expect(details.length).toBe(129);
        expect(details.max).toBe(128);
      }
    });

    it("should include reason: pattern for invalid characters", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      try {
        await topics.subscribe("room@invalid!topic");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect(error.details).toBeDefined();
        const details = error.details as any;
        expect(details.reason).toBe("pattern");
        expect(details.topic).toBe("room@invalid!topic");
      }
    });

    it("should report length error even if pattern would also fail", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Topic that is both too long AND has invalid characters
      const badTopic = "!".repeat(200);

      try {
        await topics.subscribe(badTopic);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PubSubError);
        const error = err as PubSubError;
        // Should report length first (checked first in validation order)
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("length");
      }
    });
  });

  describe("Custom validator via createTopicValidator", () => {
    it("should use custom pattern when provided", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const customPattern = /^[A-Z0-9]+$/; // Only uppercase and digits
      const validator = createTopicValidator(customPattern, 128);
      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: Infinity,
        validator: validator,
      });

      // Valid according to custom pattern
      await expect(topics.subscribe("ROOM123")).resolves.toBeUndefined();
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Invalid: contains lowercase
      try {
        await topics.subscribe("room123");
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("pattern");
      }
    });

    it("should use custom max length when provided", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const customMaxLength = 64;
      const validator = createTopicValidator(
        /^[a-z0-9:_./-]{1,128}$/i,
        customMaxLength,
      );
      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: Infinity,
        validator: validator,
      });

      // Valid: within custom limit
      await expect(topics.subscribe("a".repeat(64))).resolves.toBeUndefined();
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Invalid: exceeds custom limit
      try {
        await topics.subscribe("a".repeat(65));
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        const details = error.details as any;
        expect(details.reason).toBe("length");
        expect(details.length).toBe(65);
        expect(details.max).toBe(64);
      }
    });

    it("should return undefined from createTopicValidator if no options set", () => {
      const validator = createTopicValidator();
      expect(validator).toBeUndefined();
    });
  });

  describe("subscribeMany with reason field", () => {
    it("should propagate reason field in batch validation errors", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      // Try to subscribe to multiple topics, with one invalid due to length
      const longTopic = "a".repeat(129);

      try {
        await topics.subscribeMany(["room:1", longTopic, "room:2"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("length");
      }

      // No topics should be subscribed (atomic failure)
      expect(topics.size).toBe(0);
      expect(mockWs.subscribe.mock.calls.length).toBe(0);
    });

    it("should report pattern reason for invalid format in batch", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      try {
        await topics.subscribeMany(["room:1", "bad@topic!", "room:2"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("pattern");
      }

      expect(topics.size).toBe(0);
    });
  });

  describe("replace with reason field", () => {
    it("should include reason field when replace fails validation", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      const topics = createTopics(mockWs);

      const longTopic = "a".repeat(129);

      try {
        await topics.set(["room:1", longTopic]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        const details = error.details as any;
        expect(details.reason).toBe("length");
        expect(details.max).toBe(128);
      }

      expect(topics.size).toBe(0);
    });
  });

  describe("Custom validator in createTopics factory", () => {
    it("should use custom validator when injected", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      let validatorCallCount = 0;
      const customValidator = (topic: string) => {
        validatorCallCount++;
        if (topic === "forbidden") {
          throw new PubSubError("INVALID_TOPIC", "Topic is forbidden", {
            reason: "policy",
          });
        }
      };

      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: Infinity,
        validator: customValidator,
      });

      // Valid topic
      await expect(topics.subscribe("allowed")).resolves.toBeUndefined();
      expect(validatorCallCount).toBe(1);

      // Forbidden topic
      try {
        await topics.subscribe("forbidden");
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("policy");
      }

      expect(validatorCallCount).toBe(2);
    });

    it("should skip validation on unsubscribe when topic not subscribed", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      let validatorCallCount = 0;
      const customValidator = (topic: string) => {
        validatorCallCount++;
        if (topic.includes("bad")) {
          throw new PubSubError("INVALID_TOPIC", "Bad topic", {
            reason: "pattern",
          });
        }
      };

      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: Infinity,
        validator: customValidator,
      });

      // Soft no-op: unsubscribe from non-subscribed topic skips validation
      // (safe to call from error paths with potentially invalid topics)
      await expect(topics.unsubscribe("bad-topic")).resolves.toBeUndefined();
      expect(validatorCallCount).toBe(0); // Validator not called
    });

    it("should validate on unsubscribe when topic is subscribed", async () => {
      const mockWs = {
        data: { clientId: "test-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      let validatorCallCount = 0;
      const customValidator = (topic: string) => {
        validatorCallCount++;
        if (topic.includes("bad")) {
          throw new PubSubError("INVALID_TOPIC", "Bad topic", {
            reason: "pattern",
          });
        }
      };

      const topics = createTopics(mockWs, {
        maxTopicsPerConnection: Infinity,
        validator: customValidator,
      });

      // Subscribe to a good topic
      await expect(topics.subscribe("good-topic")).resolves.toBeUndefined();
      expect(validatorCallCount).toBe(1);

      // Unsubscribe from subscribed topic: validator IS called (mutation requires validation)
      const beforeCount = validatorCallCount;
      await expect(topics.unsubscribe("good-topic")).resolves.toBeUndefined();
      expect(validatorCallCount).toBe(beforeCount + 1); // Validator called on actual removal
    });
  });
});
