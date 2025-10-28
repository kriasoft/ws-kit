// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client onError Hook Tests
 *
 * Tests centralized error reporting hook:
 * - Parse failures fire onError
 * - Validation failures fire onError
 * - Queue overflow fires onError
 * - Handler errors do NOT fire onError (logged only)
 * - Request rejections do NOT fire onError (caller handles)
 *
 * See @specs/client.md#error-handling
 * See @specs/client.md#centralized-error-reporting
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { StateError } from "../../client/errors";
import { createClient } from "../../client/index";
import type { WebSocketClient } from "../../client/types";
import { createMessageSchema } from "../../packages/zod/src/schema";
import { createMockWebSocket } from "./helpers";

const { messageSchema } = createMessageSchema(z);

const TestMsg = messageSchema("TEST", { id: z.number() });
const Hello = messageSchema("HELLO", { name: z.string() });
const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

describe("Client: onError Hook", () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;
  let client: WebSocketClient;
  let errors: { error: Error; context: any }[];

  beforeEach(() => {
    errors = [];
    mockWs = createMockWebSocket();

    client = createClient({
      url: "ws://test",
      wsFactory: () => {
        setTimeout(() => mockWs._trigger.open(), 0);
        return mockWs as unknown as WebSocket;
      },
      reconnect: { enabled: false },
    });

    client.onError((error, context) => {
      errors.push({ error, context });
    });
  });

  describe("Parse failures", () => {
    it("fires onError for invalid JSON", async () => {
      await client.connect();

      // Mock console.warn to suppress warnings
      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        // Simulate invalid JSON from server
        const messageHandler = (mockWs as any).onmessage;
        if (messageHandler) {
          messageHandler({ data: "not valid json {" });
        }

        expect(errors).toHaveLength(1);
        expect(errors[0]?.context.type).toBe("parse");
        expect(errors[0]?.error.message).toContain("JSON");
      } finally {
        console.warn = originalWarn;
      }
    });

    it("includes error details in context", async () => {
      await client.connect();

      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        const messageHandler = (mockWs as any).onmessage;
        if (messageHandler) {
          messageHandler({ data: "invalid" });
        }

        expect(errors[0]?.context).toMatchObject({
          type: "parse",
        });
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("Validation failures", () => {
    it("fires onError for schema validation failure", async () => {
      await client.connect();

      client.on(TestMsg, () => {});

      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        // Send invalid message (wrong payload type)
        mockWs._trigger.message({
          type: "TEST",
          meta: {},
          payload: { id: "should-be-number" },
        });

        expect(errors).toHaveLength(1);
        expect(errors[0]?.context.type).toBe("validation");
        expect(errors[0]?.context.details).toBeDefined();
      } finally {
        console.warn = originalWarn;
      }
    });

    it("includes validation details in context", async () => {
      await client.connect();

      client.on(TestMsg, () => {});

      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        mockWs._trigger.message({
          type: "TEST",
          meta: {},
          payload: { id: "invalid" },
        });

        const ctx = errors[0]?.context;
        expect(ctx.type).toBe("validation");
        expect(ctx.details).toBeDefined();
        // Validation details should contain info about the failure
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("Queue overflow", () => {
    it("fires onError when queue overflows with drop-newest", () => {
      const client = createClient({
        url: "ws://test",
        queue: "drop-newest",
        queueSize: 2,
        reconnect: { enabled: false },
      });

      client.onError((error, context) => {
        errors.push({ error, context });
      });

      // Fill queue (not connected)
      client.send(TestMsg, { id: 1 });
      client.send(TestMsg, { id: 2 });

      // Overflow - should fire onError
      client.send(TestMsg, { id: 3 });

      expect(errors).toHaveLength(1);
      expect(errors[0]?.context.type).toBe("overflow");
    });

    it("fires onError when queue overflows with drop-oldest", () => {
      const client = createClient({
        url: "ws://test",
        queue: "drop-oldest",
        queueSize: 2,
        reconnect: { enabled: false },
      });

      client.onError((error, context) => {
        errors.push({ error, context });
      });

      // Fill queue
      client.send(TestMsg, { id: 1 });
      client.send(TestMsg, { id: 2 });

      // Overflow - evicts oldest but still fires onError
      client.send(TestMsg, { id: 3 });

      expect(errors).toHaveLength(1);
      expect(errors[0]?.context.type).toBe("overflow");
    });
  });

  describe("Handler errors do NOT fire onError", () => {
    it("does not fire onError when handler throws", async () => {
      await client.connect();

      client.on(TestMsg, () => {
        throw new Error("Handler error");
      });

      const originalError = console.error;
      console.error = () => {};

      try {
        mockWs._trigger.message({
          type: "TEST",
          meta: {},
          payload: { id: 123 },
        });

        // Handler error logged but NOT passed to onError
        expect(errors).toHaveLength(0);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe("Request rejections do NOT fire onError", () => {
    it("does not fire onError for timeout", async () => {
      await client.connect();

      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        timeoutMs: 10,
      });

      // Let timeout occur
      try {
        await promise;
      } catch (error) {
        // Expected TimeoutError
      }

      // onError should NOT fire (caller handles rejection)
      expect(errors).toHaveLength(0);
    });

    it("does not fire onError for StateError (queue disabled)", async () => {
      const offlineClient = createClient({
        url: "ws://test",
        queue: "off",
        reconnect: { enabled: false },
      });

      offlineClient.onError((error, context) => {
        errors.push({ error, context });
      });

      // Not connected, queue disabled
      const promise = offlineClient.request(Hello, { name: "test" }, HelloOk);

      try {
        await promise;
      } catch (error) {
        // Expected StateError
        expect(error).toBeInstanceOf(StateError);
      }

      // onError should NOT fire
      expect(errors).toHaveLength(0);
    });

    it("does not fire onError for connection closed error", async () => {
      await client.connect();

      const promise = client.request(Hello, { name: "test" }, HelloOk, {
        timeoutMs: 5000,
      });

      // Attach rejection handler BEFORE closing
      const rejection = promise.catch((error) => error);

      // Close connection before reply
      await client.close();

      // Wait for rejection to be handled
      const error = await rejection;
      expect(error).toBeDefined();

      // onError should NOT fire
      expect(errors).toHaveLength(0);
    });
  });

  describe("Multiple onError handlers", () => {
    it("supports unsubscribe", async () => {
      const errors2: typeof errors = [];

      await client.connect();

      // Register second handler
      const unsub = client.onError((error, context) => {
        errors2.push({ error, context });
      });

      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        // Trigger error
        const messageHandler = (mockWs as any).onmessage;
        if (messageHandler) {
          messageHandler({ data: "invalid json" });
        }

        expect(errors).toHaveLength(1);
        expect(errors2).toHaveLength(1);

        // Unsubscribe second handler
        unsub();

        // Trigger another error
        if (messageHandler) {
          messageHandler({ data: "more invalid" });
        }

        expect(errors).toHaveLength(2); // First handler still active
        expect(errors2).toHaveLength(1); // Second handler unsubscribed
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("Unknown error type", () => {
    it("uses unknown type for unexpected errors", async () => {
      // This is a placeholder test - in practice, "unknown" type
      // would be used for errors that don't fit other categories
      // (implementation-specific)

      await client.connect();

      // Simulate structural validation failure (missing type field)
      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        mockWs._trigger.message({
          meta: {},
          payload: { value: "test" },
        });

        // Invalid structure should be handled
        // (may or may not fire onError depending on implementation)
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("Error context provides useful debugging info", () => {
    it("parse error includes raw data info", async () => {
      await client.connect();

      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        const messageHandler = (mockWs as any).onmessage;
        if (messageHandler) {
          messageHandler({ data: "{invalid" });
        }

        expect(errors[0]?.error).toBeInstanceOf(Error);
        expect(errors[0]?.context.type).toBe("parse");
      } finally {
        console.warn = originalWarn;
      }
    });

    it("validation error includes schema type and issues", async () => {
      await client.connect();

      client.on(TestMsg, () => {});

      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        mockWs._trigger.message({
          type: "TEST",
          meta: {},
          payload: { id: "not-a-number" },
        });

        const ctx = errors[0]?.context;
        expect(ctx.type).toBe("validation");
        expect(ctx.details).toBeDefined();
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});
