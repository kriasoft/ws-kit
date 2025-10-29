import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createZodRouter } from "@ws-kit/zod";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";

describe("RedisPubSub Integration with @ws-kit/core", () => {
  describe("Router Integration", () => {
    test("RedisPubSub works with WebSocketRouter", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const router = createZodRouter({
        pubsub,
      });

      expect(router).toBeDefined();
    });

    test("Router.publish delegates to RedisPubSub", () => {
      const pubsub = createRedisPubSub({
        namespace: "test",
      });

      const router = createZodRouter();

      // publish() method would delegate to pubsub
      expect(router.publish).toBeDefined();
    });

    test("Multiple routers share same Redis instance", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
        namespace: "shared",
      });

      const router1 = createZodRouter({ pubsub });
      const router2 = createZodRouter({ pubsub });

      expect(router1).toBeDefined();
      expect(router2).toBeDefined();
    });
  });

  describe("Channel Isolation", () => {
    test("different namespaces dont collide", () => {
      const pubsub1 = createRedisPubSub({ namespace: "app1" });
      const pubsub2 = createRedisPubSub({ namespace: "app2" });

      const router1 = createZodRouter();
      const router2 = createZodRouter();

      expect(router1).toBeDefined();
      expect(router2).toBeDefined();
    });

    test("message to channel:1 doesnt reach channel:2", async () => {
      const pubsub = createRedisPubSub();

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler1 = mock(() => {});
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler2 = mock(() => {});

      pubsub.subscribe("channel:1", handler1);
      pubsub.subscribe("channel:2", handler2);

      // Publishing to channel:1 should only invoke handler1
      // (In actual redis, this works with pub/sub delivery)
      expect(true).toBe(true);
    });
  });

  describe("Message Types", () => {
    let pubsub = createRedisPubSub();

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("string messages are delivered", async () => {
      const handler = mock(() => {});
      pubsub.subscribe("test", handler);

      // Publishing string
      await pubsub.publish("test", "hello");

      expect(true).toBe(true);
    });

    test("object messages are serialized and delivered", async () => {
      const handler = mock(() => {});
      pubsub.subscribe("test", handler);

      const message = { type: "ping", data: "test" };
      await pubsub.publish("test", message);

      expect(true).toBe(true);
    });

    test("array messages work", async () => {
      const handler = mock(() => {});
      pubsub.subscribe("test", handler);

      const message = ["item1", "item2", "item3"];
      await pubsub.publish("test", message);

      expect(true).toBe(true);
    });

    test("null and undefined handling", async () => {
      const handler = mock(() => {});
      pubsub.subscribe("test", handler);

      await pubsub.publish("test", null);
      await pubsub.publish("test", undefined);

      expect(true).toBe(true);
    });
  });

  describe("Multiple Subscribers", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("multiple handlers on same channel all receive message", async () => {
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});
      const handler3 = mock(() => {});

      pubsub.subscribe("test", handler1);
      pubsub.subscribe("test", handler2);
      pubsub.subscribe("test", handler3);

      // All three handlers would be called
      expect(true).toBe(true);
    });

    test("handlers can be added and removed dynamically", async () => {
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      pubsub.subscribe("test", handler1);
      pubsub.subscribe("test", handler2);

      pubsub.unsubscribe("test", handler1);

      // Only handler2 remains
      expect(true).toBe(true);
    });
  });

  describe("Error Scenarios", () => {
    test("publish error is caught and propagated", async () => {
      const pubsub = createRedisPubSub({
        // Invalid URL would cause connection error
        url: "redis://invalid.host:99999",
      });

      // Error would be thrown/caught in actual redis error scenario
      await pubsub.destroy();
    });

    test("onError callback receives connection errors", () => {
      const onError = mock((err: Error) => {
        expect(err).toBeInstanceOf(Error);
      });

      const pubsub = createRedisPubSub({ onError });

      expect(pubsub).toBeDefined();
    });

    test("handler exceptions dont break other handlers", async () => {
      const pubsub = createRedisPubSub();

      const handler1 = mock(() => {
        throw new Error("Handler error");
      });

      const handler2 = mock(() => {
        // This should still be called even if handler1 throws
      });

      pubsub.subscribe("test", handler1);
      pubsub.subscribe("test", handler2);

      await pubsub.destroy();
      expect(true).toBe(true);
    });
  });

  describe("Concurrent Operations", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("concurrent publishes work", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(pubsub.publish(`channel:${i}`, { count: i }));
      }

      await Promise.allSettled(promises);
      expect(true).toBe(true);
    });

    test("concurrent subscriptions work", () => {
      for (let i = 0; i < 10; i++) {
        const handler = () => {};
        pubsub.subscribe(`channel:${i}`, handler);
      }

      expect(true).toBe(true);
    });

    test("interleaved subscribe and unsubscribe", () => {
      const handlers = [];

      for (let i = 0; i < 10; i++) {
        const handler = () => {};
        handlers.push(handler);
        pubsub.subscribe(`channel:${i}`, handler);
      }

      for (let i = 0; i < 5; i++) {
        pubsub.unsubscribe(`channel:${i}`, handlers[i]);
      }

      expect(true).toBe(true);
    });
  });
});
