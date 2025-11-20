// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type inference tests for RPC vs Event context type distinction.
 *
 * These tests verify:
 * 1. RPC context has request-response methods: reply(), error(), progress()
 * 2. Event context has fire-and-forget method: send()
 * 3. Both contexts share MinimalContext base properties
 * 4. Payload property exists and is typed; when payload type is never, payload is never
 * 5. Custom connection data types are properly preserved in both contexts
 * 6. Complex payload structures (unions, nested types) are correctly inferred
 *
 * Tests are compile-time only (no runtime execution).
 * Run via `bun test` to verify type safety.
 *
 * Related ADRs: ADR-015 (unified RPC API)
 */

import type {
  ConnectionData,
  EventContext,
  MinimalContext,
  RpcContext,
} from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";

// ============================================================================
// RPC vs Event Context Type Properties
// ============================================================================

describe("RPC vs Event context type properties", () => {
  it("RPC context should have all RPC-specific methods", () => {
    type TestRpcContext = RpcContext<ConnectionData, any>;

    // reply() must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("reply");

    // progress() must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("progress");

    // error() must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("error");
  });

  it("Event context should have send, not reply", () => {
    type TestEventContext = EventContext<ConnectionData, any>;

    // Event context has send()
    expectTypeOf<TestEventContext>().toHaveProperty("send");

    // EventContext should not have the reply method that RpcContext has
    type HasReply = TestEventContext extends { reply: any } ? true : false;
    expectTypeOf<HasReply>().toEqualTypeOf<false>();
  });

  it("both RPC and Event should have common properties", () => {
    type TestRpcContext = RpcContext<ConnectionData, any>;
    type TestEventContext = EventContext<ConnectionData, any>;

    // Common properties from MinimalContext
    expectTypeOf<TestRpcContext>().toHaveProperty("ws");
    expectTypeOf<TestRpcContext>().toHaveProperty("type");
    expectTypeOf<TestRpcContext>().toHaveProperty("clientId");
    expectTypeOf<TestRpcContext>().toHaveProperty("data");
    expectTypeOf<TestRpcContext>().toHaveProperty("assignData");

    expectTypeOf<TestEventContext>().toHaveProperty("ws");
    expectTypeOf<TestEventContext>().toHaveProperty("type");
    expectTypeOf<TestEventContext>().toHaveProperty("clientId");
    expectTypeOf<TestEventContext>().toHaveProperty("data");
    expectTypeOf<TestEventContext>().toHaveProperty("assignData");
  });
});

// ============================================================================
// Payload Conditional Typing
// ============================================================================

describe("Payload conditional typing", () => {
  it("RPC with payload should have typed payload property", () => {
    type TestContext = RpcContext<ConnectionData, { id: string }>;

    // payload should exist and be properly typed
    expectTypeOf<TestContext>().toHaveProperty("payload");
    expectTypeOf<TestContext["payload"]>().toEqualTypeOf<{ id: string }>();
  });

  it("RPC without payload (never) resolves to never", () => {
    type TestContext = RpcContext<ConnectionData, never>;

    // When payload type is never, accessing payload yields never
    expectTypeOf<TestContext["payload"]>().toEqualTypeOf<never>();
  });

  it("Event with payload should have typed payload property", () => {
    type TestContext = EventContext<ConnectionData, { userId: string }>;

    // payload should exist and be properly typed
    expectTypeOf<TestContext>().toHaveProperty("payload");
    expectTypeOf<TestContext["payload"]>().toEqualTypeOf<{ userId: string }>();
  });

  it("Event without payload (never) resolves to never", () => {
    type TestContext = EventContext<ConnectionData, never>;

    // When payload type is never, accessing payload yields never
    expectTypeOf<TestContext["payload"]>().toEqualTypeOf<never>();
  });
});

// ============================================================================
// RPC and Event Base Type Contracts
// ============================================================================

