// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  mock,
  spyOn,
} from "bun:test";
import { z } from "zod";
import { WebSocketRouter } from "../../zod/router";
import { createMessageSchema } from "../../zod/schema";
import type { MessageContext } from "../../zod/types";

const { messageSchema } = createMessageSchema(z);

// Mock the console methods to prevent noise during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = mock(() => {
    /* Mock implementation */
  });
  console.warn = mock(() => {
    /* Mock implementation */
  });
  console.error = mock(() => {
    /* Mock implementation */
  });
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// Mock Bun's ServerWebSocket
class MockServerWebSocket {
  data: unknown;
  sentMessages: unknown[] = [];

  constructor(data: unknown) {
    this.data = data;
  }

  send(message: string) {
    this.sentMessages.push(JSON.parse(message));
  }

  close(_code?: number, _reason?: string) {
    /* Mock implementation */
  }
}

describe("WebSocketRouter", () => {
  describe("message handling", () => {
    it("should correctly route messages to their handlers", () => {
      // Define test schemas
      const TestMessage = messageSchema("TEST_MESSAGE", {
        message: z.string(),
      });

      // Create a mock handler
      const handlerMock = mock((_ctx: unknown) => {
        /* Mock implementation */
      });

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(TestMessage, handlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as unknown as MockServerWebSocket;

      // Call the handleMessage method directly with a valid message
      const validMessage = JSON.stringify({
        type: "TEST_MESSAGE",
        meta: {},
        payload: { message: "Hello World" },
      });

      // @ts-expect-error - Accessing private method for testing
      router.handleMessage(ws, validMessage);

      // Verify the handler was called
      expect(handlerMock).toHaveBeenCalled();
      expect(handlerMock.mock.calls.length).toBe(1);

      // Verify the context passed to the handler
      const context = handlerMock.mock.calls[0]?.[0] as MessageContext<
        typeof TestMessage,
        { clientId: string }
      >;
      // @ts-expect-error - MockServerWebSocket is not fully assignable to ServerWebSocket
      expect(context.ws).toBe(ws);
      expect(context.ws.data.clientId).toBe("test-client-123");
      expect(context.payload.message).toBe("Hello World");
    });

    it("should reject messages that fail schema validation", () => {
      // Define test schema with required field
      const RequiredFieldMessage = messageSchema("REQUIRED_FIELD", {
        requiredField: z.string(),
      });

      // Create a mock handler
      const handlerMock = mock((_ctx: unknown) => {
        /* Mock implementation */
      });

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(RequiredFieldMessage, handlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as unknown as MockServerWebSocket;

      // Call the handleMessage method with an invalid message (missing required field)
      const invalidMessage = JSON.stringify({
        type: "REQUIRED_FIELD",
        meta: {},
        payload: {}, // Missing requiredField
      });

      // @ts-expect-error - Accessing private method for testing
      router.handleMessage(ws, invalidMessage);

      // Verify the handler was NOT called
      expect(handlerMock).not.toHaveBeenCalled();

      // Verify error was logged
      expect(console.error).toHaveBeenCalled();
    });

    it("should handle malformed JSON gracefully", () => {
      const router = new WebSocketRouter();
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as unknown as MockServerWebSocket;

      // Malformed JSON
      const malformedJson = "{ this is not valid JSON }";

      // @ts-expect-error - Accessing private method for testing
      router.handleMessage(ws, malformedJson);

      // Should log an error but not crash
      expect(console.error).toHaveBeenCalled();
    });

    it("should handle unknown message types gracefully", () => {
      const router = new WebSocketRouter();
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as unknown as MockServerWebSocket;

      // Unknown message type
      const unknownTypeMessage = JSON.stringify({
        type: "UNKNOWN_TYPE",
        meta: {},
      });

      // @ts-expect-error - Accessing private method for testing
      router.handleMessage(ws, unknownTypeMessage);

      // Should log a warning but not crash
      expect(console.warn).toHaveBeenCalled();
    });

    it("should handle Buffer messages", () => {
      // Define test schema
      const BufferMessage = messageSchema("BUFFER_MESSAGE", {
        message: z.string(),
      });

      // Create a mock handler
      const handlerMock = mock((_ctx: unknown) => {
        /* Mock implementation */
      });

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(BufferMessage, handlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as unknown as MockServerWebSocket;

      // Create a valid message as Buffer
      const messageObj = {
        type: "BUFFER_MESSAGE",
        meta: {},
        payload: { message: "Hello from Buffer" },
      };
      const bufferMessage = Buffer.from(JSON.stringify(messageObj));

      // @ts-expect-error - Accessing private method for testing
      router.handleMessage(ws, bufferMessage);

      // Verify the handler was called
      expect(handlerMock).toHaveBeenCalled();
      expect(handlerMock.mock.calls.length).toBe(1);

      // Verify the context passed to the handler
      const context = handlerMock.mock.calls[0]?.[0] as MessageContext<
        typeof BufferMessage,
        unknown
      >;
      expect(context.payload.message).toBe("Hello from Buffer");
    });

    it("should handle async message handlers properly", async () => {
      // Define test schema
      const AsyncMessage = messageSchema("ASYNC_MESSAGE", {
        message: z.string(),
      });

      // Create a mock for async function
      let handlerResolved = false;
      const asyncHandlerMock = mock(async (_ctx: unknown) => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        handlerResolved = true;
      });

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(AsyncMessage, asyncHandlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as unknown as MockServerWebSocket;

      // Send a valid message
      const validMessage = JSON.stringify({
        type: "ASYNC_MESSAGE",
        meta: {},
        payload: { message: "Async Hello" },
      });

      // @ts-expect-error - Accessing private method for testing
      router.handleMessage(ws, validMessage);

      // Verify the handler was called
      expect(asyncHandlerMock).toHaveBeenCalled();

      // Wait for the async handler to resolve
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Check that the async work was completed
      expect(handlerResolved).toBe(true);
    });

    it("should handle errors in handlers gracefully", () => {
      // Define test schema
      const ErrorMessage = messageSchema("ERROR_MESSAGE");

      // Create a handler that throws an error
      const errorHandlerMock = mock(() => {
        throw new Error("Intentional error for testing");
      });

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(ErrorMessage, errorHandlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as unknown as MockServerWebSocket;

      // Create a spy on console.error to verify it's called
      const errorSpy = spyOn(console, "error");

      // Send a valid message that will cause an error in the handler
      const validMessage = JSON.stringify({
        type: "ERROR_MESSAGE",
        meta: {},
      });

      // @ts-expect-error - Accessing private method for testing
      router.handleMessage(ws, validMessage);

      // Verify the handler was called and error was logged
      expect(errorHandlerMock).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("type inference", () => {
    it("should infer payload types in inline handlers", () => {
      const router = new WebSocketRouter<{ sessionId: string }>();

      // Message with payload
      const JoinRoom = messageSchema("JOIN_ROOM", {
        roomId: z.string(),
        userId: z.number(),
      });

      // Message without payload
      const PingMessage = messageSchema("PING");

      // Test inline handler with payload - should have proper type inference
      router.onMessage(JoinRoom, (ctx) => {
        // These type assertions would fail if ctx.payload were 'any'
        expectTypeOf(ctx.payload.roomId).toBeString();
        expectTypeOf(ctx.payload.userId).toBeNumber();
        expectTypeOf(ctx.type).toEqualTypeOf<"JOIN_ROOM">();
        expectTypeOf(ctx.ws.data.sessionId).toBeString();
        expectTypeOf(ctx.ws.data.clientId).toBeString();
        expectTypeOf(ctx.send).toBeFunction();

        // Should error on non-existent properties
        // @ts-expect-error - Property does not exist
        expectTypeOf(ctx.payload.nonExistent).toBeAny();
      });

      // Test inline handler without payload
      router.onMessage(PingMessage, (ctx) => {
        expectTypeOf(ctx.type).toEqualTypeOf<"PING">();
        expectTypeOf(ctx.meta).toHaveProperty("timestamp");

        // Should error when accessing payload on message without payload
        // @ts-expect-error - Payload should not exist
        expectTypeOf(ctx.payload).toBeAny();
      });
    });

    it("should infer complex payload types", () => {
      const router = new WebSocketRouter();

      const ComplexMessage = messageSchema("COMPLEX", {
        nested: z.object({
          array: z.array(z.string()),
          optional: z.number().optional(),
          union: z.union([z.string(), z.number()]),
        }),
        literal: z.literal("test"),
      });

      router.onMessage(ComplexMessage, (ctx) => {
        expectTypeOf(ctx.payload.nested.array).toEqualTypeOf<string[]>();
        expectTypeOf(ctx.payload.nested.optional).toEqualTypeOf<
          number | undefined
        >();
        expectTypeOf(ctx.payload.nested.union).toEqualTypeOf<string | number>();
        expectTypeOf(ctx.payload.literal).toEqualTypeOf<"test">();
      });
    });

    it("should infer extended meta properties", () => {
      const router = new WebSocketRouter();

      const CustomMessage = messageSchema(
        "CUSTOM",
        { data: z.string() },
        { roomId: z.string(), priority: z.number() },
      );

      router.onMessage(CustomMessage, (ctx) => {
        // Base meta properties
        expectTypeOf(ctx.meta.timestamp).toEqualTypeOf<number | undefined>();

        // Extended meta properties
        expectTypeOf(ctx.meta.roomId).toBeString();
        expectTypeOf(ctx.meta.priority).toBeNumber();
      });
    });
  });
});
