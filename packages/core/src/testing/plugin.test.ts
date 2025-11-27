// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ConnectionData, MessageDescriptor } from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { mockPlugin } from "@ws-kit/core/testing";
import { describe, expect, it } from "bun:test";

describe("mockPlugin", () => {
  it("should create a mock plugin with specified extensions", () => {
    interface MockAPI {
      testMethod(): string;
    }

    const mockTestPlugin = mockPlugin<ConnectionData, MockAPI>({
      testMethod: () => "mocked",
    });

    const router = createRouter<ConnectionData>().plugin(mockTestPlugin);

    expect(router.testMethod()).toBe("mocked");
  });

  it("should support multiple mock properties", async () => {
    interface MockPubSubAPI {
      publish: (topic: string) => Promise<{ ok: boolean }>;
      topics: { list: () => string[] };
    }

    const publishCalls: string[] = [];

    const mockPubSub = mockPlugin<ConnectionData, MockPubSubAPI>({
      publish: async (topic) => {
        publishCalls.push(topic);
        return { ok: true };
      },
      topics: {
        list: () => ["topic1", "topic2"],
      },
    });

    const router = createRouter<ConnectionData>().plugin(mockPubSub);

    await router.publish("test-topic");

    expect(publishCalls).toContain("test-topic");
    expect(router.topics.list()).toContain("topic1");
  });

  it("should preserve router base methods after plugin", () => {
    interface MockAPI {
      customMethod(): void;
    }

    const mockPlugin1 = mockPlugin<ConnectionData, MockAPI>({
      customMethod: () => {
        // no-op
      },
    });

    const router = createRouter<ConnectionData>().plugin(mockPlugin1);

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

    const mockValidation = mockPlugin<ConnectionData, ValidationAPI>({
      rpc: (schema, handler) => {
        rpcCalls.push({ schema, handler });
        // Return a chainable router-like object for method chaining
        const mockRouter = {
          on: () => mockRouter,
          use: () => mockRouter,
          plugin: () => mockRouter,
        };
        return mockRouter;
      },
    });

    const router = createRouter<ConnectionData>().plugin(mockValidation);

    const mockSchema = { type: "TEST", response: {} };
    const mockHandler = () => {};

    // @ts-expect-error - rpc method is mock-provided and not a standard router method
    const result = router.rpc(mockSchema, mockHandler);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].schema.type).toBe("TEST");
    // Verify the mock returns a chainable object
    expect(typeof result.on).toBe("function");
    expect(typeof result.use).toBe("function");
    expect(typeof result.plugin).toBe("function");
  });
});
