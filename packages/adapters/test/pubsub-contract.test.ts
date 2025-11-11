// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { test, describe } from "bun:test";
import { strict as assert } from "assert";
import type { PubSubDriver, PublishEnvelope } from "@ws-kit/core/pubsub";

/**
 * PubSubDriver contract tests.
 *
 * Every driver implementation (memory, redis, cloudflare, etc.)
 * must satisfy these tests to ensure consistent behavior.
 */
export function createPubSubContractTests(
  name: string,
  createDriver: () => PubSubDriver,
) {
  describe(`PubSubDriver: ${name}`, () => {
    let driver: PubSubDriver;

    // Reset driver before each test
    if (globalThis.beforeEach) {
      beforeEach(() => {
        driver = createDriver();
      });
    }

    // ===== subscribe / unsubscribe =====

    test("subscribe: adds client to topic", async () => {
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");

      // Verify by checking local subscribers
      const subscribers = [];
      for await (const id of driver.getSubscribers("topic:123")) {
        subscribers.push(id);
      }
      assert.deepEqual(subscribers, ["client1"]);
    });

    test("subscribe: idempotent (subscribe twice is no-op)", async () => {
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");
      await driver.subscribe("client1", "topic:123");

      // Should still have only one subscriber
      const subscribers = [];
      for await (const id of driver.getSubscribers("topic:123")) {
        subscribers.push(id);
      }
      assert.equal(subscribers.length, 1);
    });

    test("subscribe: multiple clients on same topic", async () => {
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");
      await driver.subscribe("client2", "topic:123");

      const subscribers = [];
      for await (const id of driver.getSubscribers("topic:123")) {
        subscribers.push(id);
      }
      assert.equal(subscribers.length, 2);
      assert(subscribers.includes("client1"));
      assert(subscribers.includes("client2"));
    });

    test("unsubscribe: removes client from topic", async () => {
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");
      await driver.unsubscribe("client1", "topic:123");

      const subscribers = [];
      for await (const id of driver.getSubscribers("topic:123")) {
        subscribers.push(id);
      }
      assert.equal(subscribers.length, 0);
    });

    test("unsubscribe: idempotent (unsubscribe twice is no-op)", async () => {
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");
      await driver.unsubscribe("client1", "topic:123");
      // Second unsubscribe should not throw
      await driver.unsubscribe("client1", "topic:123");

      const subscribers = [];
      for await (const id of driver.getSubscribers("topic:123")) {
        subscribers.push(id);
      }
      assert.equal(subscribers.length, 0);
    });

    test("unsubscribe: non-existent client/topic does not throw", async () => {
      const driver = createDriver();

      // Should not throw
      await driver.unsubscribe("unknown-client", "unknown-topic");
    });

    test("unsubscribe: affects only specified client", async () => {
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");
      await driver.subscribe("client2", "topic:123");
      await driver.unsubscribe("client1", "topic:123");

      const subscribers = [];
      for await (const id of driver.getSubscribers("topic:123")) {
        subscribers.push(id);
      }
      assert.equal(subscribers.length, 1);
      assert(subscribers.includes("client2"));
    });

    // ===== publish =====

    test("publish: returns ok: true on success", async () => {
      const driver = createDriver();

      const envelope: PublishEnvelope = {
        topic: "topic:123",
        payload: { message: "hello" },
        type: "TestMessage",
      };

      const result = await driver.publish(envelope);

      assert.equal(result.ok, true);
      // matchedLocal is optional; if present, must be number >= 0
      if (result.matchedLocal !== undefined) {
        assert.equal(typeof result.matchedLocal, "number");
        assert(result.matchedLocal >= 0);
      }
    });

    test("publish: reports 0 matched when no subscribers", async () => {
      const driver = createDriver();

      const envelope: PublishEnvelope = {
        topic: "topic:no-subscribers",
        payload: { message: "hello" },
      };

      const result = await driver.publish(envelope);

      assert.equal(result.ok, true);
      assert.equal(result.matchedLocal, 0);
    });

    test("publish: memory adapter returns exact capability", async () => {
      // This test is specific to memory adapter (or any local-only implementation)
      // Distributed adapters may return "unknown" or "estimate"
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");
      await driver.subscribe("client2", "topic:123");

      const envelope: PublishEnvelope = {
        topic: "topic:123",
        payload: { message: "hello" },
      };

      const result = await driver.publish(envelope);

      assert.equal(result.ok, true);
      // Memory adapter should return exact count
      if (result.capability === "exact") {
        assert.equal(result.matchedLocal, 2);
      }
    });

    test("publish: respects envelope fields", async () => {
      const driver = createDriver();

      const envelope: PublishEnvelope = {
        topic: "notifications",
        payload: { userId: "123", action: "login" },
        type: "UserAuthenticated",
        meta: { timestamp: 1234567890, source: "auth-service" },
      };

      const result = await driver.publish(envelope);

      assert.equal(result.ok, true);
      // Driver should not validate payload/meta—router does that
      // Just verify it accepts and processes the envelope
    });

    // ===== getSubscribers =====

    test("getSubscribers: returns async iterable", async () => {
      const driver = createDriver();

      await driver.subscribe("client1", "topic:123");

      const result = driver.getSubscribers("topic:123");

      // Should be async iterable
      assert(result[Symbol.asyncIterator]);

      const subscribers = [];
      for await (const id of result) {
        subscribers.push(id);
      }
      assert.equal(subscribers.length, 1);
    });

    test("getSubscribers: yields all subscribers", async () => {
      const driver = createDriver();

      const clientIds = ["client1", "client2", "client3"];
      for (const id of clientIds) {
        await driver.subscribe(id, "topic:123");
      }

      const subscribers = [];
      for await (const id of driver.getSubscribers("topic:123")) {
        subscribers.push(id);
      }

      assert.equal(subscribers.length, 3);
      for (const id of clientIds) {
        assert(subscribers.includes(id));
      }
    });

    test("getSubscribers: empty iterable for non-existent topic", async () => {
      const driver = createDriver();

      const subscribers = [];
      for await (const id of driver.getSubscribers("non-existent")) {
        subscribers.push(id);
      }

      assert.equal(subscribers.length, 0);
    });

    test("getSubscribers: lazy iteration (doesn't materialize all at once)", async () => {
      const driver = createDriver();

      // This is a behavior test: adapter should yield items lazily
      // For memory adapter, we can verify by checking multiple subscriptions
      for (let i = 0; i < 100; i++) {
        await driver.subscribe(`client${i}`, "topic:big");
      }

      const iterable = driver.getSubscribers("topic:big");

      // Partial iteration should work
      const iterator = iterable[Symbol.asyncIterator]();
      const first = await iterator.next();
      assert.equal(first.done, false);
      assert(typeof first.value === "string");

      const second = await iterator.next();
      assert.equal(second.done, false);
    });

    // ===== listTopics / hasTopic (optional) =====

    test("listTopics: returns array of topics (if implemented)", async () => {
      const driver = createDriver();

      if (!driver.listTopics) {
        // Optional method
        return;
      }

      await driver.subscribe("client1", "topic:a");
      await driver.subscribe("client1", "topic:b");

      const topics = await driver.listTopics();

      assert(Array.isArray(topics));
      // Memory adapter should include subscribed topics
      if (driver.constructor.name.includes("Memory")) {
        assert(topics.includes("topic:a"));
        assert(topics.includes("topic:b"));
      }
    });

    test("hasTopic: returns boolean (if implemented)", async () => {
      const driver = createDriver();

      if (!driver.hasTopic) {
        // Optional method
        return;
      }

      await driver.subscribe("client1", "topic:exists");

      const hasEmpty = await driver.hasTopic("non-existent");
      const hasExisting = await driver.hasTopic("topic:exists");

      assert.equal(typeof hasEmpty, "boolean");
      assert.equal(typeof hasExisting, "boolean");

      // Memory adapter should report correctly
      if (driver.constructor.name.includes("Memory")) {
        assert.equal(hasEmpty, false);
        assert.equal(hasExisting, true);
      }
    });

    // ===== close (optional) =====

    test("close: cleans up resources (if implemented)", async () => {
      const driver = createDriver();

      if (!driver.close) {
        // Optional method
        return;
      }

      await driver.subscribe("client1", "topic:123");
      await driver.close();

      // After close, further operations may fail or be no-op
      // This depends on adapter implementation
    });
  });
}
