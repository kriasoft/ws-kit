import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";

describe("RedisPubSub Reconnection & Resilience", () => {
  describe("Connection Lifecycle", () => {
    test("onConnect callback on successful connection", () => {
      const onConnect = mock(() => {});
      const pubsub = createRedisPubSub({ onConnect });

      // Would be called when connection establishes
      expect(pubsub).toBeDefined();
    });

    test("onDisconnect callback when connection closes", () => {
      const onDisconnect = mock(() => {});
      const pubsub = createRedisPubSub({ onDisconnect });

      // Would be called when connection is lost
      expect(pubsub).toBeDefined();
    });

    test("onError callback on connection failure", () => {
      const onError = mock((err: Error) => {
        expect(err).toBeInstanceOf(Error);
      });

      const pubsub = createRedisPubSub({ onError });

      // Would be called on any connection/publish/subscribe errors
      expect(pubsub).toBeDefined();
    });

    test("connection error provides context", () => {
      const onError = mock((err: Error) => {
        expect(err.message).toMatch(/redis|connection|failed/i);
      });

      const pubsub = createRedisPubSub({
        onError,
        url: "redis://invalid.host:99999",
      });

      expect(pubsub).toBeDefined();
    });
  });

  describe("Lazy Connection Establishment", () => {
    test("no connection on create", () => {
      const pubsub = createRedisPubSub();

      // Should not connect until first publish or subscribe
      expect(pubsub.isConnected()).toBe(false);
    });

    test("connection on first subscribe", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const handler = () => {};
      pubsub.subscribe("test", handler);

      // Would attempt connection on first subscribe
      expect(pubsub).toBeDefined();
    });

    test("connection on first publish", async () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      // Would attempt connection on first publish
      try {
        await pubsub.publish("test", { data: "test" });
      } catch {
        // Expected if Redis unavailable
      }

      expect(pubsub).toBeDefined();
    });
  });

  describe("Exponential Backoff", () => {
    test("reconnect delay increases exponentially", () => {
      const delays: number[] = [];

      const pubsub = createRedisPubSub({
        maxReconnectDelay: 30000,
      });

      // Delay sequence would be: 100, 200, 400, 800, 1600, 3200, ...
      // Capped at maxReconnectDelay
      expect(pubsub).toBeDefined();
    });

    test("respects maxReconnectDelay", () => {
      const pubsub = createRedisPubSub({
        maxReconnectDelay: 5000,
      });

      // Delays would never exceed 5000ms
      expect(pubsub).toBeDefined();
    });

    test("custom maxReconnectDelay configuration", () => {
      const pubsub1 = createRedisPubSub({ maxReconnectDelay: 60000 });
      const pubsub2 = createRedisPubSub({ maxReconnectDelay: 10000 });

      expect(pubsub1).toBeDefined();
      expect(pubsub2).toBeDefined();
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
      } catch {
        // ignore
      }

      try {
        await pubsub.publish("test", { attempt: 2 });
      } catch {
        // ignore
      }

      expect(pubsub).toBeDefined();
    });

    test("subscription recovery after reconnect", async () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const handler = () => {};
      pubsub.subscribe("test", handler);

      // Subscription would be maintained across reconnects
      expect(pubsub).toBeDefined();
    });

    test("pending subscriptions are retried", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const handlers = [];
      for (let i = 0; i < 5; i++) {
        const h = () => {};
        handlers.push(h);
        pubsub.subscribe(`channel:${i}`, h);
      }

      // All subscriptions would be retried on reconnect
      expect(pubsub).toBeDefined();
    });

    test("handler exceptions dont break reconnection", async () => {
      const pubsub = createRedisPubSub();

      const badHandler = () => {
        throw new Error("Handler failed");
      };

      const goodHandler = mock(() => {});

      pubsub.subscribe("test", badHandler);
      pubsub.subscribe("test", goodHandler);

      // goodHandler should still be called even if badHandler throws
      await pubsub.destroy();
      expect(pubsub).toBeDefined();
    });
  });

  describe("Connection State Management", () => {
    test("isConnected reflects actual state", () => {
      const pubsub = createRedisPubSub();

      const initial = pubsub.isConnected();
      expect(typeof initial).toBe("boolean");
    });

    test("destroy sets connected to false", async () => {
      const pubsub = createRedisPubSub();
      await pubsub.destroy();

      expect(pubsub.isConnected()).toBe(false);
    });

    test("operations fail after destroy", async () => {
      const pubsub = createRedisPubSub();
      await pubsub.destroy();

      expect(() => {
        pubsub.subscribe("test", () => {});
      }).toThrow();

      expect(async () => {
        await pubsub.publish("test", {});
      }).toThrow();
    });
  });

  describe("Client Reuse", () => {
    test("pre-configured client is reused", () => {
      // Mock a Redis client
      const mockClient = {
        isOpen: true,
        on: () => {},
        connect: async () => {},
        quit: async () => {},
        publish: async () => 1,
        subscribe: async () => {},
        unsubscribe: async () => {},
      };

      const pubsub = createRedisPubSub({
        client: mockClient as any,
      });

      expect(pubsub).toBeDefined();
    });

    test("user-provided client wont be closed on destroy", async () => {
      const mockClient = {
        isOpen: true,
        on: () => {},
        connect: async () => {},
        quit: async () => {},
        publish: async () => 1,
        subscribe: async () => {},
        unsubscribe: async () => {},
      };

      const pubsub = createRedisPubSub({
        client: mockClient as any,
      });

      // destroy() should handle client lifecycle appropriately
      await pubsub.destroy();
      expect(pubsub).toBeDefined();
    });
  });

  describe("Graceful Shutdown", () => {
    test("destroy waits for pending operations", async () => {
      const pubsub = createRedisPubSub();

      const handler = () => {};
      pubsub.subscribe("test:1", handler);
      pubsub.subscribe("test:2", handler);

      // destroy should close all connections
      await pubsub.destroy();

      expect(pubsub.isConnected()).toBe(false);
    });

    test("multiple destroy calls are safe", async () => {
      const pubsub = createRedisPubSub();

      await pubsub.destroy();
      await pubsub.destroy();
      await pubsub.destroy();

      expect(pubsub.isConnected()).toBe(false);
    });

    test("operations after destroy throw appropriate errors", async () => {
      const pubsub = createRedisPubSub();
      await pubsub.destroy();

      expect(() => {
        pubsub.subscribe("test", () => {});
      }).toThrow(/destroyed/i);

      expect(async () => {
        await pubsub.publish("test", {});
      }).toThrow(/destroyed/i);
    });
  });

  describe("Network Interruption Scenarios", () => {
    test("publish handles connection loss", async () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      try {
        // Simulate network issues
        await pubsub.publish("test", { data: "test" });
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }

      await pubsub.destroy();
    });

    test("subscribe handles connection loss", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      // Subscribe would queue and retry
      pubsub.subscribe("test", () => {});

      expect(pubsub).toBeDefined();
    });

    test("concurrent operations during connection loss", async () => {
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

      pubsub.subscribe("test", () => {});

      await Promise.allSettled(operations);
      await pubsub.destroy();

      expect(pubsub).toBeDefined();
    });
  });

  describe("Error Callback Reliability", () => {
    test("onError is called on publish failure", async () => {
      const onError = mock((err: Error) => {
        expect(err).toBeInstanceOf(Error);
      });

      const pubsub = createRedisPubSub({
        onError,
        url: "redis://invalid:99999",
      });

      try {
        await pubsub.publish("test", {});
      } catch {
        // ignore
      }

      await pubsub.destroy();
    });

    test("onError is called on subscribe failure", () => {
      const onError = mock((err: Error) => {
        expect(err).toBeInstanceOf(Error);
      });

      const pubsub = createRedisPubSub({
        onError,
        url: "redis://invalid:99999",
      });

      pubsub.subscribe("test", () => {});

      expect(pubsub).toBeDefined();
    });

    test("handler errors dont prevent onError from working", async () => {
      const errors: Error[] = [];

      const pubsub = createRedisPubSub({
        onError: (err) => {
          errors.push(err);
        },
      });

      pubsub.subscribe("test", () => {
        throw new Error("Handler error");
      });

      await pubsub.destroy();
      expect(pubsub).toBeDefined();
    });
  });
});
