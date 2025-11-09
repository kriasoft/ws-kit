// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, expect, it, mock } from "bun:test";
import { PubSubError } from "../../src/index.js";
import { WebSocketRouter } from "../../src/router.js";

describe("TopicsImpl - Router Integration (Topic Policy)", () => {
  describe("Custom topic pattern via router limits", () => {
    it("should inject custom pattern validator into TopicsImpl via router", async () => {
      const customPattern = /^[A-Z0-9:]+$/; // Only uppercase, digits, colons
      const router = new WebSocketRouter({
        limits: {
          topicPattern: customPattern,
          maxTopicLength: 128,
        },
      });

      // Create a mock WebSocket with a clientId
      const mockWs = {
        data: { clientId: "test-client-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      // Call handleOpen to initialize Topics instance with injected validator
      await router.handleOpen(mockWs as any);

      // Access the Topics instance created by the router
      const topics = (router as any).topicsInstances.get("test-client-123");
      expect(topics).toBeDefined();

      // Verify the injected validator enforces the custom pattern
      // Valid topic: uppercase and digits
      await expect(topics.subscribe("SYSTEM:ALERTS")).resolves.toBeUndefined();
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Invalid topic: contains lowercase (should fail with custom pattern)
      try {
        await topics.subscribe("system:alerts");
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("pattern");
      }
    });

    it("should enforce custom max topic length across subscriptions", async () => {
      const customMaxLength = 32;
      const router = new WebSocketRouter({
        limits: {
          topicPattern: /^[a-z0-9:_./-]{1,128}$/i,
          maxTopicLength: customMaxLength,
        },
      });

      const mockWs = {
        data: { clientId: "test-client-456" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      // Call handleOpen to initialize Topics with custom length limit
      await router.handleOpen(mockWs as any);

      const topics = (router as any).topicsInstances.get("test-client-456");

      // Valid: within custom limit
      await expect(topics.subscribe("a".repeat(32))).resolves.toBeUndefined();

      // Invalid: exceeds custom limit
      try {
        await topics.subscribe("a".repeat(33));
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("length");
        expect((error.details as any).max).toBe(customMaxLength);
      }
    });

    it("should enforce custom pattern validation", async () => {
      // Router configured with custom pattern (only uppercase and digits)
      const router = new WebSocketRouter({
        limits: {
          topicPattern: /^[A-Z0-9:]+$/,
          maxTopicLength: 128,
        },
      });

      const mockWs = {
        data: { clientId: "test-client-789" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      // Initialize Topics instance via router
      await router.handleOpen(mockWs as any);

      const topics = (router as any).topicsInstances.get("test-client-789");

      // Valid: matches uppercase pattern
      await expect(topics.subscribe("SYSTEM:ALERTS")).resolves.toBeUndefined();
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Invalid: contains lowercase
      try {
        await topics.subscribe("system:alerts");
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("pattern");
      }
    });
  });

  describe("Default topic validation (no custom options)", () => {
    it("should use default pattern and length when no custom limits provided", async () => {
      // Router with no custom limits uses defaults
      const router = new WebSocketRouter({
        // No limits config, uses defaults
      });

      const mockWs = {
        data: { clientId: "test-default-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      // Initialize Topics instance via router (uses default validator)
      await router.handleOpen(mockWs as any);

      const topics = (router as any).topicsInstances.get("test-default-123");

      // Default pattern: alphanumeric, colons, underscores, hyphens, dots, slashes
      // Max length: 128
      await expect(topics.subscribe("room:123")).resolves.toBeUndefined();
      expect(mockWs.subscribe.mock.calls.length).toBe(1);

      // Exceeds default 128 char limit
      try {
        await topics.subscribe("x".repeat(129));
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("length");
        expect((error.details as any).max).toBe(128);
      }
    });
  });

  describe("Topic validation error contract", () => {
    it("should include machine-readable reason field for all validation errors", async () => {
      const router = new WebSocketRouter({
        limits: {
          topicPattern: /^[a-z:]+$/i,
          maxTopicLength: 64,
        },
      });

      const mockWs = {
        data: { clientId: "test-error-123" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      await router.handleOpen(mockWs as any);
      const topics = (router as any).topicsInstances.get("test-error-123");

      // Pattern error
      try {
        await topics.subscribe("room@123");
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        expect(error.code).toBe("INVALID_TOPIC");
        const details = error.details as any;
        expect(details.reason).toBe("pattern");
        expect(typeof details.topic).toBe("string");
      }

      // Length error
      try {
        await topics.subscribe("x".repeat(65));
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

    it("should report length error before pattern error for consistent error reporting", async () => {
      const router = new WebSocketRouter({
        limits: {
          topicPattern: /^[a-z]+$/i,
          maxTopicLength: 32,
        },
      });

      const mockWs = {
        data: { clientId: "test-error-456" },
        subscribe: mock(() => {}),
        unsubscribe: mock(() => {}),
      };

      await router.handleOpen(mockWs as any);
      const topics = (router as any).topicsInstances.get("test-error-456");

      // Topic that is BOTH too long AND has invalid characters
      const invalidTopic = "!".repeat(50);

      try {
        await topics.subscribe(invalidTopic);
        expect.unreachable("Should have thrown");
      } catch (err) {
        const error = err as PubSubError;
        // Length check happens first, so it should be reported
        expect(error.code).toBe("INVALID_TOPIC");
        expect((error.details as any).reason).toBe("length");
      }
    });
  });
});
