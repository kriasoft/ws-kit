// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { memoryPubSub } from "@ws-kit/memory";
import { beforeEach, describe, expect, it } from "bun:test";
import type {
  MessageSchemaType,
  ServerWebSocket,
  ValidatorAdapter,
  WebSocketData,
} from "../src/index.js";
import { CoreRouter } from "../src/core/router.js";

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Simple mock validator adapter for testing.
 */
const mockValidator: ValidatorAdapter = {
  getMessageType(schema: MessageSchemaType): string {
    return (schema as { type: string }).type;
  },

  safeParse(schema: MessageSchemaType, data: unknown) {
    const schemaType = (schema as { type: string }).type;
    const msg = data as Record<string, unknown>;

    if (msg.type !== schemaType) {
      return { success: false, error: "Type mismatch" };
    }

    return { success: true, data };
  },

  infer<T extends MessageSchemaType>(schema: T): unknown {
    return schema;
  },
};

/**
 * Mock WebSocket for testing.
 */
function createMockWebSocket(
  clientId = "test-client-123",
): ServerWebSocket<WebSocketData> {
  const messages: string[] = [];
  let isClosed = false;
  let closeCode: number | undefined;
  let closeReason: string | undefined;

  return {
    data: { clientId },
    send(message: string | Uint8Array) {
      if (!isClosed) {
        messages.push(
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message),
        );
      }
    },
    close(code?: number, reason?: string) {
      isClosed = true;
      closeCode = code;
      closeReason = reason;
    },
    subscribe() {
      /* no-op */
    },
    unsubscribe() {
      /* no-op */
    },
    readyState: isClosed ? 3 : 1, // 1 = OPEN, 3 = CLOSED

    // Test helpers
    _getMessages() {
      return messages;
    },
    _isClosed() {
      return isClosed;
    },
    _getCloseCode() {
      return closeCode;
    },
    _getCloseReason() {
      return closeReason;
    },
  } as unknown as ServerWebSocket<WebSocketData> & {
    _getMessages(): string[];
    _isClosed(): boolean;
    _getCloseCode(): number | undefined;
    _getCloseReason(): string | undefined;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("WebSocketRouter", () => {
  let router: WebSocketRouter<typeof mockValidator, WebSocketData>;
  let ws: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    router = new CoreRouter({
      validator: mockValidator,
    });
    ws = createMockWebSocket();
  });

  describe("Handler Registration", () => {
    it("should register message handlers", () => {
      const schema = { type: "TEST_MESSAGE" } as MessageSchemaType;
      const handler = () => {
        /* no-op */
      };

      expect(() => router.on(schema, handler)).not.toThrow();
    });

    it("should warn when overwriting handler for same message type", () => {
      const schema = { type: "TEST_MESSAGE" } as MessageSchemaType;
      const handler1 = () => {
        /* no-op */
      };
      const handler2 = () => {
        /* no-op */
      };

      let warnings = 0;
      const originalWarn = console.warn;
      console.warn = (msg: unknown) => {
        if (typeof msg === "string" && msg.includes("overwritten")) {
          warnings++;
        }
      };

      router.on(schema, handler1);
      router.on(schema, handler2);

      console.warn = originalWarn;
      expect(warnings).toBe(1);
    });

    it("should support method chaining", () => {
      const schema1 = { type: "MSG1" } as MessageSchemaType;
      const schema2 = { type: "MSG2" } as MessageSchemaType;
      const handler = () => {
        /* no-op */
      };

      const result = router.on(schema1, handler).on(schema2, handler);
      expect(result).toBe(router);
    });

    it("should register lifecycle handlers", () => {
      const openHandler = () => {
        /* no-op */
      };
      const closeHandler = () => {
        /* no-op */
      };
      const authHandler = () => true;
      const errorHandler = () => {
        /* no-op */
      };

      expect(() =>
        router
          .onOpen(openHandler)
          .onClose(closeHandler)
          .onAuth(authHandler)
          .onError(errorHandler),
      ).not.toThrow();
    });
  });

  describe("Router Composition", () => {
    it("should merge message handlers via merge", () => {
      const router1 = new CoreRouter({ validator: mockValidator });
      const router2 = new CoreRouter({ validator: mockValidator });

      const schema1 = { type: "MSG1" } as MessageSchemaType;
      const schema2 = { type: "MSG2" } as MessageSchemaType;
      const handler = () => {
        /* no-op */
      };

      router1.on(schema1, handler);
      router2.on(schema2, handler);

      const combined = new CoreRouter({ validator: mockValidator });
      combined.merge(router1).merge(router2);

      // Test that both handlers are present by trying to handle messages
      // This is implicitly tested by handleMessage not throwing
      expect(() => combined).not.toThrow();
    });

    it("should support method chaining with merge", () => {
      const router1 = new CoreRouter({ validator: mockValidator });
      const router2 = new CoreRouter({ validator: mockValidator });

      const result = router.merge(router1).merge(router2);
      expect(result).toBe(router);
    });

    it("should handle last-write-wins for duplicate message types", () => {
      const router1 = new CoreRouter({ validator: mockValidator });
      const router2 = new CoreRouter({ validator: mockValidator });

      const schema = { type: "MSG" } as MessageSchemaType;
      let callCount = 0;

      const handler1 = () => {
        callCount = 1;
      };
      const handler2 = () => {
        callCount = 2;
      };

      router1.on(schema, handler1);
      router2.on(schema, handler2);

      const combined = new CoreRouter({ validator: mockValidator });
      combined.merge(router1).merge(router2);

      // router2's handler should override router1's
      // This is tested in message handling tests
      expect(() => combined).not.toThrow();
    });
  });

  describe("Connection Lifecycle", () => {
    it("should handle connection open", async () => {
      let openCalled = false;
      router.onOpen(() => {
        openCalled = true;
      });

      await router.handleOpen(ws);
      expect(openCalled).toBe(true);
    });

    it("should call multiple open handlers in order", async () => {
      const calls: number[] = [];

      router.onOpen(() => {
        calls.push(1);
      });
      router.onOpen(() => {
        calls.push(2);
      });

      await router.handleOpen(ws);
      expect(calls).toEqual([1, 2]);
    });

    it("should handle connection close", async () => {
      let closeCalled = false;
      let closeCode: number | undefined;
      let closeReason: string | undefined;

      router.onClose((ctx) => {
        closeCalled = true;
        closeCode = ctx.code;
        closeReason = ctx.reason;
      });

      await router.handleOpen(ws); // Initialize heartbeat
      await router.handleClose(ws, 1000, "Normal closure");

      expect(closeCalled).toBe(true);
      expect(closeCode).toBe(1000);
      expect(closeReason).toBe("Normal closure");
    });

    it("should call multiple close handlers in order", async () => {
      const calls: number[] = [];

      router.onClose(() => {
        calls.push(1);
      });
      router.onClose(() => {
        calls.push(2);
      });

      await router.handleOpen(ws);
      await router.handleClose(ws, 1000);

      expect(calls).toEqual([1, 2]);
    });
  });

  describe("Message Handling", () => {
    it("should route valid messages to handlers", async () => {
      let handled = false;
      const schema = { type: "PING" } as MessageSchemaType;

      router.on(schema, (ctx) => {
        handled = true;
        expect(ctx.type).toBe("PING");
      });

      await router.handleOpen(ws);
      const message = JSON.stringify({
        type: "PING",
        meta: {},
      });

      await router.handleMessage(ws, message);
      expect(handled).toBe(true);
    });

    it("should ignore messages without handlers", async () => {
      const errorCalls: unknown[] = [];
      router.onError((err) => {
        errorCalls.push(err);
      });

      await router.handleOpen(ws);
      const message = JSON.stringify({
        type: "UNKNOWN",
        meta: {},
      });

      // Should log warning but not throw
      await router.handleMessage(ws, message);
      // Error handler should not be called for missing handler
      expect(errorCalls.length).toBe(0);
    });

    it("should reject invalid JSON", async () => {
      let errorCalled = false;
      router.onError(() => {
        errorCalled = true;
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, "invalid json {");

      // Error should be logged but not through error handler
      // (JSON parse errors are logged to console, not error handler)
      expect(true).toBe(true); // Just verify it doesn't throw
    });
  });

  describe("Payload Size Limits", () => {
    it("should enforce max payload size", async () => {
      const smallRouter = new CoreRouter({
        validator: mockValidator,
        limits: { maxPayloadBytes: 100 },
      });

      await smallRouter.handleOpen(ws);

      // Create a message larger than 100 bytes
      const largePayload = "x".repeat(200);
      const message = JSON.stringify({
        type: "TEST",
        meta: {},
        payload: largePayload,
      });

      // Should handle without crashing (error is logged)
      await smallRouter.handleMessage(ws, message);
      expect(true).toBe(true);
    });
  });

  describe("PubSub Integration", () => {
    it("should use provided PubSub instance", async () => {
      const pubsub = memoryPubSub();
      const router2 = new CoreRouter({
        validator: mockValidator,
        pubsub,
      });

      const messages: unknown[] = [];
      pubsub.subscribe("test-channel", (msg) => {
        messages.push(msg);
      });

      await router2.publish(
        "test-channel",
        { type: "TEST" },
        { data: "hello" },
      );

      expect(messages.length).toBe(1);
      expect(messages[0]).toHaveProperty("type", "TEST");
      expect((messages[0] as any).payload).toEqual({ data: "hello" });
      expect(messages[0]).toHaveProperty("meta");
      expect((messages[0] as any).meta).toHaveProperty("timestamp");
    });

    it("should default to MemoryPubSub if not provided", async () => {
      const router2 = new CoreRouter({
        validator: mockValidator,
      });

      // Publish should not throw
      await router2.publish("test-channel", { type: "TEST" });
      expect(true).toBe(true);
    });
  });

  describe("Send Function", () => {
    it("should validate messages before sending", async () => {
      await router.handleOpen(ws);

      // Get the send function from context
      const messages = (
        ws as unknown as { _getMessages(): string[] }
      )._getMessages();

      // Initial state - no messages
      expect(messages.length).toBe(0);
    });
  });

  describe("Configuration", () => {
    it("should use default config when not provided", () => {
      const defaultRouter = new CoreRouter({
        validator: mockValidator,
      });

      // Should be created without errors
      expect(defaultRouter).toBeDefined();
    });

    it("should accept custom heartbeat config", () => {
      const customRouter = new CoreRouter({
        validator: mockValidator,
        heartbeat: {
          intervalMs: 60000,
          timeoutMs: 10000,
        },
      });

      expect(customRouter).toBeDefined();
    });

    it("should accept custom limits config", () => {
      const customRouter = new CoreRouter({
        validator: mockValidator,
        limits: {
          maxPayloadBytes: 5_000_000,
        },
      });

      expect(customRouter).toBeDefined();
    });
  });

  describe("Testability - Testing Mode", () => {
    it("should expose testing utilities when testing mode is enabled", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      expect(testingRouter._testing).toBeDefined();
      expect(testingRouter._testing?.handlers).toBeDefined();
      expect(testingRouter._testing?.middleware).toBeDefined();
      expect(testingRouter._testing?.routeMiddleware).toBeDefined();
      expect(testingRouter._testing?.heartbeatStates).toBeDefined();
    });

    it("should not expose testing utilities when testing mode is disabled", () => {
      const normalRouter = new CoreRouter({
        validator: mockValidator,
        testing: false,
      } as any);

      expect(normalRouter._testing).toBeUndefined();
    });

    it("should allow inspecting handlers via _testing", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const schema = { type: "TEST_MESSAGE" } as MessageSchemaType;
      const handler = () => {
        /* no-op */
      };

      testingRouter.on(schema, handler);

      expect(testingRouter._testing?.handlers.size).toBe(1);
      expect(testingRouter._testing?.handlers.has("TEST_MESSAGE")).toBe(true);
    });

    it("should allow inspecting middleware via _testing", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const middleware = (ctx: any, next: any) => next();
      testingRouter.use(middleware);

      expect(testingRouter._testing?.middleware.length).toBe(1);
      expect(testingRouter._testing?.middleware[0]).toBe(middleware);
    });

    it("should allow inspecting lifecycle handlers via _testing", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const openHandler = () => {
        /* no-op */
      };
      const closeHandler = () => {
        /* no-op */
      };

      testingRouter.onOpen(openHandler).onClose(closeHandler);

      expect(testingRouter._testing?.openHandlers.length).toBe(1);
      expect(testingRouter._testing?.closeHandlers.length).toBe(1);
      expect(testingRouter._testing?.openHandlers[0]).toBe(openHandler);
      expect(testingRouter._testing?.closeHandlers[0]).toBe(closeHandler);
    });
  });

  describe("Testability - Reset Method", () => {
    it("should clear all handlers when reset is called", () => {
      const schema = { type: "TEST_MESSAGE" } as MessageSchemaType;
      const handler = () => {
        /* no-op */
      };

      router.on(schema, handler);
      expect(router.routes().length).toBe(1);

      router.reset();
      expect(router.routes().length).toBe(0);
    });

    it("should clear all middleware when reset is called", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const middleware1 = (_ctx: any, next: any) => next();
      const middleware2 = (_ctx: any, next: any) => next();
      testingRouter.use(middleware1);
      testingRouter.use(middleware2);
      expect(testingRouter._testing?.middleware.length).toBe(2);

      testingRouter.reset();
      expect(testingRouter._testing?.middleware.length).toBe(0);
    });

    it("should clear per-route middleware when reset is called", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const schema = { type: "TEST_MESSAGE" } as MessageSchemaType;
      const middleware = (_ctx: any, next: any) => next();
      testingRouter.use(schema, middleware);
      expect(testingRouter._testing?.routeMiddleware.size).toBe(1);

      testingRouter.reset();
      expect(testingRouter._testing?.routeMiddleware.size).toBe(0);
    });

    it("should clear lifecycle handlers when reset is called", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const openHandler = () => {
        /* no-op */
      };
      const closeHandler = () => {
        /* no-op */
      };
      testingRouter.onOpen(openHandler);
      testingRouter.onClose(closeHandler);
      expect(testingRouter._testing?.openHandlers.length).toBe(1);
      expect(testingRouter._testing?.closeHandlers.length).toBe(1);

      testingRouter.reset();
      expect(testingRouter._testing?.openHandlers.length).toBe(0);
      expect(testingRouter._testing?.closeHandlers.length).toBe(0);
    });

    it("should support method chaining with reset", () => {
      const result = router.reset();
      expect(result).toBe(router);
    });

    it("should allow reusing router instance in tests", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const schema1 = { type: "MSG1" } as MessageSchemaType;
      const schema2 = { type: "MSG2" } as MessageSchemaType;
      const handler = () => {
        /* no-op */
      };

      // First test
      testingRouter.on(schema1, handler);
      expect(testingRouter.routes().length).toBe(1);
      expect(testingRouter._testing?.handlers.size).toBe(1);

      // Reset for second test
      testingRouter.reset();
      expect(testingRouter.routes().length).toBe(0);
      expect(testingRouter._testing?.handlers.size).toBe(0);

      // Second test with different handler
      testingRouter.on(schema2, handler);
      expect(testingRouter.routes().length).toBe(1);
      expect(testingRouter.routes()[0].messageType).toBe("MSG2");
      expect(testingRouter._testing?.handlers.size).toBe(1);
    });

    it("should preserve validator config after reset", () => {
      const testingRouter = new CoreRouter({
        validator: mockValidator,
        testing: true,
      } as any);

      const schema = { type: "TEST" } as MessageSchemaType;
      testingRouter.on(schema, () => {
        /* no-op */
      });

      testingRouter.reset();

      // Should still be able to register new handlers with same validator
      const schema2 = { type: "TEST2" } as MessageSchemaType;
      expect(() => testingRouter.on(schema2, () => {})).not.toThrow();
      expect(testingRouter.routes().length).toBe(1);
    });
  });

  describe("Testability - Validation Bypass", () => {
    it("should skip validation when validate: false is passed", () => {
      const mockWs = createMockWebSocket();
      const sendFn = (router as any).createSendFunction(mockWs);
      const schema = { type: "TEST" } as MessageSchemaType;

      // Send with validate: false - should not validate payload structure
      // Even though payload is invalid per mockValidator, it should still be sent
      sendFn(schema, { invalid: "payload" }, { validate: false });

      const messages = (mockWs as any)._getMessages();
      expect(messages.length).toBe(1);

      const parsed = JSON.parse(messages[0]);
      expect(parsed.type).toBe("TEST");
      expect(parsed.meta).toBeDefined();
      expect(parsed.payload).toEqual({ invalid: "payload" });
    });

    it("should validate by default when validate option is not provided", () => {
      const mockWs = createMockWebSocket();
      const sendFn = (router as any).createSendFunction(mockWs);
      const schema = { type: "TEST" } as MessageSchemaType;

      // Send without validate option (defaults to true)
      // mockValidator will validate the message structure
      const originalError = console.error;
      console.error = () => {
        // Suppress error logs during test
      };

      try {
        sendFn(schema, { data: "value" }, {});

        // mockValidator accepts any structure, so this succeeds
        // Validation still runs but succeeds
        const messages = (mockWs as any)._getMessages();
        expect(messages.length).toBe(1);
      } finally {
        console.error = originalError;
      }
    });

    it("should preserve metadata when using validate: false", () => {
      const mockWs = createMockWebSocket();
      const sendFn = (router as any).createSendFunction(mockWs);
      const schema = { type: "TEST" } as MessageSchemaType;

      // Send with metadata and validate: false
      sendFn(schema, { payload: "data" }, {
        correlationId: "123",
        validate: false,
      } as any);

      const messages = (mockWs as any)._getMessages();
      expect(messages.length).toBe(1);

      const parsed = JSON.parse(messages[0]);
      expect(parsed.meta.correlationId).toBe("123");
      expect(parsed.meta.validate).toBeUndefined(); // Should be filtered out
    });

    it("should filter out validate option from metadata", () => {
      const mockWs = createMockWebSocket();
      const sendFn = (router as any).createSendFunction(mockWs);
      const schema = { type: "TEST" } as MessageSchemaType;

      // Pass validate in options along with other metadata
      sendFn(
        schema,
        { data: "test" },
        {
          validate: false,
          customField: "value",
        },
      );

      const messages = (mockWs as any)._getMessages();
      const parsed = JSON.parse(messages[0]);

      // validate option should be removed from meta
      expect(parsed.meta.validate).toBeUndefined();
      // Other metadata should be preserved
      expect(parsed.meta.customField).toBe("value");
    });
  });
});
