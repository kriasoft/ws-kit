// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PubSubAdapter, PublishEnvelope } from "@ws-kit/core/pubsub";
import { describe, expect, it, mock } from "bun:test";
import { redisPubSub } from "./pubsub.js";

/**
 * Creates a mock Redis client with configurable behavior.
 */
function createMockRedisClient(options?: {
  supportsDuplicate?: boolean;
  duplicateConnectError?: Error;
  psubscribeError?: Error;
}) {
  const {
    supportsDuplicate = false,
    duplicateConnectError,
    psubscribeError,
  } = options ?? {};

  const publishedMessages: { channel: string; message: string }[] = [];
  let psubscribeHandler: ((message: string) => void) | null = null;
  let duplicatedClient: ReturnType<typeof createMockSubscriber> | null = null;

  function createMockSubscriber() {
    let connected = false;
    return {
      connected: () => connected,
      connect: mock(async () => {
        if (duplicateConnectError) throw duplicateConnectError;
        connected = true;
      }),
      quit: mock(async () => {
        connected = false;
        return "OK";
      }),
      psubscribe: mock(
        async (
          _pattern: string,
          handler: (message: string) => void,
        ): Promise<() => void> => {
          if (psubscribeError) throw psubscribeError;
          psubscribeHandler = handler;
          return () => {
            psubscribeHandler = null;
          };
        },
      ),
    };
  }

  const client = {
    publish: mock(async (channel: string, message: string) => {
      publishedMessages.push({ channel, message });
      return 1;
    }),
    ...(supportsDuplicate && {
      duplicate: mock(() => {
        duplicatedClient = createMockSubscriber();
        return duplicatedClient;
      }),
    }),
  };

  return {
    client,
    publishedMessages,
    simulateIncomingMessage: (message: string) => {
      if (psubscribeHandler) psubscribeHandler(message);
    },
    getDuplicatedClient: () => duplicatedClient,
  };
}