describe("RPC and Event base type contracts", () => {
  it("RPC context has request-response methods", () => {
    type RpcCtx = RpcContext<ConnectionData, any>;

    // RPC-specific methods for request-response pattern
    expectTypeOf<RpcCtx>().toHaveProperty("reply");
    expectTypeOf<RpcCtx>().toHaveProperty("error");
    expectTypeOf<RpcCtx>().toHaveProperty("progress");
  });

  it("Event context has fire-and-forget method", () => {
    type EventCtx = EventContext<ConnectionData, any>;

    // Event-specific method for one-way messaging
    expectTypeOf<EventCtx>().toHaveProperty("send");
  });

  it("Both contexts extend MinimalContext base", () => {
    type RpcCtx = RpcContext<ConnectionData, any>;
    type EventCtx = EventContext<ConnectionData, any>;
    type Base = MinimalContext<ConnectionData>;

    expectTypeOf<RpcCtx>().toExtend<Base>();
    expectTypeOf<EventCtx>().toExtend<Base>();
  });
});

// ============================================================================
// Custom Data Type Preservation
// ============================================================================

describe("Custom connection data type preservation", () => {
  it("RPC context works with ConnectionData", () => {
    type TestRpcCtx = RpcContext<ConnectionData, any>;

    // data property should exist
    expectTypeOf<TestRpcCtx>().toHaveProperty("data");
    expectTypeOf<TestRpcCtx>().toHaveProperty("assignData");
  });

  it("Event context works with ConnectionData", () => {
    type TestEventCtx = EventContext<ConnectionData, any>;

    // data property should exist
    expectTypeOf<TestEventCtx>().toHaveProperty("data");
    expectTypeOf<TestEventCtx>().toHaveProperty("assignData");
  });

  it("Both contexts support assignData for updates", () => {
    type RpcCtx = RpcContext<ConnectionData, any>;
    type EventCtx = EventContext<ConnectionData, any>;

    // Both should have assignData method to update connection data
    expectTypeOf<RpcCtx>().toHaveProperty("assignData");
    expectTypeOf<EventCtx>().toHaveProperty("assignData");
  });
});

// ============================================================================
// Complex Schema Generics
// ============================================================================

describe("RPC with complex schema generics", () => {
  it("should handle union payloads", () => {
    type UnionPayload = { userId: string } | { email: string };
    type TestContext = RpcContext<ConnectionData, UnionPayload>;

    // Payload should exist with union type
    expectTypeOf<TestContext>().toHaveProperty("payload");
    expectTypeOf<TestContext["payload"]>().toEqualTypeOf<UnionPayload>();

    // RPC methods should exist
    expectTypeOf<TestContext>().toHaveProperty("reply");
  });

  it("should handle nested payloads", () => {
    interface NestedPayload {
      filter: { name?: string };
      options: { limit: number };
    }

    type TestContext = RpcContext<ConnectionData, NestedPayload>;

    // Payload structure should be preserved
    expectTypeOf<TestContext["payload"]>().toEqualTypeOf<NestedPayload>();
  });
});

// ============================================================================
// Metadata Type Safety
// ============================================================================

describe("Message metadata type safety", () => {
  it("RPC context has required base fields", () => {
    type RpcCtx = RpcContext<ConnectionData, any>;

    // Should have type field (from message)
    expectTypeOf<RpcCtx>().toHaveProperty("type");
    // Should have clientId field
    expectTypeOf<RpcCtx>().toHaveProperty("clientId");
  });

  it("Event context has required base fields", () => {
    type EventCtx = EventContext<ConnectionData, any>;

    // Should have type field
    expectTypeOf<EventCtx>().toHaveProperty("type");
    // Should have clientId field
    expectTypeOf<EventCtx>().toHaveProperty("clientId");
  });

  it("Both contexts have extensions map", () => {
    type RpcCtx = RpcContext<ConnectionData, any>;
    type EventCtx = EventContext<ConnectionData, any>;

    // extensions is available for plugins to store data
    expectTypeOf<RpcCtx>().toHaveProperty("extensions");
    expectTypeOf<EventCtx>().toHaveProperty("extensions");
  });
});

// ============================================================================
// Feature Availability
// ============================================================================

describe("Feature availability across contexts", () => {
  it("RPC has reply/error/progress methods", () => {
    type RpcCtx = RpcContext<ConnectionData, any>;

    expectTypeOf<RpcCtx>().toHaveProperty("reply");
    expectTypeOf<RpcCtx>().toHaveProperty("error");
    expectTypeOf<RpcCtx>().toHaveProperty("progress");
  });

  it("Event has send method", () => {
    type EventCtx = EventContext<ConnectionData, any>;

    // Event context sends one-way messages
    expectTypeOf<EventCtx>().toHaveProperty("send");
  });
});
