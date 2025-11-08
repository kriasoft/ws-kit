import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import type { RedisPubSub } from "@ws-kit/redis-pubsub";
import {
  PubSubError,
  DisconnectedError,
  SerializationError,
  MaxSubscriptionsExceededError,
} from "@ws-kit/redis-pubsub";

describe("RedisPubSub Unit Tests (No Redis Required)", () => {
  describe("API Surface & Types", () => {
    test("createRedisPubSub factory creates instance", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      expect(pubsub).toBeDefined();
      expect(typeof pubsub.publish).toBe("function");
      expect(typeof pubsub.subscribe).toBe("function");
      expect(typeof pubsub.once).toBe("function");
      expect(typeof pubsub.status).toBe("function");
      expect(typeof pubsub.isConnected).toBe("function");
      expect(typeof pubsub.isSubscribed).toBe("function");
      expect(typeof pubsub.isDestroyed).toBe("function");
      expect(typeof pubsub.on).toBe("function");
      expect(typeof pubsub.off).toBe("function");
      expect(typeof pubsub.close).toBe("function");
    });
  });

  describe("Configuration & Options", () => {
    test("accepts URL option", () => {
      const pubsub = createRedisPubSub({ url: "redis://localhost:6379" });
      expect(pubsub.options.url).toBe("redis://localhost:6379");
    });

    test("accepts namespace option", () => {
      const pubsub = createRedisPubSub({ namespace: "app" });
      expect(pubsub.options.namespace).toBe("app");
    });

    test("accepts serializer option", () => {
      const pubsub = createRedisPubSub({ serializer: "text" });
      expect(pubsub.options.serializer).toBe("text");
    });

    test("accepts retry option", () => {
      const pubsub = createRedisPubSub({
        retry: { initialMs: 50, maxMs: 5000 },
      });
      expect(pubsub.options.retry?.initialMs).toBe(50);
      expect(pubsub.options.retry?.maxMs).toBe(5000);
    });

    test("accepts logger option", () => {
      const logger = {
        info: () => {},
        error: () => {},
      };
      const pubsub = createRedisPubSub({ logger });
      expect(pubsub.options.logger).toBe(logger);
    });
  });

  describe("Constructor Validation", () => {
    test("rejects unknown options", () => {
      expect(() => {
        createRedisPubSub({
          url: "redis://localhost:6379",
          unknownOption: "value",
        } as any);
      }).toThrow(TypeError);
    });

    test("rejects legacy maxReconnectDelay option", () => {
      expect(() => {
        createRedisPubSub({
          maxReconnectDelay: 60000,
        } as any);
      }).toThrow(TypeError);
    });

    test("rejects legacy host/port options", () => {
      expect(() => {
        createRedisPubSub({
          host: "redis.example.com",
          port: 6380,
        } as any);
      }).toThrow(TypeError);
    });

    test("rejects legacy password option", () => {
      expect(() => {
        createRedisPubSub({
          url: "redis://localhost:6379",
          password: "secret",
        } as any);
      }).toThrow(TypeError);
    });

    test("rejects legacy db option", () => {
      expect(() => {
        createRedisPubSub({
          host: "localhost",
          db: 5,
        } as any);
      }).toThrow(TypeError);
    });

    test("rejects legacy tls option", () => {
      expect(() => {
        createRedisPubSub({
          host: "redis.example.com",
          tls: true,
        } as any);
      }).toThrow(TypeError);
    });

    test("rejects mutually exclusive url and client", () => {
      expect(() => {
        createRedisPubSub({
          url: "redis://localhost:6379",
          client: {} as any,
        });
      }).toThrow(TypeError);
    });
  });

  describe("Namespace Guard", () => {
    test("accepts colon-suffixed namespace", () => {
      // Phase 1 change: namespace normalization
      const pubsub = createRedisPubSub({ namespace: "app:" });
      const sub = pubsub.subscribe("channel", () => {});
      expect(sub).toBeDefined();
      sub.unsubscribe();
      pubsub.close();
    });

    test("accepts correct namespace usage", () => {
      const pubsub = createRedisPubSub({ namespace: "app" });

      const sub = pubsub.subscribe("channel", () => {});
      expect(sub).toBeDefined();
      sub.unsubscribe();

      pubsub.close();
    });

    test("no namespace default (empty string)", () => {
      const pubsub = createRedisPubSub();
      const sub = pubsub.subscribe("channel", () => {});
      expect(sub).toBeDefined();
      sub.unsubscribe();

      pubsub.close();
    });
  });

  describe("Subscription Management", () => {
    test("subscribe returns Subscription object", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const sub = pubsub.subscribe("test", () => {});
      expect(sub).toBeDefined();
      expect(sub.channel).toBe("test");
      expect(sub.ready).toBeInstanceOf(Promise);

      sub.unsubscribe();
      pubsub.close();
    });

    test("isSubscribed reflects state", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      expect(pubsub.isSubscribed("test")).toBe(false);

      const sub = pubsub.subscribe("test", () => {});
      expect(pubsub.isSubscribed("test")).toBe(true);

      sub.unsubscribe();
      expect(pubsub.isSubscribed("test")).toBe(false);

      pubsub.close();
    });

    test("maxSubscriptions limit enforced", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
        maxSubscriptions: 2,
      });

      pubsub.subscribe("ch1", () => {});
      pubsub.subscribe("ch2", () => {});

      expect(() => {
        pubsub.subscribe("ch3", () => {});
      }).toThrow(MaxSubscriptionsExceededError);

      pubsub.close();
    });

    test("psubscribe returns Subscription object", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const sub = pubsub.psubscribe("user:*:messages", () => {});
      expect(sub).toBeDefined();
      expect(sub.channel).toBe("user:*:messages");

      sub.unsubscribe();
      pubsub.close();
    });
  });

  describe("State Management", () => {
    test("isDestroyed reflects state", async () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      expect(pubsub.isDestroyed()).toBe(false);

      await pubsub.close();
      expect(pubsub.isDestroyed()).toBe(true);
    });

    test("destroy is idempotent", async () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      await pubsub.close();
      await pubsub.close(); // Should not throw

      expect(pubsub.isDestroyed()).toBe(true);
    });

    test("destroy throws on subscribe", async () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      await pubsub.close();

      expect(() => {
        pubsub.subscribe("ch", () => {});
      }).toThrow(DisconnectedError);
    });
  });

  describe("Events", () => {
    test(".on() returns unsubscribe function", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const off = pubsub.on("connect", () => {});
      expect(typeof off).toBe("function");

      off();
      pubsub.close();
    });

    test(".on() can register multiple listeners", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const off1 = pubsub.on("connect", () => {});
      const off2 = pubsub.on("connect", () => {});

      expect(typeof off1).toBe("function");
      expect(typeof off2).toBe("function");

      off1();
      off2();
      pubsub.close();
    });

    test(".off() can remove listener", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const handler = () => {};
      pubsub.on("connect", handler);
      pubsub.off("connect", handler); // Should not throw

      pubsub.close();
    });
  });

  describe("Error Types", () => {
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

    test("all errors extend PubSubError", () => {
      const disconnected = new DisconnectedError("Test");
      const serialized = new SerializationError("Test");

      expect(disconnected instanceof PubSubError).toBe(true);
      expect(serialized instanceof PubSubError).toBe(true);
    });
  });

  describe("Status", () => {
    test("status() returns correct structure", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const status = pubsub.status();
      expect(typeof status.connected).toBe("boolean");
      expect(typeof status.channels).toBe("object");
      expect(Array.isArray(status.channels.exact)).toBe(true);
      expect(Array.isArray(status.channels.patterns)).toBe(true);
      expect(typeof status.inflightPublishes).toBe("number");

      pubsub.close();
    });

    test("status() reflects subscriptions", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      pubsub.subscribe("ch1", () => {});
      pubsub.subscribe("ch2", () => {});

      const status = pubsub.status();
      expect(status.channels.exact.includes("ch1")).toBe(true);
      expect(status.channels.exact.includes("ch2")).toBe(true);

      pubsub.close();
    });
  });

  describe("Serialization Options", () => {
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

  describe("Constructor Validation", () => {
    test("namespace with trailing colon is accepted", () => {
      // Namespace with trailing colon is stored as-is
      const pubsub = createRedisPubSub({ namespace: "app:" });
      expect(pubsub.options.namespace).toBe("app:");
      pubsub.close();
    });

    test("empty namespace is valid", () => {
      const pubsub = createRedisPubSub({ namespace: "" });
      expect(pubsub.options.namespace).toBe("");
      pubsub.close();
    });
  });

  describe("API Contracts", () => {
    test("all event types are supported", () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      const offConnect = pubsub.on("connect", () => {});
      const offDisconnect = pubsub.on("disconnect", () => {});
      const offError = pubsub.on("error", () => {});

      expect(typeof offConnect).toBe("function");
      expect(typeof offDisconnect).toBe("function");
      expect(typeof offError).toBe("function");

      offConnect();
      offDisconnect();
      offError();

      pubsub.close();
    });

    test("ponce() waits for first pattern match", async () => {
      const pubsub = createRedisPubSub({
        url: "redis://localhost:6379",
      });

      // Just verify the method accepts the options
      // (actual wait would require Redis)
      const timeoutPromise = pubsub.ponce("test:*", {
        timeoutMs: 10,
      });

      try {
        await timeoutPromise;
      } catch {
        // Expected to timeout
      }

      await pubsub.close();
    });
  });
});
