// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type tests for ctx.error() helper function
 *
 * Verifies that the error helper provides:
 * - Autocomplete and type narrowing for standard error codes
 * - Literal type preservation for custom domain-specific codes
 * - Backward compatibility with existing call sites
 *
 * Reference: ADR-015 (Unified RPC API Design)
 */

import type {
  EventMessageContext,
  RpcMessageContext,
  WebSocketData,
} from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";

// ============================================================================
// EventMessageContext.error() Tests
// ============================================================================

describe("EventMessageContext.error()", () => {
  it("should accept standard error codes", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    // Standard codes should be assignable
    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ARGUMENT");
    expectTypeOf<ErrorMethod>().toBeCallableWith("NOT_FOUND");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INTERNAL");
    expectTypeOf<ErrorMethod>().toBeCallableWith("RESOURCE_EXHAUSTED");
  });

  it("should accept standard code with message", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "INVALID_ARGUMENT",
      "Invalid input",
    );
  });

  it("should accept standard code with message and details", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "NOT_FOUND",
      "User not found",
      {
        userId: "123",
      },
    );
  });

  it("should accept standard code with all options", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "RESOURCE_EXHAUSTED",
      "Rate limited",
      { limit: 100 },
      { retryable: true, retryAfterMs: 1000 },
    );
  });

  it("should accept custom literal codes", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    // Custom codes should be accepted via generic overload
    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ROOM_NAME");
    expectTypeOf<ErrorMethod>().toBeCallableWith("CUSTOM_DOMAIN_ERROR");
  });

  it("should preserve custom literal code types (compile-time)", () => {
    // This is a compile-time test only
    // Custom codes should be accepted and preserve their literal types
    type TestCustomCode = "INVALID_ROOM_NAME";
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    // Custom codes should be callable
    expectTypeOf<ErrorMethod>().toBeCallableWith("CUSTOM_CODE");
    expectTypeOf<ErrorMethod>().toBeCallableWith("CUSTOM_CODE", "message");
  });

  it("should have standard codes available for IDE autocomplete", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    // Verify all 13 standard codes are accepted
    expectTypeOf<ErrorMethod>().toBeCallableWith("UNAUTHENTICATED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("PERMISSION_DENIED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ARGUMENT");
    expectTypeOf<ErrorMethod>().toBeCallableWith("FAILED_PRECONDITION");
    expectTypeOf<ErrorMethod>().toBeCallableWith("NOT_FOUND");
    expectTypeOf<ErrorMethod>().toBeCallableWith("ALREADY_EXISTS");
    expectTypeOf<ErrorMethod>().toBeCallableWith("UNIMPLEMENTED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("CANCELLED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("DEADLINE_EXCEEDED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("RESOURCE_EXHAUSTED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("UNAVAILABLE");
    expectTypeOf<ErrorMethod>().toBeCallableWith("ABORTED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INTERNAL");
  });
});

// ============================================================================
// RpcMessageContext.error() Tests
// ============================================================================

