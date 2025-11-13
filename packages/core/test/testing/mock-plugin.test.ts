// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import { createRouter } from "../../src/index.js";
import { mockPlugin } from "../../src/testing/index.js";
import type { MessageDescriptor } from "../../src/protocol/message-descriptor.js";

describe("mockPlugin", () => {
  it("should create a mock plugin with specified extensions", () => {
    interface MockAPI {
      testMethod(): string;
    }

    const mockTestPlugin = mockPlugin<unknown, MockAPI>({
      testMethod: () => "mocked",
    });

    const router = createRouter().plugin(mockTestPlugin);

    // @ts-expect-error - mockPlugin creates minimal types
    expect(router.testMethod()).toBe("mocked");
  });

  it("should support multiple mock properties", () => {
    interface MockPubSubAPI {
      publish: (topic: string) => Promise<{ ok: boolean }>;
      topics: { list: () => string[] };
    }

    const publishCalls: string[] = [];

    const mockPubSub = mockPlugin<unknown, MockPubSubAPI>({
      publish: async (topic) => {
        publishCalls.push(topic);
        return { ok: true };
      },
      topics: {
        list: () => ["topic1", "topic2"],
      },
    });

    const router = createRouter().plugin(mockPubSub);

    // @ts-expect-error - mockPlugin creates minimal types
    router.publish("test-topic").then(() => {
      expect(publishCalls).toContain("test-topic");
    });

    // @ts-expect-error - mockPlugin creates minimal types
    expect(router.topics.list()).toContain("topic1");
  });

  it("should preserve router base methods after plugin", () => {
    interface MockAPI {
      customMethod(): void;
    }

    const mockPlugin1 = mockPlugin<unknown, MockAPI>({
      customMethod: () => {
        // no-op
      },
    });

    const router = createRouter().plugin(mockPlugin1);

    // Router base methods should still be available
    expect(typeof router.on).toBe("function");
    expect(typeof router.use).toBe("function");
    expect(typeof router.plugin).toBe("function");
  });

  it("should allow tracking calls for verification", async () => {
    interface ValidationAPI {
      rpc(
        schema: MessageDescriptor & { response: MessageDescriptor },
        handler: any,
      ): any;
    }

    const rpcCalls: any[] = [];

    const mockValidation = mockPlugin<unknown, ValidationAPI>({
      rpc: (schema, handler) => {
        rpcCalls.push({ schema, handler });
        // For mock, just return router-like object
        return {};
      },
    });

    const router = createRouter().plugin(mockValidation);

    // @ts-expect-error - minimal mock
    const mockSchema = { type: "TEST", response: {} };
    const mockHandler = () => {};

    // @ts-expect-error - minimal mock
    router.rpc(mockSchema, mockHandler);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].schema.type).toBe("TEST");
  });
});
