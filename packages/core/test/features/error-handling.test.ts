// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "bun:test";
import {
  WebSocketRouter,
  WsKitError,
  ErrorCode,
  type ServerWebSocket,
  type MessageSchemaType,
  type ValidatorAdapter,
} from "@ws-kit/core";

/**
 * Mock validator adapter for testing.
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
 * Test suite for WsKitError standardized error objects.
 *
 * Verifies:
 * - WsKitError creation and wrapping
 * - Structured error logging for observability tools
 * - Error handler integration with standardized errors
 * - Error payload serialization
 */
describe("WsKitError - Standardized Error Handling", () => {
  let ws: ServerWebSocket<{ clientId: string }>;

  beforeEach(() => {
    // Mock WebSocket
    ws = {
      data: { clientId: "test-client" },
      send: () => {},
      close: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      readyState: 1,
    } as ServerWebSocket<{ clientId: string }>;
  });

  describe("WsKitError.from()", () => {
    it("should create a new WsKitError with code, message, and details", () => {
      const error = WsKitError.from("INVALID_ARGUMENT", "User ID is invalid", {
        field: "userId",
        hint: "Must be a positive integer",
      });

      expect(error).toBeInstanceOf(WsKitError);
      expect(error.code).toBe("INVALID_ARGUMENT");
      expect(error.message).toBe("User ID is invalid");
      expect(error.details).toEqual({
        field: "userId",
        hint: "Must be a positive integer",
      });
      expect(error.originalError).toBeUndefined();
    });

    it("should create a WsKitError with minimal arguments", () => {
      const error = WsKitError.from("NOT_FOUND", "Resource not found");

      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).toBe("Resource not found");
      expect(error.details).toEqual({});
    });
  });

  describe("WsKitError.wrap()", () => {
    it("should wrap a regular Error preserving stack trace", () => {
      const originalError = new Error("Database connection failed");
      const wrapped = WsKitError.wrap(
        originalError,
        "UNAVAILABLE",
        "Database is unavailable",
      );

      expect(wrapped).toBeInstanceOf(WsKitError);
      expect(wrapped.code).toBe("UNAVAILABLE");
      expect(wrapped.message).toBe("Database is unavailable");
      expect(wrapped.originalError).toBe(originalError);
      expect(wrapped.originalError?.message).toBe("Database connection failed");
    });

    it("should return WsKitError as-is if already wrapped", () => {
      const original = WsKitError.from("INTERNAL", "Original error");
      const wrapped = WsKitError.wrap(original, "DIFFERENT_CODE");

      expect(wrapped).toBe(original);
    });

    it("should convert non-Error values to Error", () => {
      const wrapped = WsKitError.wrap("string error", "INTERNAL");

      expect(wrapped).toBeInstanceOf(WsKitError);
      expect(wrapped.code).toBe("INTERNAL");
      expect(wrapped.originalError).toBeInstanceOf(Error);
      expect(wrapped.originalError?.message).toBe("string error");
    });

    it("should use originalError message if not provided", () => {
      const originalError = new Error("Original message");
      const wrapped = WsKitError.wrap(originalError, "INTERNAL");

      expect(wrapped.message).toBe("Original message");
    });
  });

  describe("WsKitError.isWsKitError()", () => {
    it("should identify WsKitError instances", () => {
      const wsKitError = WsKitError.from("INVALID_ARGUMENT", "test");
      const regularError = new Error("test");

      expect(WsKitError.isWsKitError(wsKitError)).toBe(true);
      expect(WsKitError.isWsKitError(regularError)).toBe(false);
      expect(WsKitError.isWsKitError("not an error")).toBe(false);
      expect(WsKitError.isWsKitError(null)).toBe(false);
    });
  });

  describe("WsKitError.toJSON()", () => {
    it("should serialize error with all fields for logging", () => {
      const originalError = new Error("Original error message");
      originalError.stack = "Error: Original error message\n  at test.ts:1:1";

      const wsKitError = WsKitError.wrap(
        originalError,
        "INTERNAL",
        "Server error occurred",
        { context: "database" },
      );

      const json = wsKitError.toJSON();

      expect(json.code).toBe("INTERNAL");
      expect(json.message).toBe("Server error occurred");
      expect(json.details).toEqual({ context: "database" });
      // WHATWG standard: cause is in the JSON for logging
      expect(json.cause).toBeDefined();
      expect((json.cause as any)?.name).toBe("Error");
      expect((json.cause as any)?.message).toBe("Original error message");
      expect((json.cause as any)?.stack).toBe(
        "Error: Original error message\n  at test.ts:1:1",
      );
      expect(json.stack).toBeDefined();
    });

    it("should serialize error without cause when not present", () => {
      const wsKitError = WsKitError.from("INVALID_ARGUMENT", "Bad input");
      const json = wsKitError.toJSON();

      expect(json.code).toBe("INVALID_ARGUMENT");
      expect(json.message).toBe("Bad input");
      expect(json.cause).toBeUndefined();
      expect(json.stack).toBeDefined();
    });
  });

  describe("WsKitError.toPayload()", () => {
    it("should create client-safe payload without internal details", () => {
      const originalError = new Error("Database query failed");
      const wsKitError = WsKitError.wrap(
        originalError,
        ErrorCode.INTERNAL,
        "Server error",
        { field: "userId" },
      );

      const payload = wsKitError.toPayload();

      // Should include code, message, and details
      expect(payload.code).toBe(ErrorCode.INTERNAL);
      expect(payload.message).toBe("Server error");
      expect(payload.details).toEqual({ field: "userId" });

      // Should NOT include originalError or stack
      expect((payload as any).originalError).toBeUndefined();
      expect((payload as any).stack).toBeUndefined();
    });

    it("should omit details field if empty", () => {
      const wsKitError = WsKitError.from(
        ErrorCode.NOT_FOUND,
        "Resource not found",
      );
      const payload = wsKitError.toPayload();

      expect(payload.code).toBe(ErrorCode.NOT_FOUND);
      expect(payload.message).toBe("Resource not found");
      expect(payload.details).toBeUndefined();
    });
  });

  describe("Error Handler Integration", () => {
    it("should receive WsKitError in onError handler", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
      });

      let receivedError: WsKitError | null = null;

      router.onError((err) => {
        receivedError = err;
      });

      router.on({ type: "TEST" } as any, () => {
        throw new Error("Handler error");
      });

      await router.handleOpen(ws);
      // Trigger message handling which will throw
      await router.handleMessage(
        ws,
        JSON.stringify({ type: "TEST", payload: {} }),
      );

      expect(receivedError).toBeDefined();
      expect(WsKitError.isWsKitError(receivedError!)).toBe(true);
      expect(receivedError!.code).toBe("INTERNAL");
      expect(receivedError!.originalError).toBeInstanceOf(Error);
    });

    it("should pass context to error handler", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
      });

      let receivedContext: any = null;

      router.onError((err, context) => {
        receivedContext = context;
      });

      router.on({ type: "TEST" } as any, () => {
        throw new Error("Handler error");
      });

      await router.handleOpen(ws);
      await router.handleMessage(
        ws,
        JSON.stringify({ type: "TEST", payload: {} }),
      );

      expect(receivedContext).toBeDefined();
      expect(receivedContext.type).toBe("TEST");
      expect(receivedContext.ws).toBe(ws);
      expect(receivedContext.meta).toBeDefined();
    });

    it("should support multiple error handlers", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
      });

      const calls: string[] = [];

      router.onError(() => {
        calls.push("handler1");
      });

      router.onError(() => {
        calls.push("handler2");
      });

      router.on({ type: "TEST" } as any, () => {
        throw new Error("Handler error");
      });

      await router.handleOpen(ws);
      await router.handleMessage(
        ws,
        JSON.stringify({ type: "TEST", payload: {} }),
      );

      expect(calls).toEqual(["handler1", "handler2"]);
    });

    it("should suppress error response when handler returns false", async () => {
      const router = new WebSocketRouter({
        validator: mockValidator,
        autoSendErrorOnThrow: true,
      });

      let errorSent = false;

      ws.send = (message: string) => {
        const parsed = JSON.parse(message);
        if (parsed.type === "ERROR" || parsed.type === "RPC_ERROR") {
          errorSent = true;
        }
      };

      router.onError(() => {
        return false; // Suppress automatic error response
      });

      router.on({ type: "TEST" } as any, () => {
        throw new Error("Handler error");
      });

      await router.handleOpen(ws);
      await router.handleMessage(
        ws,
        JSON.stringify({ type: "TEST", payload: {} }),
      );

      // When handler returns false, error response should not be sent
      expect(errorSent).toBe(false);
    });
  });

  describe("Error Code Type Safety", () => {
    it("should support all standard error codes", () => {
      const codes: string[] = [
        ErrorCode.UNAUTHENTICATED,
        ErrorCode.PERMISSION_DENIED,
        ErrorCode.INVALID_ARGUMENT,
        ErrorCode.FAILED_PRECONDITION,
        ErrorCode.NOT_FOUND,
        ErrorCode.ALREADY_EXISTS,
        ErrorCode.ABORTED,
        ErrorCode.DEADLINE_EXCEEDED,
        ErrorCode.RESOURCE_EXHAUSTED,
        ErrorCode.UNAVAILABLE,
        ErrorCode.UNIMPLEMENTED,
        ErrorCode.INTERNAL,
        ErrorCode.CANCELLED,
      ];

      for (const code of codes) {
        const error = WsKitError.from(code, `Error: ${code}`);
        expect(error.code).toBe(code);
      }
    });
  });

  describe("Structured Logging for Observability", () => {
    it("should provide structured format for ELK/Sentry integration", () => {
      const wsKitError = WsKitError.from("INVALID_ARGUMENT", "Bad user input", {
        field: "email",
        value: "not-an-email",
      });

      const json = wsKitError.toJSON();

      // Format suitable for structured logging (ELK, Sentry, etc)
      expect(typeof json.code).toBe("string");
      expect(typeof json.message).toBe("string");
      expect(typeof json.details).toBe("object");
      expect(typeof json.stack).toBe("string");
    });

    it("should preserve stack traces for debugging", () => {
      let errorThrown: Error | null = null;
      try {
        throw new Error("Original error");
      } catch (e) {
        errorThrown = e as Error;
      }

      const wrapped = WsKitError.wrap(
        errorThrown!,
        "INTERNAL",
        "Processing failed",
      );

      // Check originalError getter for backward compat
      expect(wrapped.originalError?.stack).toContain("Original error");
      // Also check WHATWG standard cause property
      expect((wrapped.cause as any)?.stack).toContain("Original error");
      expect(wrapped.stack).toBeDefined();
      expect(wrapped.stack).toContain("WsKitError");
    });
  });
});
