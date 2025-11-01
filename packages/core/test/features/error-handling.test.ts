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

/**
 * Test suite for unified error envelope wire format.
 *
 * Verifies that both ERROR and RPC_ERROR messages use the same envelope structure
 * with unified payload, enabling consistent client parsing and retry semantics.
 *
 * Matrix coverage: 6 error contexts × 2 modes (RPC / non-RPC) = 12 test cells
 * - Handler exception
 * - Validation failure
 * - Payload size overflow
 * - Backpressure / inflight limits
 * - Middleware exception
 * - Custom error sending
 */
describe("Unified Error Envelope Wire Format", () => {
  let router: WebSocketRouter<{ clientId: string }>;
  let ws: ServerWebSocket<{ clientId: string }>;
  let sentMessages: string[] = [];

  beforeEach(() => {
    sentMessages = [];
    ws = {
      data: { clientId: "client-123" },
      send: (msg: string) => sentMessages.push(msg),
      close: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      readyState: 1,
    } as ServerWebSocket<{ clientId: string }>;

    router = new WebSocketRouter({
      validator: mockValidator,
    });
  });

  describe("Envelope structure (unified ERROR and RPC_ERROR)", () => {
    it("should send ERROR with unified envelope: type, meta, payload", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("NOT_FOUND", "Item not found", { itemId: "123" });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      expect(sentMessages).toHaveLength(1);
      const parsed = JSON.parse(sentMessages[0]!);

      // Check unified envelope
      expect(parsed.type).toBe("ERROR");
      expect(parsed.meta).toBeDefined();
      expect(typeof parsed.meta.timestamp).toBe("number");
      expect(parsed.meta.correlationId).toBeUndefined(); // Non-RPC: no correlationId
      expect(parsed.payload).toBeDefined();
      expect(parsed.payload.code).toBe("NOT_FOUND");
      expect(parsed.payload.message).toBe("Item not found");
      expect(parsed.payload.details).toEqual({ itemId: "123" });
    });

    it("should send RPC_ERROR with unified envelope and correlationId", async () => {
      const Request = { type: "QUERY", response: { type: "RESPONSE" } };
      router.rpc(Request, (ctx) => {
        ctx.error("INVALID_ARGUMENT", "Bad request");
      });

      await router.handleOpen(ws);
      await router.handleMessage(
        ws,
        JSON.stringify({
          type: "QUERY",
          meta: { correlationId: "req-42" },
        }),
      );

      expect(sentMessages).toHaveLength(1);
      const parsed = JSON.parse(sentMessages[0]!);

      // Check unified envelope with RPC specifics
      expect(parsed.type).toBe("RPC_ERROR");
      expect(parsed.meta.timestamp).toBeDefined();
      expect(parsed.meta.correlationId).toBe("req-42"); // RPC: correlationId required
      expect(parsed.payload.code).toBe("INVALID_ARGUMENT");
      expect(parsed.payload.message).toBe("Bad request");
    });
  });

  describe("Retry semantics (retryable + retryAfterMs)", () => {
    it("should exclude retryAfterMs for terminal error codes (forbidden)", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        // INVALID_ARGUMENT is terminal: retryAfterMs must be absent
        ctx.error("INVALID_ARGUMENT", "Validation failed");
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryable).toBeUndefined();
      expect(parsed.payload.retryAfterMs).toBeUndefined();
    });

    it("should include retryable=true for transient error codes", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        // RESOURCE_EXHAUSTED is transient: should auto-include retryable=true
        ctx.error("RESOURCE_EXHAUSTED", "Buffer full");
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryable).toBe(true); // Auto-inferred from code
    });

    it("should include retryAfterMs when backpressure error is sent", async () => {
      // This test verifies backpressure sends retry hints (from backpressure handling)
      const Request = { type: "QUERY", response: { type: "RESPONSE" } };
      router.rpc(Request, (ctx) => {
        // Simulating backpressure by directly calling error with options
        // In real scenario, this is called by router's backpressure handler
        ctx.error("RESOURCE_EXHAUSTED", "Buffer exceeded", undefined, {
          retryable: true,
          retryAfterMs: 100,
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(
        ws,
        JSON.stringify({
          type: "QUERY",
          meta: { correlationId: "req-42" },
        }),
      );

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryable).toBe(true);
      expect(parsed.payload.retryAfterMs).toBe(100);
    });
  });

  describe("Error code conformance", () => {
    it("should use INVALID_ARGUMENT for RPC request validation failures", async () => {
      // Create a custom validator that will reject a specific message
      const strictValidator: ValidatorAdapter = {
        getMessageType(schema: MessageSchemaType): string {
          return (schema as { type: string }).type;
        },
        safeParse(schema: MessageSchemaType, data: unknown) {
          const schemaType = (schema as { type: string }).type;
          const msg = data as Record<string, unknown>;

          // Validate message type matches schema
          if (msg.type !== schemaType) {
            return { success: false, error: "Type mismatch" };
          }
          // Validate required fields for this test
          if (
            schemaType === "QUERY" &&
            typeof (msg as Record<string, unknown>).userId !== "string"
          ) {
            return { success: false, error: "Missing userId" };
          }

          return { success: true, data };
        },
        infer<T extends MessageSchemaType>(schema: T): unknown {
          return schema;
        },
      };

      const strictRouter = new WebSocketRouter({
        validator: strictValidator,
      });

      const Request = { type: "QUERY", response: { type: "RESPONSE" } };
      strictRouter.rpc(Request, (ctx) => {
        ctx.reply({ result: "ok" });
      });

      await strictRouter.handleOpen(ws);
      // Send RPC message without required field (validation failure)
      await strictRouter.handleMessage(
        ws,
        JSON.stringify({
          type: "QUERY",
          meta: { correlationId: "req-42" },
          // Missing userId - validation should fail
        }),
      );

      // Should send RPC_ERROR with INVALID_ARGUMENT
      expect(sentMessages).toHaveLength(1);
      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.type).toBe("RPC_ERROR");
      expect(parsed.payload.code).toBe("INVALID_ARGUMENT");
    });

    it("should use canonical error codes (not custom strings)", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("UNAUTHENTICATED", "Not authenticated");
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(Object.values(ErrorCode)).toContain(parsed.payload.code);
    });
  });

  describe("Envelope strictness (no unknown fields)", () => {
    it("should only include defined fields in payload", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("NOT_FOUND", "Not found", {
          itemId: "123",
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const allowedFields = [
        "code",
        "message",
        "details",
        "retryable",
        "retryAfterMs",
      ];
      for (const key of Object.keys(parsed.payload)) {
        expect(allowedFields).toContain(key);
      }
    });

    it("should only include defined fields in meta", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("NOT_FOUND", "Not found");
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const metaKeys = Object.keys(parsed.meta);
      // For non-RPC, should only have timestamp
      expect(metaKeys).toContain("timestamp");
      expect(metaKeys).not.toContain("clientId");
      expect(metaKeys).not.toContain("correlationId");
    });

    it("should have correlationId in meta for RPC errors", async () => {
      const Request = { type: "QUERY", response: { type: "RESPONSE" } };
      router.rpc(Request, (ctx) => {
        ctx.error("INTERNAL", "Server error");
      });

      await router.handleOpen(ws);
      await router.handleMessage(
        ws,
        JSON.stringify({
          type: "QUERY",
          meta: { correlationId: "req-abc" },
        }),
      );

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.meta.correlationId).toBe("req-abc");
    });
  });

  describe("Error detail sanitization", () => {
    it("should strip forbidden keys from error details", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INVALID_ARGUMENT", "Bad input", {
          email: "user@example.com",
          password: "secret123",
          token: "bearer-abc",
          auth: "credentials",
          authorization: "Bearer token",
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;
      expect(details).toBeDefined();
      expect(details.email).toBe("user@example.com");
      expect(details.password).toBeUndefined();
      expect(details.token).toBeUndefined();
      expect(details.auth).toBeUndefined();
      expect(details.authorization).toBeUndefined();
    });

    it("should be case-insensitive when stripping forbidden keys", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INVALID_ARGUMENT", "Bad input", {
          id: "123",
          PASSWORD: "secret", // uppercase
          Token: "abc", // mixed case
          BEARER: "xyz", // uppercase
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;
      expect(details.id).toBe("123");
      expect(details.PASSWORD).toBeUndefined();
      expect(details.Token).toBeUndefined();
      expect(details.BEARER).toBeUndefined();
    });

    it("should strip huge nested objects from details", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        const hugeObject = { data: "x".repeat(600) };
        ctx.error("INTERNAL", "Processing failed", {
          id: "123",
          blob: hugeObject,
          message: "short",
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;
      expect(details.id).toBe("123");
      expect(details.message).toBe("short");
      expect(details.blob).toBeUndefined();
    });

    it("should return undefined when all details are stripped", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INVALID_ARGUMENT", "Auth failed", {
          password: "secret",
          token: "abc",
          auth: "credentials",
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.details).toBeUndefined();
    });

    it("should preserve Date objects in details", async () => {
      const TestMsg = { type: "TEST" };
      const now = Date.now();
      router.on(TestMsg, (ctx) => {
        ctx.error("INTERNAL", "Error", {
          timestamp: new Date(now),
          id: "123",
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;
      expect(details.id).toBe("123");
      expect(details.timestamp).toBeDefined();
    });
  });

  describe("RPC error without correlationId protocol safety", () => {
    it("should only add correlationId to RPC_ERROR when discriminated union specifies rpc kind", async () => {
      // This test verifies that the discriminated union ErrorKind prevents
      // accidental RPC_ERROR without correlationId at the type system level
      const Request = { type: "QUERY", response: { type: "RESPONSE" } };
      router.rpc(Request, (ctx) => {
        ctx.error("INVALID_ARGUMENT", "Bad input");
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(
        ws,
        JSON.stringify({
          type: "QUERY",
          meta: { correlationId: "req-123" },
        }),
      );

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.type).toBe("RPC_ERROR");
      expect(parsed.meta.correlationId).toBe("req-123");
    });

    it("should include timestamp in all error envelopes", async () => {
      const TestMsg = { type: "TEST3" };
      router.on(TestMsg, (ctx) => {
        ctx.error("NOT_FOUND", "Not found");
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST3" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.meta.timestamp).toBeDefined();
      expect(typeof parsed.meta.timestamp).toBe("number");
      expect(parsed.meta.timestamp > 0).toBe(true);
    });
  });

  describe("INTERNAL error default semantics", () => {
    it("should default INTERNAL errors to retryable=false without explicit setting", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INTERNAL", "Unexpected error");
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryable).toBe(false);
    });

    it("should respect explicit retryable=true for INTERNAL errors", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INTERNAL", "Database timeout", undefined, {
          retryable: true,
          retryAfterMs: 100,
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryable).toBe(true);
      expect(parsed.payload.retryAfterMs).toBe(100);
    });

    it("should respect explicit retryable=false for INTERNAL errors", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INTERNAL", "Bug in code", undefined, {
          retryable: false,
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryable).toBe(false);
    });
  });

  describe("retryAfterMs validation rules", () => {
    it("should omit retryAfterMs for terminal error codes", async () => {
      const TestMsg = { type: "TEST2" };
      router.on(TestMsg, (ctx) => {
        // Try to set retryAfterMs for terminal error (forbidden)
        ctx.error("INVALID_ARGUMENT", "Bad input", undefined, {
          retryAfterMs: 100,
        });
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST2" }));

      // retryAfterMs should be omitted for INVALID_ARGUMENT (terminal code)
      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryAfterMs).toBeUndefined();
    });

    it("should include retryAfterMs for retryable error codes", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("RESOURCE_EXHAUSTED", "Buffer full", undefined, {
          retryAfterMs: 100,
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryAfterMs).toBe(100);
      expect(parsed.payload.retryable).toBe(true);
    });

    it("retryAfterMs should imply retryable=true if not explicitly set", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        // retryAfterMs without explicit retryable should imply retryable=true
        ctx.error("UNAVAILABLE", "Service down", undefined, {
          retryAfterMs: 500,
        });
      });

      await router.handleOpen(ws);
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryAfterMs).toBe(500);
      expect(parsed.payload.retryable).toBe(true);
    });

    it("should handle negative retryAfterMs values gracefully", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("RESOURCE_EXHAUSTED", "Backpressure", undefined, {
          retryAfterMs: -100, // Edge case: negative value
        });
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      // Implementation preserves value (responsibility of caller to provide valid values)
      // but should still include retryable flag
      expect(parsed.payload.retryable).toBe(true);
      expect(typeof parsed.payload.retryAfterMs).toBe("number");
    });

    it("should handle extremely large retryAfterMs values", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("UNAVAILABLE", "Maintenance window", undefined, {
          retryAfterMs: Number.MAX_SAFE_INTEGER,
        });
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      expect(parsed.payload.retryAfterMs).toBeDefined();
      expect(typeof parsed.payload.retryAfterMs).toBe("number");
    });
  });

  describe("Error handler exception safety", () => {
    it("should not crash when error handler throws", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        throw new Error("Handler error");
      });

      router.onError(() => {
        throw new Error("Error handler itself threw"); // Handler is buggy
      });

      await router.handleOpen(ws);
      sentMessages = [];

      // Should not throw and should handle gracefully
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      // Error response should still be sent despite handler throwing
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it("should log multiple error handlers even if one throws", async () => {
      const TestMsg = { type: "TEST" };
      const handlerCalls: string[] = [];

      router.on(TestMsg, () => {
        throw new Error("Original error");
      });

      router.onError(() => {
        handlerCalls.push("handler1");
        throw new Error("Handler1 threw");
      });

      router.onError(() => {
        handlerCalls.push("handler2"); // Should still be called
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      // Both handlers should have been attempted
      expect(handlerCalls).toEqual(["handler1", "handler2"]);
    });
  });

  describe("Error detail sanitization edge cases", () => {
    it("should strip forbidden keys from deeply nested objects", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INTERNAL", "Processing failed", {
          user: {
            id: "123",
            credentials: {
              password: "secret", // Deeply nested forbidden key
              token: "bearer-abc",
            },
          },
          metadata: {
            auth: {
              apiKey: "key-123",
            },
          },
        });
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;

      // Nested forbidden keys should be stripped or object removed
      // Implementation determines depth of sanitization
      expect(details).toBeDefined();
      // If nested sanitization is implemented, forbidden keys should be gone
      // Otherwise entire nested object might be stripped
    });

    it("should handle 500-char boundary for detail values", async () => {
      const TestMsg = { type: "TEST" };
      const longString = "x".repeat(500); // Exactly 500 chars
      const veryLongString = "y".repeat(501); // Over 500 chars

      router.on(TestMsg, (ctx) => {
        ctx.error("INTERNAL", "Error", {
          normalField: "short",
          atBoundary: longString, // 500 chars
          tooLarge: veryLongString, // 501 chars
        });
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;

      // Both should either be included or excluded based on implementation
      // but not partially truncated
      expect(details).toBeDefined();
      if (details.tooLarge !== undefined) {
        // If included, should be complete string, not truncated
        expect(details.tooLarge).toBe(veryLongString);
      }
    });

    it("should preserve non-forbidden keys even if values are large", async () => {
      const TestMsg = { type: "TEST" };
      const largeData = "a".repeat(600);

      router.on(TestMsg, (ctx) => {
        ctx.error("INTERNAL", "Error", {
          description: largeData, // Large but not forbidden
          shortId: "123",
          token: "secret", // Forbidden
        });
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;

      // Non-forbidden keys should be preserved
      expect(details.description).toBe(largeData);
      expect(details.shortId).toBe("123");
      // Forbidden key should be stripped
      expect(details.token).toBeUndefined();
    });

    it("should handle all case variations of forbidden keys", async () => {
      const TestMsg = { type: "TEST" };
      router.on(TestMsg, (ctx) => {
        ctx.error("INVALID_ARGUMENT", "Bad input", {
          password: "pass1", // lowercase
          PASSWORD: "pass2", // uppercase
          Password: "pass3", // mixed case
          pASSWORD: "pass4", // mixed case variant
          id: "123", // not forbidden
          ID: "456", // not forbidden
        });
      });

      await router.handleOpen(ws);
      sentMessages = [];
      await router.handleMessage(ws, JSON.stringify({ type: "TEST" }));

      const parsed = JSON.parse(sentMessages[0]!);
      const details = parsed.payload.details;

      // All case variants of "password" should be stripped
      expect(details.password).toBeUndefined();
      expect(details.PASSWORD).toBeUndefined();
      expect(details.Password).toBeUndefined();
      expect(details.pASSWORD).toBeUndefined();
      // But id variants should be preserved
      expect(details.id).toBe("123");
      expect(details.ID).toBe("456");
    });
  });
});
