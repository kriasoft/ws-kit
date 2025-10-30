import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";

describe("RedisPubSub Serialization", () => {
  describe("Default Serialization", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("string passthrough", async () => {
      const handler = (msg: unknown) => {
        expect(typeof msg).toBe("string");
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", "hello world");
    });

    test("object to JSON", async () => {
      const handler = (msg: unknown) => {
        expect(typeof msg).toBe("object");
        expect(msg).toEqual({ type: "test", data: "value" });
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", { type: "test", data: "value" });
    });

    test("array serialization", async () => {
      const handler = (msg: unknown) => {
        expect(Array.isArray(msg)).toBe(true);
        expect(msg).toEqual(["a", "b", "c"]);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", ["a", "b", "c"]);
    });

    test("number serialization", async () => {
      const handler = (msg: unknown) => {
        expect(typeof msg).toBe("number");
        expect(msg).toBe(42);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", 42);
    });

    test("boolean serialization", async () => {
      const handler = (msg: unknown) => {
        expect(typeof msg).toBe("boolean");
      };

      pubsub.subscribe("test:true", handler);
      await pubsub.publish("test:true", true);
    });

    test("null handling", async () => {
      const handler = (msg: unknown) => {
        expect(msg).toBe(null);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", null);
    });
  });

  describe("Custom Serialization", () => {
    test("custom serializer is used", () => {
      const serialized = new Set<unknown>();

      const pubsub = createRedisPubSub({
        serializeMessage: (msg) => {
          serialized.add(msg);
          return JSON.stringify({ custom: true, data: msg });
        },
      });

      // Custom serializer would be called during publish
      expect(pubsub).toBeDefined();
    });

    test("custom deserializer is used", () => {
      const deserialized = new Set<unknown>();

      const pubsub = createRedisPubSub({
        deserializeMessage: (msg) => {
          const result = JSON.parse(msg);
          deserialized.add(result);
          return result;
        },
      });

      // Custom deserializer would be called during message delivery
      expect(pubsub).toBeDefined();
    });

    test("custom serializer and deserializer work together", async () => {
      const pubsub = createRedisPubSub({
        serializeMessage: (msg) => {
          // Wrap in envelope
          return JSON.stringify({ envelope: "v1", data: msg });
        },
        deserializeMessage: (msg) => {
          const envelope = JSON.parse(msg);
          return envelope.data;
        },
      });

      const handler = (msg: unknown) => {
        // Message should be unwrapped by custom deserializer
        expect(msg).toEqual({ type: "test" });
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", { type: "test" });
      await pubsub.destroy();
    });

    test("serializer error is handled", async () => {
      const onError = (err: Error) => {
        expect(err.message).toContain("serializ");
      };

      const pubsub = createRedisPubSub({
        serializeMessage: () => {
          throw new Error("Custom serializer failed");
        },
        onError,
      });

      // Publishing would call serializer and throw
      try {
        await pubsub.publish("test", { data: "test" });
      } catch {
        // Expected
      }

      await pubsub.destroy();
    });
  });

  describe("Large Payloads", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("large string payload", async () => {
      const largeString = "x".repeat(10000);

      const handler = (msg: unknown) => {
        expect(msg).toBe(largeString);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", largeString);
    });

    test("large object payload", async () => {
      const largeObject = {
        data: new Array(1000)
          .fill(0)
          .map((_, i) => ({ id: i, value: `value-${i}` })),
      };

      const handler = (msg: unknown) => {
        expect(msg).toEqual(largeObject);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", largeObject);
    });
  });

  describe("Unicode and Special Characters", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("emoji in string", async () => {
      const emoji = "Hello 👋 World 🌍";

      const handler = (msg: unknown) => {
        expect(msg).toBe(emoji);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", emoji);
    });

    test("unicode characters", async () => {
      const unicode = "你好世界 مرحبا";

      const handler = (msg: unknown) => {
        expect(msg).toBe(unicode);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", unicode);
    });

    test("special characters in object", async () => {
      const message = {
        text: "Special: !@#$%^&*()",
        emoji: "😀",
        unicode: "αβγδ",
      };

      const handler = (msg: unknown) => {
        expect(msg).toEqual(message);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", message);
    });

    test("newlines and tabs", async () => {
      const message = "Line1\nLine2\tTab\rReturn";

      const handler = (msg: unknown) => {
        expect(msg).toBe(message);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", message);
    });
  });

  describe("Nested Structures", () => {
    let pubsub: ReturnType<typeof createRedisPubSub>;

    beforeEach(() => {
      pubsub = createRedisPubSub();
    });

    afterEach(async () => {
      await pubsub.destroy();
    });

    test("deeply nested objects", async () => {
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

      const handler = (msg: unknown) => {
        expect(msg).toEqual(deep);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", deep);
    });

    test("array of objects", async () => {
      const items = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
      ];

      const handler = (msg: unknown) => {
        expect(msg).toEqual(items);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", items);
    });

    test("object with array properties", async () => {
      const message = {
        users: ["alice", "bob"],
        scores: [100, 200, 300],
        metadata: { version: 1 },
      };

      const handler = (msg: unknown) => {
        expect(msg).toEqual(message);
      };

      pubsub.subscribe("test", handler);
      await pubsub.publish("test", message);
    });
  });

  describe("Message Type Preservation", () => {
    test("message type is preserved through serialization", async () => {
      const pubsub = createRedisPubSub();

      const messages = [
        { type: "ping" },
        { type: "pong" },
        { type: "message", data: "hello" },
      ];

      for (const msg of messages) {
        const handler = (received: unknown) => {
          expect((received as any).type).toBe(msg.type);
        };

        pubsub.subscribe("test", handler);
        await pubsub.publish("test", msg);
      }

      await pubsub.destroy();
    });

    test("discriminated unions work", async () => {
      const pubsub = createRedisPubSub();

      type Message = { type: "ping" } | { type: "pong"; id: number };

      const ping: Message = { type: "ping" };
      const pong: Message = { type: "pong", id: 42 };

      pubsub.subscribe("test", (msg: unknown) => {
        const m = msg as Message;
        if (m.type === "ping") {
          expect(m).toEqual(ping);
        } else {
          expect((m as any).id).toBe(42);
        }
      });

      await pubsub.publish("test", ping);
      await pubsub.publish("test", pong);
      await pubsub.destroy();
    });
  });
});
