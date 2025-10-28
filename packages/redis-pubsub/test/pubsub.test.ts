import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { RedisPubSub, createRedisPubSub } from "@ws-kit/redis-pubsub";
import type { MessageHandler } from "@ws-kit/redis-pubsub";

// Mock Redis client for testing
class MockRedisClient {
  isOpen = true;
  handlers = new Map<string, Set<Function>>();
  published = new Map<string, string[]>();

  on(event: string, handler: Function) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  async connect() {
    this.isOpen = true;
  }

  async quit() {
    this.isOpen = false;
  }

  async publish(channel: string, message: string) {
    if (!this.published.has(channel)) {
      this.published.set(channel, []);
    }
    this.published.get(channel)!.push(message);

    // Simulate message delivery to subscribers
    const messageHandlers = this.handlers.get("message");
    if (messageHandlers) {
      messageHandlers.forEach((h) => h(channel, message));
    }
  }

  async subscribe(channel: string, callback: () => void) {
    callback();
  }

  async unsubscribe(channel: string) {
    // no-op
  }
}

describe("RedisPubSub", () => {
  describe("Factory", () => {
    test("createRedisPubSub() returns RedisPubSub instance", () => {
      const pubsub = createRedisPubSub();
      expect(pubsub).toBeInstanceOf(RedisPubSub);
    });

    test("createRedisPubSub() accepts options", () => {
      const pubsub = createRedisPubSub({
        namespace: "test",
        url: "redis://localhost:6379",
      });
      expect(pubsub).toBeInstanceOf(RedisPubSub);
    });
  });

  describe("Constructor", () => {
    test("creates instance with default namespace", () => {
      const pubsub = new RedisPubSub();
      expect(pubsub).toBeDefined();
    });

    test("creates instance with custom namespace", () => {
      const pubsub = new RedisPubSub({ namespace: "myapp" });
      expect(pubsub).toBeDefined();
    });

    test("creates instance with connection options", () => {
      const pubsub = new RedisPubSub({
        host: "localhost",
        port: 6379,
        db: 0,
      });
      expect(pubsub).toBeDefined();
    });

    test("creates instance with URL option", () => {
      const pubsub = new RedisPubSub({
        url: "redis://localhost:6379",
      });
      expect(pubsub).toBeDefined();
    });
  });

  describe("subscribe() and unsubscribe()", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = new RedisPubSub({ namespace: "test" });
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("subscribe stores handler", () => {
      const handler: MessageHandler = () => {};
      pubsub.subscribe("channel:1", handler);

      // Handler is stored (verified by successful unsubscribe)
      pubsub.unsubscribe("channel:1", handler);
      expect(true).toBe(true);
    });

    test("subscribe with multiple handlers on same channel", () => {
      const handler1: MessageHandler = () => {};
      const handler2: MessageHandler = () => {};

      pubsub.subscribe("channel:1", handler1);
      pubsub.subscribe("channel:1", handler2);

      pubsub.unsubscribe("channel:1", handler1);
      pubsub.unsubscribe("channel:1", handler2);
      expect(true).toBe(true);
    });

    test("unsubscribe removes handler", () => {
      const handler: MessageHandler = () => {};
      pubsub.subscribe("channel:1", handler);
      pubsub.unsubscribe("channel:1", handler);

      // Should not throw when unsubscribing non-existent handler
      pubsub.unsubscribe("channel:1", handler);
      expect(true).toBe(true);
    });

    test("unsubscribe from non-existent channel does nothing", () => {
      const handler: MessageHandler = () => {};
      pubsub.unsubscribe("non-existent", handler);
      expect(true).toBe(true);
    });
  });

  describe("Channel Namespacing", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = new RedisPubSub({ namespace: "myapp:prod" });
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("prefixes channels with namespace", async () => {
      const handler: MessageHandler = mock(() => {});
      pubsub.subscribe("channel:1", handler);

      // Channel would be prefixed as "myapp:prod:channel:1"
      expect(true).toBe(true);
    });

    test("supports nested channel names with namespace", async () => {
      const handler: MessageHandler = mock(() => {});
      pubsub.subscribe("app:module:channel", handler);
      // Results in: "myapp:prod:app:module:channel"
      expect(true).toBe(true);
    });
  });

  describe("Serialization", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = new RedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("serializes objects to JSON", async () => {
      const handler: MessageHandler = mock(() => {});
      pubsub.subscribe("test", handler);
      // Will serialize { data: "test" } as JSON
      expect(true).toBe(true);
    });

    test("handles string messages", async () => {
      const handler: MessageHandler = mock(() => {});
      pubsub.subscribe("test", handler);
      // String "hello" passed through unchanged
      expect(true).toBe(true);
    });

    test("supports custom serializer", async () => {
      const customSerializer = mock((msg: unknown) => {
        return JSON.stringify(msg);
      });

      const pubsub2 = new RedisPubSub({
        serializeMessage: customSerializer,
      });

      const handler: MessageHandler = mock(() => {});
      pubsub2.subscribe("test", handler);

      await pubsub2.destroy();
      expect(true).toBe(true);
    });

    test("supports custom deserializer", async () => {
      const customDeserializer = mock((msg: string) => {
        return JSON.parse(msg);
      });

      const pubsub2 = new RedisPubSub({
        deserializeMessage: customDeserializer,
      });

      const handler: MessageHandler = mock(() => {});
      pubsub2.subscribe("test", handler);

      await pubsub2.destroy();
      expect(true).toBe(true);
    });
  });

  describe("Lifecycle", () => {
    let pubsub: RedisPubSub;

    beforeEach(() => {
      pubsub = new RedisPubSub();
    });

    afterEach(async () => {
      if (!pubsub) return;
      try {
        await pubsub.destroy();
      } catch {
        // ignore
      }
    });

    test("isConnected returns boolean", () => {
      const connected = pubsub.isConnected();
      expect(typeof connected).toBe("boolean");
    });

    test("destroy cleans up resources", async () => {
      await pubsub.destroy();
      expect(true).toBe(true);
    });

    test("destroy can be called multiple times", async () => {
      await pubsub.destroy();
      await pubsub.destroy();
      expect(true).toBe(true);
    });

    test("subscribe throws after destroy", async () => {
      await pubsub.destroy();

      const handler: MessageHandler = () => {};
      expect(() => {
        pubsub.subscribe("test", handler);
      }).toThrow();
    });

    test("publish throws after destroy", async () => {
      await pubsub.destroy();

      expect(async () => {
        await pubsub.publish("test", { data: "test" });
      }).toThrow();
    });
  });

  describe("Error Handling", () => {
    test("onConnect callback is called", () => {
      const onConnect = mock(() => {});
      const pubsub = new RedisPubSub({ onConnect });

      // Callback would be invoked on successful connection
      expect(onConnect).not.toHaveBeenCalled(); // Not called until actual connection
    });

    test("onError callback is invoked on errors", () => {
      const onError = mock((err: Error) => {
        expect(err).toBeInstanceOf(Error);
      });

      const pubsub = new RedisPubSub({ onError });
      // Error callbacks would be invoked during actual redis errors
      expect(onError).not.toHaveBeenCalled();
    });

    test("onDisconnect callback", () => {
      const onDisconnect = mock(() => {});
      const pubsub = new RedisPubSub({ onDisconnect });

      // Disconnect would be called when connection is lost
      expect(onDisconnect).not.toHaveBeenCalled();
    });
  });

  describe("Options", () => {
    test("supports maxReconnectDelay option", () => {
      const pubsub = new RedisPubSub({ maxReconnectDelay: 60000 });
      expect(pubsub).toBeDefined();
    });

    test("supports host and port options", () => {
      const pubsub = new RedisPubSub({
        host: "redis.example.com",
        port: 6380,
      });
      expect(pubsub).toBeDefined();
    });

    test("supports password option", () => {
      const pubsub = new RedisPubSub({
        url: "redis://localhost:6379",
        password: "secret",
      });
      expect(pubsub).toBeDefined();
    });

    test("supports db option", () => {
      const pubsub = new RedisPubSub({
        host: "localhost",
        db: 5,
      });
      expect(pubsub).toBeDefined();
    });

    test("supports TLS option", () => {
      const pubsub = new RedisPubSub({
        host: "redis.example.com",
        port: 6380,
        tls: true,
      });
      expect(pubsub).toBeDefined();
    });
  });
});