describe("redisPubSub", () => {
  describe("fail-fast validation", () => {
    it("throws when subscriber === publisher (same connection)", () => {
      const { client } = createMockRedisClient();
      const sameClient = client as unknown;

      expect(() =>
        redisPubSub(client, { subscriber: sameClient as never }),
      ).toThrow("[redisPubSub] subscriber must be a separate connection");
    });

    it("allows different subscriber connection", () => {
      const { client } = createMockRedisClient();
      const subscriber = {
        psubscribe: mock(async () => () => {}),
      };

      const adapter = redisPubSub(client, { subscriber: subscriber as never });
      expect(adapter).toBeDefined();
      expect(adapter.start).toBeDefined();
    });
  });

  describe("start() presence", () => {
    it("includes start() when explicit subscriber is provided", () => {
      const { client } = createMockRedisClient();
      const subscriber = {
        psubscribe: mock(async () => () => {}),
      };

      const adapter = redisPubSub(client, { subscriber: subscriber as never });
      expect(adapter.start).toBeDefined();
    });

    it("includes start() when client supports duplicate()", () => {
      const { client } = createMockRedisClient({ supportsDuplicate: true });

      const adapter = redisPubSub(client);
      expect(adapter.start).toBeDefined();
    });

    it("omits start() when no subscriber capability", () => {
      const { client } = createMockRedisClient({ supportsDuplicate: false });

      const adapter = redisPubSub(client);
      expect(adapter.start).toBeUndefined();
    });
  });

  describe("auto-duplicate subscriber", () => {
    it("creates subscriber via duplicate() during start()", async () => {
      const { client, getDuplicatedClient } = createMockRedisClient({
        supportsDuplicate: true,
      });

      const adapter = redisPubSub(client);
      expect(adapter.start).toBeDefined();

      const stop = await adapter.start!(async () => {});
      const duplicated = getDuplicatedClient();

      expect(duplicated).not.toBeNull();
      expect(duplicated!.connect).toHaveBeenCalled();
      expect(duplicated!.psubscribe).toHaveBeenCalled();

      await stop();
      expect(duplicated!.quit).toHaveBeenCalled();
    });

    it("cleans up duplicated connection on psubscribe failure", async () => {
      const psubscribeError = new Error("psubscribe failed");
      const { client, getDuplicatedClient } = createMockRedisClient({
        supportsDuplicate: true,
        psubscribeError,
      });

      const adapter = redisPubSub(client);

      await expect(adapter.start!(async () => {})).rejects.toThrow(
        "psubscribe failed",
      );

      const duplicated = getDuplicatedClient();
      expect(duplicated).not.toBeNull();
      expect(duplicated!.quit).toHaveBeenCalled();
    });

    it("cleans up duplicated connection on connect failure", async () => {
      const duplicateConnectError = new Error("connect failed");
      const { client, getDuplicatedClient } = createMockRedisClient({
        supportsDuplicate: true,
        duplicateConnectError,
      });

      const adapter = redisPubSub(client);

      await expect(adapter.start!(async () => {})).rejects.toThrow(
        "connect failed",
      );

      // Duplicated client was created, connect threw, quit() called for cleanup
      const duplicated = getDuplicatedClient();
      expect(duplicated).not.toBeNull();
      expect(duplicated!.quit).toHaveBeenCalled();
    });
  });

  describe("broker message delivery", () => {
    it("delivers messages via onRemote callback", async () => {
      const { client, simulateIncomingMessage } = createMockRedisClient({
        supportsDuplicate: true,
      });

      const adapter = redisPubSub(client);
      const received: PublishEnvelope[] = [];

      await adapter.start!(async (envelope) => {
        received.push(envelope);
      });

      const envelope: PublishEnvelope = {
        topic: "test-topic",
        type: "TEST",
        payload: { data: "hello" },
      };
      simulateIncomingMessage(JSON.stringify(envelope));

      // Allow microtask to process
      await new Promise((r) => queueMicrotask(r));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(envelope);
    });

    it("handles async onRemote errors gracefully", async () => {
      const { client, simulateIncomingMessage } = createMockRedisClient({
        supportsDuplicate: true,
      });

      const adapter = redisPubSub(client);
      const errors: Error[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("[redisPubSub] Error in delivery callback")
        ) {
          errors.push(args[1] as Error);
        }
      };

      try {
        await adapter.start!(async () => {
          throw new Error("delivery failed");
        });

        const envelope: PublishEnvelope = {
          topic: "test",
          type: "TEST",
          payload: {},
        };
        simulateIncomingMessage(JSON.stringify(envelope));

        // Allow async error handling via Promise.resolve().catch() in implementation
        await new Promise((r) => queueMicrotask(r));
        await new Promise((r) => queueMicrotask(r)); // Second tick for catch handler

        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toBe("delivery failed");
      } finally {
        console.error = originalError;
      }
    });

    it("handles decode errors gracefully", async () => {
      const { client, simulateIncomingMessage } = createMockRedisClient({
        supportsDuplicate: true,
      });

      const adapter = redisPubSub(client);
      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("[redisPubSub] Failed to decode message")
        ) {
          errors.push(args[1]);
        }
      };

      try {
        await adapter.start!(async () => {});

        simulateIncomingMessage("invalid json {{{");

        expect(errors.length).toBeGreaterThan(0);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe("publish", () => {
    it("publishes to Redis channel with prefix", async () => {
      const { client, publishedMessages } = createMockRedisClient();

      const adapter = redisPubSub(client, { channelPrefix: "myapp:" });
      const envelope: PublishEnvelope = {
        topic: "room:123",
        type: "MESSAGE",
        payload: { text: "hello" },
      };

      await adapter.publish(envelope);

      expect(publishedMessages).toHaveLength(1);
      expect(publishedMessages[0]!.channel).toBe("myapp:room:123");
      expect(JSON.parse(publishedMessages[0]!.message)).toEqual(envelope);
    });

    it("returns capability: unknown", async () => {
      const { client } = createMockRedisClient();

      const adapter = redisPubSub(client);
      const result = await adapter.publish({
        topic: "test",
        type: "TEST",
        payload: {},
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capability).toBe("unknown");
      }
    });
  });

  describe("local subscription index", () => {
    it("delegates to memoryPubSub for subscriptions", async () => {
      const { client } = createMockRedisClient();

      const adapter = redisPubSub(client) as PubSubAdapter;

      await adapter.subscribe("client-1", "room:123");
      await adapter.subscribe("client-2", "room:123");

      const subscribers: string[] = [];
      for await (const id of adapter.getSubscribers("room:123")) {
        subscribers.push(id);
      }

      expect(subscribers).toContain("client-1");
      expect(subscribers).toContain("client-2");
    });
  });
});
