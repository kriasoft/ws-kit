/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { z } from "zod";
import { WebSocketRouter } from "../router";
import { messageSchema } from "../schema";

// Mock the console methods to prevent noise during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = mock(() => {});
  console.warn = mock(() => {});
  console.error = mock(() => {});
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// Mock Bun's ServerWebSocket
class MockServerWebSocket {
  data: any;
  sentMessages: any[] = [];

  constructor(data: any) {
    this.data = data;
  }

  send(message: string) {
    this.sentMessages.push(JSON.parse(message));
  }

  close(_code?: number, _reason?: string) {}
}

describe("WebSocketRouter", () => {
  describe("message handling", () => {
    it("should correctly route messages to their handlers", () => {
      // Define test schemas
      const TestMessage = messageSchema("TEST_MESSAGE", {
        message: z.string(),
      });

      // Create a mock handler
      const handlerMock = mock((_ctx: any) => {});

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(TestMessage, handlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as any;

      // Call the handleMessage method directly with a valid message
      const validMessage = JSON.stringify({
        type: "TEST_MESSAGE",
        meta: { clientId: "test-client-123" },
        payload: { message: "Hello World" },
      });

      // @ts-ignore - Accessing private method for testing
      router.handleMessage(ws, validMessage);

      // Verify the handler was called
      expect(handlerMock).toHaveBeenCalled();
      expect(handlerMock.mock.calls.length).toBe(1);

      // Verify the context passed to the handler
      const context = handlerMock.mock.calls[0]?.[0];
      expect(context.ws).toBe(ws);
      expect(context.meta.clientId).toBe("test-client-123");
      expect(context.payload.message).toBe("Hello World");
    });

    it("should reject messages that fail schema validation", () => {
      // Define test schema with required field
      const RequiredFieldMessage = messageSchema("REQUIRED_FIELD", {
        requiredField: z.string(),
      });

      // Create a mock handler
      const handlerMock = mock((_ctx: any) => {});

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(RequiredFieldMessage, handlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as any;

      // Call the handleMessage method with an invalid message (missing required field)
      const invalidMessage = JSON.stringify({
        type: "REQUIRED_FIELD",
        meta: { clientId: "test-client-123" },
        payload: {}, // Missing requiredField
      });

      // @ts-ignore - Accessing private method for testing
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
      }) as any;

      // Malformed JSON
      const malformedJson = "{ this is not valid JSON }";

      // @ts-ignore - Accessing private method for testing
      router.handleMessage(ws, malformedJson);

      // Should log an error but not crash
      expect(console.error).toHaveBeenCalled();
    });

    it("should handle unknown message types gracefully", () => {
      const router = new WebSocketRouter();
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as any;

      // Unknown message type
      const unknownTypeMessage = JSON.stringify({
        type: "UNKNOWN_TYPE",
        meta: { clientId: "test-client-123" },
      });

      // @ts-ignore - Accessing private method for testing
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
      const handlerMock = mock((_ctx: any) => {});

      // Create the router and register the handler
      const router = new WebSocketRouter();
      router.onMessage(BufferMessage, handlerMock);

      // Create a mock WebSocket
      const ws = new MockServerWebSocket({
        clientId: "test-client-123",
      }) as any;

      // Create a valid message as Buffer
      const messageObj = {
        type: "BUFFER_MESSAGE",
        meta: { clientId: "test-client-123" },
        payload: { message: "Hello from Buffer" },
      };
      const bufferMessage = Buffer.from(JSON.stringify(messageObj));

      // @ts-ignore - Accessing private method for testing
      router.handleMessage(ws, bufferMessage);

      // Verify the handler was called
      expect(handlerMock).toHaveBeenCalled();
      expect(handlerMock.mock.calls.length).toBe(1);

      // Verify the context passed to the handler
      const context = handlerMock.mock.calls[0]?.[0];
      expect(context.payload.message).toBe("Hello from Buffer");
    });

    it("should handle async message handlers properly", async () => {
      // Define test schema
      const AsyncMessage = messageSchema("ASYNC_MESSAGE", {
        message: z.string(),
      });

      // Create a mock for async function
      let handlerResolved = false;
      const asyncHandlerMock = mock(async (_ctx: any) => {
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
      }) as any;

      // Send a valid message
      const validMessage = JSON.stringify({
        type: "ASYNC_MESSAGE",
        meta: { clientId: "test-client-123" },
        payload: { message: "Async Hello" },
      });

      // @ts-ignore - Accessing private method for testing
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
      }) as any;

      // Create a spy on console.error to verify it's called
      const errorSpy = spyOn(console, "error");

      // Send a valid message that will cause an error in the handler
      const validMessage = JSON.stringify({
        type: "ERROR_MESSAGE",
        meta: { clientId: "test-client-123" },
      });

      // @ts-ignore - Accessing private method for testing
      router.handleMessage(ws, validMessage);

      // Verify the handler was called and error was logged
      expect(errorHandlerMock).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
