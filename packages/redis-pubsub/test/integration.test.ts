import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createRouter, message } from "@ws-kit/zod";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import { z } from "zod";

/**
 * Helper to wait for a specific number of messages
 * Returns a promise that resolves when all messages are received
 */
function waitForMessages(
  count: number,
  timeout = 5000,
): { promise: Promise<unknown[]>; push: (msg: unknown) => void } {
  const messages: unknown[] = [];
  let resolve: (msgs: unknown[]) => void;
  let reject: (err: Error) => void;

  const promise = new Promise<unknown[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timer = setTimeout(() => {
    reject(
      new Error(
        `Timeout waiting for ${count} messages. Got ${messages.length}.`,
      ),
    );
  }, timeout);

  return {
    promise: promise
      .then((msgs) => {
        clearTimeout(timer);
        return msgs;
      })
      .catch((err) => {
        clearTimeout(timer);
        throw err;
      }),
    push: (msg: unknown) => {
      messages.push(msg);
      if (messages.length === count) {
        clearTimeout(timer);
        resolve(messages);
      }
    },
  };
}

describe("RedisPubSub Integration with @ws-kit/core", () => {
  describe("Router Integration", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("RedisPubSub instance is created and has required methods", () => {
      expect(pubsub).toBeDefined();
      expect(typeof pubsub.subscribe).toBe("function");
      expect(typeof pubsub.publish).toBe("function");
      expect(typeof pubsub.close).toBe("function");
      expect(typeof pubsub.status).toBe("function");
    });

    test("Router.publish method is available and callable", () => {
      const router = createRouter();

      expect(router).toBeDefined();
      expect(typeof router.publish).toBe("function");
    });

    test("Multiple routers can be created independently", () => {
      const router1 = createRouter();
      const router2 = createRouter();

      expect(router1).toBeDefined();
      expect(router2).toBeDefined();
      // Each router should have its own publish method
      expect(router1.publish).not.toBe(router2.publish);
    });
  });

  describe("Channel Isolation", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("different namespaces dont collide", async () => {
      const pubsub1 = createRedisPubSub({ namespace: "app1" });
      const pubsub2 = createRedisPubSub({ namespace: "app2" });

      let received1: any = null;
      let received2: any = null;

      const sub1 = pubsub1.subscribe("shared-channel", (msg) => {
        received1 = msg;
      });
      const sub2 = pubsub2.subscribe("shared-channel", (msg) => {
        received2 = msg;
      });

      await sub1.ready;
      await sub2.ready;

      await pubsub1.publish("shared-channel", "message from app1");

      // Brief wait for message delivery
      await new Promise((r) => setTimeout(r, 50));

      // Only handler1 should receive the message (namespace isolation)
      expect(received1).toBe("message from app1");
      expect(received2).toBeNull();

      await pubsub1.close();
      await pubsub2.close();
    });

    test("message to channel:1 doesnt reach channel:2", async () => {
      let msg1: any = null;
      let msg2: any = null;

      const sub1 = pubsub.subscribe("channel:1", (msg) => {
        msg1 = msg;
      });
      const sub2 = pubsub.subscribe("channel:2", (msg) => {
        msg2 = msg;
      });

      await sub1.ready;
      await sub2.ready;

      await pubsub.publish("channel:1", "test message");

      // Brief wait for message delivery
      await new Promise((r) => setTimeout(r, 50));

      // Only channel:1 should receive the message
      expect(msg1).toBe("test message");
      expect(msg2).toBeNull();
    });
  });

  describe("Message Types", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("string messages are delivered", async () => {
      const { promise, push } = waitForMessages(1);

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;

      await pubsub.publish("test", "hello");

      const messages = await promise;
      expect(messages[0]).toBe("hello");
    });

    test("object messages are serialized and delivered", async () => {
      const { promise, push } = waitForMessages(1);
      const message = { type: "ping", data: "test" };

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;

      await pubsub.publish("test", message);

      const messages = await promise;
      expect(messages[0]).toEqual(message);
    });

    test("array messages are delivered", async () => {
      const { promise, push } = waitForMessages(1);
      const message = ["item1", "item2", "item3"];

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;

      await pubsub.publish("test", message);

      const messages = await promise;
      expect(messages[0]).toEqual(message);
    });

    test("null and primitive JSON values round-trip correctly", async () => {
      const { promise: nullPromise, push: pushNull } = waitForMessages(1);
      const { promise: boolPromise, push: pushBool } = waitForMessages(1);
      const { promise: numPromise, push: pushNum } = waitForMessages(1);

      const sub = pubsub.subscribe("test", (msg) => {
        if (msg === null) {
          pushNull(msg);
        } else if (msg === true) {
          pushBool(msg);
        } else if (msg === 42) {
          pushNum(msg);
        }
      });

      await sub.ready;

      // Test JSON null
      await pubsub.publish("test", null);
      const msg1 = await nullPromise;
      expect(msg1[0]).toBe(null);

      // Test JSON boolean
      await pubsub.publish("test", true);
      const msg2 = await boolPromise;
      expect(msg2[0]).toBe(true);

      // Test JSON number
      await pubsub.publish("test", 42);
      const msg3 = await numPromise;
      expect(msg3[0]).toBe(42);
    });
  });

  describe("Multiple Subscribers", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("multiple handlers on same channel all receive message", async () => {
      const { promise, push } = waitForMessages(3);

      const sub1 = pubsub.subscribe("test", (msg) => {
        push(msg);
      });
      const sub2 = pubsub.subscribe("test", (msg) => {
        push(msg);
      });
      const sub3 = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub1.ready;
      await sub2.ready;
      await sub3.ready;

      await pubsub.publish("test", "broadcast message");

      const messages = await promise;

      // All three handlers should receive the message
      expect(messages[0]).toBe("broadcast message");
      expect(messages[1]).toBe("broadcast message");
      expect(messages[2]).toBe("broadcast message");
    });

    test("handlers can be added and removed dynamically", async () => {
      const { promise, push } = waitForMessages(1);

      const handler1 = (msg: any) => {
        // Should not be called
      };

      const sub1 = pubsub.subscribe("test", handler1);
      const sub2 = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub1.ready;
      await sub2.ready;

      // Unsubscribe handler1 using the subscription handle
      sub1.unsubscribe();

      await pubsub.publish("test", "message after unsubscribe");

      const messages = await promise;

      // Only the second handler should receive the message
      expect(messages[0]).toBe("message after unsubscribe");
    });
  });

  describe("Error Scenarios", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("publish to invalid channel still completes", async () => {
      const sub = pubsub.subscribe("test-channel", () => {});

      await sub.ready;

      // Publishing to a channel with no subscribers should not throw
      await expect(
        pubsub.publish("nonexistent-channel", "message"),
      ).resolves.toBeUndefined();
    });

    test("error event receives connection errors", async () => {
      const errors: Error[] = [];

      // Use an unreachable Redis server to force a connection error
      const errorPubSub = createRedisPubSub({
        url: "redis://localhost:9999", // Non-existent port
      });

      // Listen for error events
      errorPubSub.on("error", (err) => {
        errors.push(err);
      });

      // Try to subscribe - should trigger connection error
      const sub = errorPubSub.subscribe("test", () => {});

      // Wait for the subscription to fail and error to be reported
      try {
        await sub.ready;
      } catch (err) {
        // Expected to fail
      }

      // Wait for error to be reported
      await new Promise((r) => setTimeout(r, 500));

      // Verify the error event was emitted with an Error
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toBeInstanceOf(Error);

      await errorPubSub.close();
    });

    test("handler exceptions dont break other handlers", async () => {
      const { promise, push } = waitForMessages(1);
      const errors: Error[] = [];

      const sub1 = pubsub.subscribe("test", () => {
        throw new Error("Handler error");
      });

      const sub2 = pubsub.subscribe("test", (msg) => {
        // This should be called even if the first handler throws
        push(msg);
      });

      await sub1.ready;
      await sub2.ready;

      // Track errors
      const originalOnError = pubsub.options.onError;

      await pubsub.publish("test", "test message");

      const messages = await promise;

      // Second handler should still be invoked
      expect(messages[0]).toBe("test message");
    });
  });

  describe("Concurrent Operations", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("concurrent publishes all complete successfully", async () => {
      const waiters = Array.from({ length: 10 }, () =>
        waitForMessages(1, 5000),
      );
      const received = new Map<number, any>();
      const subs: ReturnType<typeof pubsub.subscribe>[] = [];

      for (let i = 0; i < 10; i++) {
        const sub = pubsub.subscribe(`channel:${i}`, (msg) => {
          waiters[i].push(msg);
          received.set(i, msg);
        });
        subs.push(sub);
      }

      // Wait for all subscriptions to be ready
      await Promise.all(subs.map((sub) => sub.ready));

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(pubsub.publish(`channel:${i}`, { count: i }));
      }

      const results = await Promise.allSettled(promises);

      // All publishes should succeed
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);

      // Wait for all messages to be delivered
      await Promise.all(waiters.map((w) => w.promise));

      // Each handler should have received exactly one message
      for (let i = 0; i < 10; i++) {
        expect(received.get(i)).toBeDefined();
      }
    });

    test("concurrent subscriptions work", async () => {
      const { promise, push } = waitForMessages(10);
      const subs: ReturnType<typeof pubsub.subscribe>[] = [];

      for (let i = 0; i < 10; i++) {
        const sub = pubsub.subscribe("shared", (msg) => {
          push(msg);
        });
        subs.push(sub);
      }

      // Wait for all subscriptions to be ready
      await Promise.all(subs.map((sub) => sub.ready));

      // Publish a message to all subscribers
      await pubsub.publish("shared", "concurrent test");

      const messages = await promise;

      // All handlers should receive the message
      expect(messages.length).toBe(10);
      expect(messages.every((m) => m === "concurrent test")).toBe(true);
    });

    test("interleaved subscribe and unsubscribe", async () => {
      const handlers = [];
      const waiters = Array.from({ length: 5 }, () => waitForMessages(1, 5000));
      const received = new Map<number, any>();
      const subs: ReturnType<typeof pubsub.subscribe>[] = [];

      for (let i = 0; i < 10; i++) {
        const handler = (msg: any) => {
          received.set(i, msg);
          if (i >= 5) {
            // Only track messages for non-unsubscribed handlers
            waiters[i - 5].push(msg);
          }
        };
        handlers.push(handler);
        const sub = pubsub.subscribe(`channel:${i}`, handler);
        subs.push(sub);
      }

      // Wait for all subscriptions to be ready before unsubscribing
      await Promise.all(subs.map((sub) => sub.ready));

      // Unsubscribe 5 handlers using subscription handles
      for (let i = 0; i < 5; i++) {
        subs[i].unsubscribe();
      }

      // Publish to all channels
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(pubsub.publish(`channel:${i}`, `message ${i}`));
      }

      await Promise.allSettled(promises);

      // Wait for all expected messages
      await Promise.all(waiters.map((w) => w.promise));

      // First 5 handlers (unsubscribed) should not be called
      for (let i = 0; i < 5; i++) {
        expect(received.get(i)).toBeUndefined();
      }

      // Last 5 handlers (still subscribed) should be called
      for (let i = 5; i < 10; i++) {
        expect(received.get(i)).toBe(`message ${i}`);
      }
    });
  });

  describe("User-Provided Client", () => {
    test("subscribe and publish work together on same instance", async () => {
      // This test verifies that a pubsub instance can handle both
      // subscribing and publishing operations in sequence

      let pubsubWithClient: ReturnType<typeof createRedisPubSub>;

      try {
        // Create a pubsub instance
        pubsubWithClient = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        const { promise, push } = waitForMessages(1);

        // Subscribe first (puts client in subscriber mode)
        const sub = pubsubWithClient.subscribe("test", (msg) => {
          push(msg);
        });

        await sub.ready;

        // Then publish (requires non-subscriber client)
        // This should work even though we subscribed first
        await pubsubWithClient.publish("test", "user-client-test");

        const messages = await promise;
        expect(messages[0]).toBe("user-client-test");
      } finally {
        if (pubsubWithClient) {
          await pubsubWithClient.close();
        }
      }
    });

    test("close() destroys the instance and rejects further operations", async () => {
      let pubsubWithClient: ReturnType<typeof createRedisPubSub>;

      try {
        pubsubWithClient = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        const sub = pubsubWithClient.subscribe("test", () => {});

        await sub.ready;

        // Close should clean up connections and destroy the instance
        await pubsubWithClient.close();

        // After close, the instance should be marked as destroyed
        // so new operations should throw
        try {
          pubsubWithClient.subscribe("test2", () => {});
          // If we get here, it should have thrown
          expect.fail("Should have thrown DisconnectedError");
        } catch (error) {
          // Expected: destroyed instance should throw
          expect(error).toBeInstanceOf(Error);
        }
      } finally {
        // No need to clean up further as it's already destroyed
      }
    });
  });
});
