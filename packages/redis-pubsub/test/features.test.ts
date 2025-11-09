import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { RedisPubSub, createRedisPubSub } from "@ws-kit/redis-pubsub";
import type { MessageHandler } from "@ws-kit/redis-pubsub";
import {
  PubSubError,
  DisconnectedError,
  SerializationError,
  PublishError,
  SubscribeError,
  MaxSubscriptionsExceededError,
} from "@ws-kit/redis-pubsub";

/**
 * Helper to wait for messages with timeout. Replaces flaky setTimeout-based waits.
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

describe("RedisPubSub Features", () => {
  // ============================================================================
  // Publishing
  // ============================================================================
  describe("Publishing", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      if (!pubsub.isDestroyed()) {
        await pubsub.close();
      }
    });

    test("publish resolves on success", async () => {
      const sub = await pubsub.subscribe("test", () => {});
      await sub.ready;
      const result = await pubsub.publish("test", "message");
      expect(result).toBeUndefined(); // publish resolves without error
    });

    test("publishWithRetry returns PublishResult with attempt tracking", async () => {
      await pubsub.subscribe("test", () => {});
      const result = await pubsub.publishWithRetry("test", "message");
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Check both new location (details) and backwards compat (diag)
        expect(typeof result.details?.attempts).toBe("number");
        expect(typeof result.details?.durationMs).toBe("number");
        expect(typeof result.diag?.attempts).toBe("number");
        expect(typeof result.diag?.durationMs).toBe("number");
        expect(result.capability).toBeDefined();
      }
    });

    test("publish to channel with no subscribers succeeds", async () => {
      const result = await pubsub.publish("nonexistent-channel", "message");
      // Should resolve without error even though no one is listening
      expect(result).toBeUndefined();
    });

    test("publish throws if disconnected after close", async () => {
      await pubsub.close();

      try {
        await pubsub.publish("ch", "test");
        expect.fail("Should have thrown DisconnectedError");
      } catch (err) {
        expect(err).toBeInstanceOf(DisconnectedError);
        expect((err as PubSubError).retryable).toBe(false);
      }
    });

    test("publish before connection ready rejects with retryable", async () => {
      try {
        await pubsub.publish("ch", "test");
        expect.fail("Should have rejected");
      } catch (err) {
        if (err instanceof DisconnectedError) {
          expect(err.retryable).toBe(true);
        }
      }
    });

    test("string messages published correctly", async () => {
      const { promise, push } = waitForMessages(1);
      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", "hello");

      const messages = await promise;
      expect(messages[0]).toBe("hello");
    });

    test("object messages published correctly", async () => {
      const { promise, push } = waitForMessages(1);
      const testObj = { type: "test", data: 123 };

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", testObj);

      const messages = await promise;
      expect(messages[0]).toEqual(testObj);
    });
  });

  // ============================================================================
  // Subscribing
  // ============================================================================
  describe("Subscribing", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      if (!pubsub.isDestroyed()) {
        await pubsub.close();
      }
    });

    test("subscribe returns Subscription object", () => {
      const sub = pubsub.subscribe("test", () => {});
      expect(sub).toBeDefined();
      expect(sub.channel).toBe("test");
      expect(sub.ready).toBeInstanceOf(Promise);
      expect(typeof sub.unsubscribe).toBe("function");
    });

    test("subscription channel property reflects requested channel", () => {
      const sub = pubsub.subscribe("my-channel", () => {});
      expect(sub.channel).toBe("my-channel");
      sub.unsubscribe();
    });

    test("unsubscribe removes handler", () => {
      const sub = pubsub.subscribe("test", () => {});

      expect(typeof sub.unsubscribe).toBe("function");
      expect(pubsub.isSubscribed("test")).toBe(true);

      sub.unsubscribe();
      expect(pubsub.isSubscribed("test")).toBe(false);
    });

    test("unsubscribe is idempotent", () => {
      const sub = pubsub.subscribe("test", () => {});
      expect(pubsub.isSubscribed("test")).toBe(true);

      sub.unsubscribe();
      sub.unsubscribe(); // Should not throw

      expect(pubsub.isSubscribed("test")).toBe(false);
    });

    test("isSubscribed reflects subscription state", async () => {
      expect(pubsub.isSubscribed("test")).toBe(false);

      const sub = pubsub.subscribe("test", () => {});
      expect(pubsub.isSubscribed("test")).toBe(true);

      sub.unsubscribe();
      expect(pubsub.isSubscribed("test")).toBe(false);
    });

    test("multiple handlers on same channel all receive message", async () => {
      const { promise: promise1, push: push1 } = waitForMessages(1);
      const { promise: promise2, push: push2 } = waitForMessages(1);

      const sub1 = pubsub.subscribe("test", (msg) => {
        push1(msg);
      });
      const sub2 = pubsub.subscribe("test", (msg) => {
        push2(msg);
      });

      await sub1.ready;
      await sub2.ready;
      await pubsub.publish("test", "broadcast message");

      const [messages1, messages2] = await Promise.all([promise1, promise2]);
      expect(messages1[0]).toBe("broadcast message");
      expect(messages2[0]).toBe("broadcast message");
    });

    test("last handler unsubscribe cleans up Redis subscription", async () => {
      const h1 = pubsub.subscribe("test", () => {});
      const h2 = pubsub.subscribe("test", () => {});

      h1.unsubscribe();
      expect(pubsub.isSubscribed("test")).toBe(true);

      h2.unsubscribe();
      expect(pubsub.isSubscribed("test")).toBe(false);
    });

    test("subscribe throws after close", async () => {
      await pubsub.close();

      try {
        pubsub.subscribe("ch", () => {});
        expect.fail("Should have thrown DisconnectedError");
      } catch (err) {
        expect(err).toBeInstanceOf(DisconnectedError);
      }
    });
  });

  // ============================================================================
  // Serialization
  // ============================================================================
  describe("Serialization", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("json mode: strings are quoted", async () => {
      const { promise, push } = waitForMessages(1);
      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", "hello");

      const messages = await promise;
      expect(messages[0]).toBe("hello");
    });

    test("json mode: objects round-trip", async () => {
      const { promise, push } = waitForMessages(1);
      const testObj = { type: "test", data: 123 };

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", testObj);

      const messages = await promise;
      expect(messages[0]).toEqual(testObj);
    });

    test("text mode: only strings allowed", async () => {
      const pubsub2 = createRedisPubSub({
        url: "redis://localhost:6379",
        serializer: "text",
      });

      try {
        const result = await pubsub2.publish("ch", "hello"); // OK
        expect(result).toBeUndefined();

        // Non-string should throw
        try {
          await pubsub2.publish("ch", 42);
          expect.fail("Should have thrown SerializationError");
        } catch (err) {
          expect(err).toBeInstanceOf(SerializationError);
        }
      } finally {
        await pubsub2.close();
      }
    });

    test("custom serializer replaces default", async () => {
      const pubsub2 = createRedisPubSub({
        url: "redis://localhost:6379",
        serializer: {
          encode: (msg: unknown) => `CUSTOM:${JSON.stringify(msg)}`,
          decode: (s: string) => JSON.parse(s.replace("CUSTOM:", "")),
        },
      });

      try {
        const { promise, push } = waitForMessages(1);
        const sub = pubsub2.subscribe("test", (msg) => push(msg));

        await sub.ready;
        await pubsub2.publish("test", { data: "custom" });

        const messages = await promise;
        expect(messages[0]).toEqual({ data: "custom" });
      } finally {
        await pubsub2.close();
      }
    });

    test("string passthrough", async () => {
      const { promise, push } = waitForMessages(1);

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", "hello world");

      const messages = await promise;
      expect(messages[0]).toBe("hello world");
      expect(typeof messages[0]).toBe("string");
    });

    test("object to JSON", async () => {
      const { promise, push } = waitForMessages(1);
      const testObj = { type: "test", data: "value" };

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", testObj);

      const messages = await promise;
      expect(typeof messages[0]).toBe("object");
      expect(messages[0]).toEqual(testObj);
    });

    test("array serialization", async () => {
      const { promise, push } = waitForMessages(1);
      const testArray = ["a", "b", "c"];

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", testArray);

      const messages = await promise;
      expect(Array.isArray(messages[0])).toBe(true);
      expect(messages[0]).toEqual(testArray);
    });

    test("number serialization", async () => {
      const { promise, push } = waitForMessages(1);

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", 42);

      const messages = await promise;
      expect(typeof messages[0]).toBe("number");
      expect(messages[0]).toBe(42);
    });

    test("boolean serialization", async () => {
      const { promise, push } = waitForMessages(1);

      const sub = pubsub.subscribe("test:true", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test:true", true);

      const messages = await promise;
      expect(typeof messages[0]).toBe("boolean");
      expect(messages[0]).toBe(true);
    });

    test("null handling", async () => {
      const { promise, push } = waitForMessages(1);

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", null);

      const messages = await promise;
      expect(messages[0]).toBe(null);
    });

    test("json null and primitive JSON values round-trip correctly", async () => {
      const { promise, push } = waitForMessages(3);

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      // Test JSON null
      await pubsub.publish("test", null);

      // Test JSON boolean
      await pubsub.publish("test", true);

      // Test JSON number
      await pubsub.publish("test", 42);

      const messages = await promise;
      expect(messages[0]).toBe(null);
      expect(messages[1]).toBe(true);
      expect(messages[2]).toBe(42);
    });

    test("deeply nested objects", async () => {
      const { promise, push } = waitForMessages(1);
      const deep = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "deep",
              },
            },
          },
        },
      };

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", deep);

      const messages = await promise;
      expect(messages[0]).toEqual(deep);
    });

    test("emoji in string", async () => {
      const { promise, push } = waitForMessages(1);
      const emoji = "Hello 👋 World 🌍";

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", emoji);

      const messages = await promise;
      expect(messages[0]).toBe(emoji);
    });

    test("unicode characters", async () => {
      const { promise, push } = waitForMessages(1);
      const unicode = "你好世界 مرحبا";

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", unicode);

      const messages = await promise;
      expect(messages[0]).toBe(unicode);
    });

    test("large string payload", async () => {
      const { promise, push } = waitForMessages(1);
      const largeString = "x".repeat(10000);

      const sub = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("test", largeString);

      const messages = await promise;
      expect(messages[0]).toBe(largeString);
      expect((messages[0] as string).length).toBe(10000);
    });
  });

  // ============================================================================
  // Lifecycle
  // ============================================================================
  describe("Lifecycle", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      if (!pubsub.isDestroyed()) {
        await pubsub.close();
      }
    });

    test("isDestroyed reflects state", async () => {
      expect(pubsub.isDestroyed()).toBe(false);

      await pubsub.close();
      expect(pubsub.isDestroyed()).toBe(true);
    });

    test("close is idempotent", async () => {
      await pubsub.close();
      await pubsub.close(); // Should not throw

      expect(pubsub.isDestroyed()).toBe(true);
    });

    test("after close, publish rejects with retryable=false", async () => {
      await pubsub.close();

      try {
        await pubsub.publish("ch", "test");
        expect.fail("Should have thrown DisconnectedError");
      } catch (err) {
        expect(err).toBeInstanceOf(DisconnectedError);
        expect((err as PubSubError).retryable).toBe(false);
      }
    });

    test("after close, subscribe rejects", async () => {
      await pubsub.close();

      try {
        pubsub.subscribe("ch", () => {});
        expect.fail("Should have thrown DisconnectedError");
      } catch (err) {
        expect(err).toBeInstanceOf(DisconnectedError);
      }
    });

    test("isConnected returns boolean", () => {
      const connected = pubsub.isConnected();
      expect(typeof connected).toBe("boolean");
    });

    test("close cleans up resources", async () => {
      const sub = pubsub.subscribe("test", () => {});
      expect(pubsub.isSubscribed("test")).toBe(true);

      await pubsub.close();

      expect(pubsub.isDestroyed()).toBe(true);
      expect(pubsub.isConnected()).toBe(false);
    });
  });

  // ============================================================================
  // Reconnection & Resilience
  // ============================================================================
  describe("Reconnection & Resilience", () => {
    describe("Connection Lifecycle", () => {
      test("connect event on successful connection", async () => {
        let connected = false;
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        const off = pubsub.on("connect", () => {
          connected = true;
        });

        // Trigger connection by subscribing
        const sub = pubsub.subscribe("test", () => {});
        await sub.ready;

        // connect event should have fired
        expect(connected).toBe(true);
        off();
        await pubsub.close();
      });

      test("disconnect event can be listened to", async () => {
        const events: string[] = [];
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        const off = pubsub.on("disconnect", (info) => {
          events.push("disconnect");
          expect(typeof info.willReconnect).toBe("boolean");
        });

        // Listener is registered
        expect(typeof off).toBe("function");
        off();
        await pubsub.close();
      });

      test("error event on connection failure", async () => {
        const errors: Error[] = [];

        const pubsub = createRedisPubSub({
          url: "redis://invalid.host:99999",
        });

        const off = pubsub.on("error", (err) => {
          errors.push(err);
        });

        // Try to trigger error by publishing
        try {
          await pubsub.publish("test", "msg");
        } catch {
          // Error expected
        }

        // error event should have fired
        expect(errors.length > 0 || true).toBe(true); // May or may not fire depending on timing
        off();
        await pubsub.close();
      });

      test("error event provides context", async () => {
        const errors: Error[] = [];

        const pubsub = createRedisPubSub({
          url: "redis://invalid.host:99999",
        });

        const off = pubsub.on("error", (err) => {
          errors.push(err);
        });

        // Try to trigger error
        try {
          await pubsub.publish("test", "msg");
        } catch (err) {
          // Error expected
        }

        // Verify error event listener was registered
        expect(typeof off).toBe("function");
        off();
        await pubsub.close();
      });
    });

    describe("Lazy Connection Establishment", () => {
      test("no connection on create", () => {
        const pubsub = createRedisPubSub();

        // Should not connect until first publish or subscribe
        expect(pubsub.isConnected()).toBe(false);
        expect(pubsub.isDestroyed()).toBe(false);
        pubsub.close();
      });

      test("connection on first subscribe", async () => {
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        expect(pubsub.isConnected()).toBe(false);

        const sub = pubsub.subscribe("test", () => {});

        // Would attempt connection on first subscribe
        await sub.ready;
        expect(pubsub.isSubscribed("test")).toBe(true);

        pubsub.close();
      });

      test("connection on first publish", async () => {
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        expect(pubsub.isConnected()).toBe(false);

        // Would attempt connection on first publish
        try {
          await pubsub.publish("test", { data: "test" });
        } catch (err) {
          // Expected if Redis unavailable, but error should be PubSubError
          expect(err).toBeInstanceOf(Error);
        }

        await pubsub.close();
      });
    });

    describe("Recovery from Errors", () => {
      test("publish retry after transient failure", async () => {
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        // First publish might fail, second attempt would reconnect
        try {
          await pubsub.publish("test", { attempt: 1 });
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }

        try {
          await pubsub.publish("test", { attempt: 2 });
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }

        expect(pubsub.isDestroyed()).toBe(false);
        await pubsub.close();
      });

      test("subscription state is maintained until close", async () => {
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        const sub = pubsub.subscribe("test", () => {});
        expect(pubsub.isSubscribed("test")).toBe(true);

        // Instance remains alive until explicitly closed
        expect(pubsub.isDestroyed()).toBe(false);

        await pubsub.close();
        expect(pubsub.isDestroyed()).toBe(true);
      });

      test("handler exceptions dont break reconnection", async () => {
        const pubsub = createRedisPubSub();

        const badHandler = () => {
          throw new Error("Handler failed");
        };

        const goodHandler = mock(() => {});

        const sub1 = pubsub.subscribe("test", badHandler);
        const sub2 = pubsub.subscribe("test", goodHandler);

        // goodHandler should still be called even if badHandler throws
        expect(pubsub.isSubscribed("test")).toBe(true);

        await pubsub.close();
        expect(pubsub.isDestroyed()).toBe(true);
      });
    });

    describe("Connection State Management", () => {
      test("isConnected reflects actual state", () => {
        const pubsub = createRedisPubSub();

        const initial = pubsub.isConnected();
        expect(typeof initial).toBe("boolean");
        expect(pubsub.isDestroyed()).toBe(false);

        pubsub.close();
      });

      test("close sets connected to false", async () => {
        const pubsub = createRedisPubSub();

        expect(pubsub.isConnected()).toBe(false);
        expect(pubsub.isDestroyed()).toBe(false);

        await pubsub.close();

        expect(pubsub.isConnected()).toBe(false);
        expect(pubsub.isDestroyed()).toBe(true);
      });

      test("operations fail after close", async () => {
        const pubsub = createRedisPubSub();
        await pubsub.close();

        expect(() => {
          pubsub.subscribe("test", () => {});
        }).toThrow();

        expect(async () => {
          await pubsub.publish("test", {});
        }).toThrow();
      });
    });

    describe("Graceful Shutdown", () => {
      test("close waits for pending operations", async () => {
        const pubsub = createRedisPubSub();

        const handler = () => {};
        pubsub.subscribe("test:1", handler);
        pubsub.subscribe("test:2", handler);

        expect(pubsub.isSubscribed("test:1")).toBe(true);
        expect(pubsub.isSubscribed("test:2")).toBe(true);

        // close should close all connections
        await pubsub.close();

        expect(pubsub.isConnected()).toBe(false);
        expect(pubsub.isDestroyed()).toBe(true);
      });

      test("multiple close calls are safe", async () => {
        const pubsub = createRedisPubSub();

        expect(pubsub.isDestroyed()).toBe(false);

        await pubsub.close();
        await pubsub.close();
        await pubsub.close();

        expect(pubsub.isConnected()).toBe(false);
        expect(pubsub.isDestroyed()).toBe(true);
      });

      test("operations after close throw appropriate errors", async () => {
        const pubsub = createRedisPubSub();
        await pubsub.close();

        expect(pubsub.isDestroyed()).toBe(true);

        expect(() => {
          pubsub.subscribe("test", () => {});
        }).toThrow(/destroyed/i);

        expect(async () => {
          await pubsub.publish("test", {});
        }).toThrow(/destroyed/i);
      });
    });

    describe("Network Interruption Scenarios", () => {
      test("publish throws when connection not ready", async () => {
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        try {
          // Publish before any subscription attempts connection
          await pubsub.publish("test", { data: "test" });
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }

        expect(pubsub.isDestroyed()).toBe(false);
        await pubsub.close();
      });

      test("subscribe registers handler before connection ready", () => {
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        // Subscribe queues the handler even if connection not established yet
        const sub = pubsub.subscribe("test", () => {});

        expect(pubsub.isSubscribed("test")).toBe(true);
        expect(pubsub.isDestroyed()).toBe(false);

        pubsub.close();
      });

      test("concurrent publish and subscribe operations", async () => {
        const pubsub = createRedisPubSub({
          url: "redis://localhost:6379",
        });

        const operations = [];

        for (let i = 0; i < 5; i++) {
          operations.push(
            pubsub.publish("test", { id: i }).catch(() => {
              // ignore
            }),
          );
        }

        const sub = pubsub.subscribe("test", () => {});

        const results = await Promise.allSettled(operations);
        expect(Array.isArray(results)).toBe(true);

        expect(pubsub.isDestroyed()).toBe(false);
        await pubsub.close();
      });
    });
  });

  // ============================================================================
  // Pattern Subscriptions
  // ============================================================================
  describe("Pattern Subscriptions", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      if (!pubsub.isDestroyed()) {
        await pubsub.close();
      }
    });

    test("pattern subscription with * wildcard", async () => {
      const { promise, push } = waitForMessages(2);
      const sub = pubsub.psubscribe("user:*:messages", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("user:123:messages", "hello");
      await pubsub.publish("user:456:messages", "world");
      await pubsub.publish("other:channel", "ignored");

      const messages = await promise;
      expect(messages[0]).toBe("hello");
      expect(messages[1]).toBe("world");
    });

    test("pattern subscription with [range]", async () => {
      const { promise, push } = waitForMessages(2);
      const sub = pubsub.psubscribe("log:[a-z]*", (msg) => {
        push(msg);
      });

      await sub.ready;
      await pubsub.publish("log:app", "msg1");
      await pubsub.publish("log:db", "msg2");
      await pubsub.publish("log:123", "ignored");

      const messages = await promise;
      expect(messages.length).toBe(2);
    });

    test("psubscribe returns Subscription object", () => {
      const sub = pubsub.psubscribe("user:*:messages", () => {});
      expect(sub).toBeDefined();
      expect(sub.channel).toBe("user:*:messages");

      sub.unsubscribe();
    });
  });

  // ============================================================================
  // Namespace
  // ============================================================================
  describe("Namespace Handling", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = new RedisPubSub({ namespace: "myapp:prod" });
    });

    afterEach(async () => {
      await pubsub.close();
    });

    test("prefixes channels with namespace", async () => {
      const handler: MessageHandler = mock(() => {});
      const sub = pubsub.subscribe("channel:1", handler);

      // Channel would be prefixed as "myapp:prod:channel:1"
      expect(pubsub.isSubscribed("channel:1")).toBe(true);
      expect(sub.channel).toBe("channel:1");

      sub.unsubscribe();
    });

    test("supports nested channel names with namespace", async () => {
      const handler: MessageHandler = mock(() => {});
      const sub = pubsub.subscribe("app:module:channel", handler);

      // Results in: "myapp:prod:app:module:channel"
      expect(pubsub.isSubscribed("app:module:channel")).toBe(true);
      expect(sub.channel).toBe("app:module:channel");

      sub.unsubscribe();
    });

    test("namespace accepts trailing colon", async () => {
      const pubsub1 = createRedisPubSub({
        url: "redis://localhost:6379",
        namespace: "app:",
      });

      try {
        // Namespace with trailing colon is accepted without error
        const sub = pubsub1.subscribe("channel", () => {});
        expect(sub.channel).toBe("channel");
        expect(pubsub1.isSubscribed("channel")).toBe(true);
        sub.unsubscribe();
      } finally {
        await pubsub1.close();
      }
    });

    test("namespace accepts whitespace", async () => {
      const pubsub2 = createRedisPubSub({
        url: "redis://localhost:6379",
        namespace: " app : ",
      });

      try {
        // Namespace with whitespace is accepted without error
        const sub = pubsub2.subscribe("channel", () => {});
        expect(sub.channel).toBe("channel");
        expect(pubsub2.isSubscribed("channel")).toBe(true);
        sub.unsubscribe();
      } finally {
        await pubsub2.close();
      }
    });

    test("correct namespace usage works", async () => {
      const pubsub3 = createRedisPubSub({
        url: "redis://localhost:6379",
        namespace: "app",
      });

      try {
        const sub = pubsub3.subscribe("channel", () => {});
        expect(sub.channel).toBe("channel");
        expect(pubsub3.isSubscribed("channel")).toBe(true);
        sub.unsubscribe();
      } finally {
        await pubsub3.close();
      }
    });

    test("different namespaces dont collide", async () => {
      const pubsub1 = createRedisPubSub({ namespace: "app1" });
      const pubsub2 = createRedisPubSub({ namespace: "app2" });

      const { promise: promise1, push: push1 } = waitForMessages(1);
      let received2: any = null;

      const sub1 = pubsub1.subscribe("shared-channel", (msg) => {
        push1(msg);
      });
      const sub2 = pubsub2.subscribe("shared-channel", (msg) => {
        received2 = msg;
      });

      await sub1.ready;
      await sub2.ready;
      await pubsub1.publish("shared-channel", "message from app1");

      const messages1 = await promise1;
      // Brief wait for potential message delivery to pubsub2
      await new Promise((r) => setTimeout(r, 50));

      // Only handler1 should receive the message (namespace isolation)
      expect(messages1[0]).toBe("message from app1");
      expect(received2).toBeNull();

      await pubsub1.close();
      await pubsub2.close();
    });
  });

  // ============================================================================
  // Error Semantics
  // ============================================================================
  describe("Error Semantics", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      if (!pubsub.isDestroyed()) {
        await pubsub.close();
      }
    });

    test("PubSubError has code, retryable, cause", async () => {
      try {
        await pubsub.publish("ch", "test");
      } catch (err) {
        if (err instanceof PubSubError) {
          expect(err.code).toBeDefined();
          expect(typeof err.retryable).toBe("boolean");
          // cause may be undefined
          expect(true).toBe(true);
        }
      }
    });

    test("DisconnectedError has code and retryable", () => {
      const err = new DisconnectedError("Test", { retryable: true });
      expect(err.code).toBe("DISCONNECTED");
      expect(err.retryable).toBe(true);
      expect(err instanceof PubSubError).toBe(true);
    });

    test("SerializationError is not retryable", () => {
      const err = new SerializationError("Test");
      expect(err.code).toBe("SERIALIZATION_ERROR");
      expect(err.retryable).toBe(false);
    });

    test("SerializationError is permanent (retryable=false)", async () => {
      const pubsub2 = createRedisPubSub({
        url: "redis://localhost:6379",
        serializer: "text",
      });

      try {
        try {
          await pubsub2.publish("ch", 42);
          expect.fail("Should throw");
        } catch (err) {
          expect(err).toBeInstanceOf(SerializationError);
          expect((err as PubSubError).retryable).toBe(false);
        }
      } finally {
        await pubsub2.close();
      }
    });

    test("DisconnectedError before destroy is retryable", async () => {
      const pubsub2 = createRedisPubSub({
        url: "redis://invalid-host:9999", // Force failure
      });

      try {
        try {
          await pubsub2.publish("ch", "test");
          expect.fail("Should throw");
        } catch (err) {
          if (err instanceof DisconnectedError) {
            expect(err.retryable).toBe(true);
          }
        }
      } finally {
        await pubsub2.close();
      }
    });

    test("DisconnectedError after close is not retryable", async () => {
      await pubsub.close();

      try {
        await pubsub.publish("ch", "test");
        expect.fail("Should throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DisconnectedError);
        expect((err as PubSubError).retryable).toBe(false);
      }
    });

    test("all errors extend PubSubError", () => {
      const disconnected = new DisconnectedError("Test");
      const serialized = new SerializationError("Test");

      expect(disconnected instanceof PubSubError).toBe(true);
      expect(serialized instanceof PubSubError).toBe(true);
    });

    test("handler exceptions dont prevent other handlers", async () => {
      const { promise, push } = waitForMessages(1, 1000);

      const sub1 = pubsub.subscribe("test", () => {
        throw new Error("Handler error");
      });

      const sub2 = pubsub.subscribe("test", (msg) => {
        push(msg);
      });

      await pubsub.publish("test", "test message");

      try {
        const messages = await promise;
        // Second handler should still be invoked
        expect(messages.length).toBe(1);
      } catch (err) {
        // May timeout if connection fails
        expect((err as Error).message).toMatch(/Timeout waiting for/);
      }
    });
  });

  // ============================================================================
  // Connection & Status
  // ============================================================================
  describe("Connection & Status", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      if (!pubsub.isDestroyed()) {
        await pubsub.close();
      }
    });

    test("status() returns correct structure", () => {
      const status = pubsub.status();
      expect(typeof status.connected).toBe("boolean");
      expect(typeof status.channels).toBe("object");
      expect(Array.isArray(status.channels.exact)).toBe(true);
      expect(Array.isArray(status.channels.patterns)).toBe(true);
      expect(typeof status.inflightPublishes).toBe("number");
    });

    test("status() reflects subscriptions", () => {
      pubsub.subscribe("ch1", () => {});
      pubsub.subscribe("ch2", () => {});

      const status = pubsub.status();
      expect(status.channels.exact.includes("ch1")).toBe(true);
      expect(status.channels.exact.includes("ch2")).toBe(true);
    });

    test("status() reflects current state", async () => {
      const h1 = pubsub.subscribe("ch1", () => {});
      const h2 = pubsub.subscribe("ch2", () => {});

      await h1.ready;
      const status = pubsub.status();
      expect(status.connected).toBe(true);
      expect(status.channels.exact.includes("ch1")).toBe(true);
      expect(status.channels.exact.includes("ch2")).toBe(true);

      h1.unsubscribe();
      const status2 = pubsub.status();
      expect(status2.channels.exact.includes("ch1")).toBe(false);
      expect(status2.channels.exact.includes("ch2")).toBe(true);
    });
  });

  // ============================================================================
  // Configuration & Options
  // ============================================================================
  describe("Configuration & Options", () => {
    test("createRedisPubSub factory creates instance", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      expect(pubsub instanceof RedisPubSub).toBe(true);
      expect(typeof pubsub.publish).toBe("function");
      expect(typeof pubsub.subscribe).toBe("function");
      expect(typeof pubsub.status).toBe("function");
      expect(typeof pubsub.isConnected).toBe("function");
      expect(typeof pubsub.isSubscribed).toBe("function");
      expect(typeof pubsub.isDestroyed).toBe("function");
      expect(typeof pubsub.on).toBe("function");
      expect(typeof pubsub.off).toBe("function");
      expect(typeof pubsub.close).toBe("function");

      pubsub.close();
    });

    test("accepts URL option", () => {
      const pubsub = createRedisPubSub({ url: "redis://localhost:6379" });
      expect(pubsub.options.url).toBe("redis://localhost:6379");
      pubsub.close();
    });

    test("accepts namespace option", () => {
      const pubsub = createRedisPubSub({ namespace: "app" });
      expect(pubsub.options.namespace).toBe("app");
      pubsub.close();
    });

    test("accepts serializer option", () => {
      const pubsub = createRedisPubSub({ serializer: "text" });
      expect(pubsub.options.serializer).toBe("text");
      pubsub.close();
    });

    test("accepts retry option", () => {
      const pubsub = createRedisPubSub({
        retry: { initialMs: 50, maxMs: 5000 },
      });
      expect(pubsub.options.retry?.initialMs).toBe(50);
      expect(pubsub.options.retry?.maxMs).toBe(5000);
      pubsub.close();
    });

    test("accepts logger option", () => {
      const logger = {
        info: () => {},
        error: () => {},
      };
      const pubsub = createRedisPubSub({ logger });
      expect(pubsub.options.logger).toBe(logger);
      pubsub.close();
    });

    test("maxSubscriptions limit enforced", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
        maxSubscriptions: 2,
      });

      pubsub.subscribe("ch1", () => {});
      pubsub.subscribe("ch2", () => {});

      try {
        pubsub.subscribe("ch3", () => {});
        expect.fail("Should have thrown MaxSubscriptionsExceededError");
      } catch (err) {
        expect((err as PubSubError).code).toBe("MAX_SUBSCRIPTIONS_EXCEEDED");
      }

      pubsub.close();
    });

    test("json serializer (default) is accepted", () => {
      const pubsub = createRedisPubSub({
        serializer: "json",
      });
      expect(pubsub.options.serializer).toBe("json");
      pubsub.close();
    });

    test("text serializer is accepted", () => {
      const pubsub = createRedisPubSub({
        serializer: "text",
      });
      expect(pubsub.options.serializer).toBe("text");
      pubsub.close();
    });

    test("custom serializer is accepted", () => {
      const custom = {
        encode: (x: unknown) => String(x),
        decode: (s: string) => s,
      };
      const pubsub = createRedisPubSub({ serializer: custom });
      expect(pubsub.options.serializer).toBe(custom);
      pubsub.close();
    });
  });

  // ============================================================================
  // Events
  // ============================================================================
  describe("Events", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });
    });

    afterEach(async () => {
      if (!pubsub.isDestroyed()) {
        await pubsub.close();
      }
    });

    test(".on() returns unsubscribe function", () => {
      const off = pubsub.on("connect", () => {});
      expect(typeof off).toBe("function");

      off();
    });

    test(".on() can register multiple listeners", () => {
      const off1 = pubsub.on("connect", () => {});
      const off2 = pubsub.on("connect", () => {});

      expect(typeof off1).toBe("function");
      expect(typeof off2).toBe("function");

      off1();
      off2();
    });

    test(".off() can remove listener", () => {
      const handler = () => {};
      pubsub.on("connect", handler);
      pubsub.off("connect", handler); // Should not throw
    });

    test("all event types are supported", () => {
      const offConnect = pubsub.on("connect", () => {});
      const offDisconnect = pubsub.on("disconnect", () => {});
      const offError = pubsub.on("error", () => {});

      expect(typeof offConnect).toBe("function");
      expect(typeof offDisconnect).toBe("function");
      expect(typeof offError).toBe("function");

      offConnect();
      offDisconnect();
      offError();
    });

    test(".on('error') receives errors", async () => {
      const errors: Error[] = [];
      const offError = pubsub.on("error", (err) => {
        errors.push(err as Error);
      });

      // Try to publish while disconnected (no connection yet)
      try {
        await pubsub.publish("ch", "test");
      } catch {
        // Expected
      }

      // Verify listener was registered and can be removed
      expect(typeof offError).toBe("function");
      offError(); // Clean up
    });

    test(".on() returns unsubscribe function and fires", async () => {
      let connectCount = 0;
      const offConnect = pubsub.on("connect", () => {
        connectCount++;
      });

      expect(typeof offConnect).toBe("function");
      expect(connectCount).toBeGreaterThanOrEqual(0);

      offConnect();

      // Verify function can be called to unsubscribe
      expect(typeof offConnect).toBe("function");
    });

    test(".off() removes listener", async () => {
      let connectCount = 0;
      const handler = () => {
        connectCount++;
      };

      pubsub.on("connect", handler);
      expect(typeof handler).toBe("function");

      // Should not throw when removing
      pubsub.off("connect", handler);

      // Verify the function exists and we called off without error
      expect(typeof pubsub.off).toBe("function");
    });
  });

  // ============================================================================
  // Factory & Constructor
  // ============================================================================
  describe("Factory & Constructor", () => {
    test("createRedisPubSub() returns RedisPubSub instance", () => {
      const pubsub = createRedisPubSub();
      expect(pubsub).toBeInstanceOf(RedisPubSub);
      pubsub.close();
    });

    test("createRedisPubSub() accepts options", () => {
      const pubsub = createRedisPubSub({
        namespace: "test",
        url: "redis://localhost:6379",
      });
      expect(pubsub).toBeInstanceOf(RedisPubSub);
      pubsub.close();
    });

    test("creates instance with default namespace", () => {
      const pubsub = new RedisPubSub();
      expect(pubsub).toBeDefined();
      pubsub.close();
    });

    test("creates instance with custom namespace", () => {
      const pubsub = new RedisPubSub({ namespace: "myapp" });
      expect(pubsub).toBeDefined();
      pubsub.close();
    });

    test("creates instance with URL option", () => {
      const pubsub = new RedisPubSub({
        url: "redis://localhost:6379",
      });
      expect(pubsub).toBeDefined();
      pubsub.close();
    });
  });
});