describe("RpcMessageContext.error()", () => {
  it("should accept standard error codes", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // Standard codes should be assignable
    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ARGUMENT");
    expectTypeOf<ErrorMethod>().toBeCallableWith("NOT_FOUND");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INTERNAL");
  });

  it("should accept custom literal codes", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ROOM_ID");
    expectTypeOf<ErrorMethod>().toBeCallableWith("CUSTOM_RPC_ERROR");
  });

  it("should accept all parameter combinations", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // All combinations should be callable
    expectTypeOf<ErrorMethod>().toBeCallableWith("INTERNAL");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INTERNAL", "Server error");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INTERNAL", "Server error", {
      details: "extra",
    });
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "INTERNAL",
      "Server error",
      { details: "extra" },
      { retryable: false },
    );
  });

  it("should preserve custom RPC error code types (compile-time)", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // Custom RPC codes should be callable
    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ROOM_ID");
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "QUOTA_EXCEEDED",
      "User quota exceeded",
    );
  });

  it("should have standard codes available for IDE autocomplete", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // Verify all 13 standard codes are accepted
    expectTypeOf<ErrorMethod>().toBeCallableWith("UNAUTHENTICATED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("PERMISSION_DENIED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ARGUMENT");
    expectTypeOf<ErrorMethod>().toBeCallableWith("FAILED_PRECONDITION");
    expectTypeOf<ErrorMethod>().toBeCallableWith("NOT_FOUND");
    expectTypeOf<ErrorMethod>().toBeCallableWith("ALREADY_EXISTS");
    expectTypeOf<ErrorMethod>().toBeCallableWith("UNIMPLEMENTED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("CANCELLED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("DEADLINE_EXCEEDED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("RESOURCE_EXHAUSTED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("UNAVAILABLE");
    expectTypeOf<ErrorMethod>().toBeCallableWith("ABORTED");
    expectTypeOf<ErrorMethod>().toBeCallableWith("INTERNAL");
  });
});

// ============================================================================
// Error Code Parameter Type Tests
// ============================================================================

describe("error() code parameter type", () => {
  it("should accept ErrorCode enum values", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    // ErrorCode enum values should be callable
    expectTypeOf<ErrorMethod>().toBeCallableWith("INVALID_ARGUMENT");
    expectTypeOf<ErrorMethod>().toBeCallableWith("NOT_FOUND");
  });

  it("should accept literal string types", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // Literals that aren't standard codes should still work
    expectTypeOf<ErrorMethod>().toBeCallableWith("CUSTOM_ERROR");
    expectTypeOf<ErrorMethod>().toBeCallableWith("MY_DOMAIN_ERROR");
  });

  it("should work with custom AppData types", () => {
    type CustomData = WebSocketData<{ userId: string; role: string }>;
    type Context = EventMessageContext<any, CustomData>;
    type ErrorMethod = Context["error"];

    // Custom data types should not affect error method
    expectTypeOf<ErrorMethod>().toBeCallableWith("PERMISSION_DENIED");
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "PERMISSION_DENIED",
      "Access denied",
      {
        userId: "user-123",
      },
    );
  });
});

// ============================================================================
// Real-world Usage Pattern Tests
// ============================================================================

describe("Real-world error helper usage patterns", () => {
  it("should support validation error pattern", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    // Pattern: validation error with field info
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "INVALID_ARGUMENT",
      "Validation failed",
      {
        field: "email",
        reason: "Invalid email format",
      },
    );
  });

  it("should support auth error pattern", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // Pattern: auth error with optional details
    expectTypeOf<ErrorMethod>().toBeCallableWith("UNAUTHENTICATED");
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "PERMISSION_DENIED",
      "Insufficient permissions",
      {
        requiredRole: "admin",
      },
    );
  });

  it("should support rate limiting pattern", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // Pattern: rate limit with backoff hint
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "RESOURCE_EXHAUSTED",
      "Rate limited",
      { limit: 100, window: "1m" },
      { retryable: true, retryAfterMs: 5000 },
    );
  });

  it("should support impossible-under-policy pattern", () => {
    type Context = EventMessageContext;
    type ErrorMethod = Context["error"];

    // Pattern: operation impossible under policy
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "RESOURCE_EXHAUSTED",
      "Operation cost exceeds available capacity",
      { cost: 5000, available: 1000 },
      { retryable: false, retryAfterMs: null },
    );
  });

  it("should support custom domain error pattern", () => {
    type Context = RpcMessageContext;
    type ErrorMethod = Context["error"];

    // Pattern: custom domain-specific errors
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "ROOM_FULL",
      "Room has reached max players",
      {
        max: 10,
      },
    );
    expectTypeOf<ErrorMethod>().toBeCallableWith(
      "INVALID_GAME_STATE",
      "Game is not in playable state",
      { state: "finished" },
    );
  });
});
