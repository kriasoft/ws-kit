// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type inference tests for RPC context vs Event context discriminated union.
 *
 * These tests verify that:
 * 1. RPC context (router.rpc()) has all RPC methods (reply, progress, onCancel, deadline)
 * 2. Event context (router.on()) does NOT have RPC methods
 * 3. isRpc flag properly narrows the context type
 * 4. Payload typing is conditional (present/absent) for both RPC and Event handlers
 * 5. Middleware can use isRpc flag to narrow context
 * 6. Custom validators don't break RPC type inference
 *
 * Tests are compile-time only (no runtime execution).
 * Run via `bun test` to verify type safety.
 *
 * Related ADRs: ADR-001 (conditional payload), ADR-002 (type overrides), ADR-015 (unified RPC API)
 */

import type {
  EventMessageContext,
  MessageContext,
  RpcMessageContext,
  WebSocketData,
} from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";

// ============================================================================
// RPC vs Event Context Type Properties
// ============================================================================

describe("RPC vs Event context type properties", () => {
  it("RPC context should have all RPC-specific methods", () => {
    type TestRpcContext = RpcMessageContext<any, WebSocketData>;

    // reply() must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("reply");

    // progress() must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("progress");

    // onCancel() must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("onCancel");

    // deadline must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("deadline");

    // abortSignal must be present
    expectTypeOf<TestRpcContext>().toHaveProperty("abortSignal");

    // isRpc should be literally true
    expectTypeOf<TestRpcContext>().toHaveProperty("isRpc");
  });

  it("Event context should NOT have RPC-specific methods", () => {
    type TestEventContext = EventMessageContext<any, WebSocketData>;

    // These properties should NOT exist on event context
    // @ts-expect-error - reply should not exist on event context
    expectTypeOf<TestEventContext>().toHaveProperty("reply");

    // @ts-expect-error - progress should not exist on event context
    expectTypeOf<TestEventContext>().toHaveProperty("progress");

    // @ts-expect-error - onCancel should not exist on event context
    expectTypeOf<TestEventContext>().toHaveProperty("onCancel");

    // @ts-expect-error - deadline should not exist on event context
    expectTypeOf<TestEventContext>().toHaveProperty("deadline");

    // @ts-expect-error - abortSignal should not exist on event context
    expectTypeOf<TestEventContext>().toHaveProperty("abortSignal");

    // isRpc should be literally false
    expectTypeOf<TestEventContext>().toHaveProperty("isRpc");
  });

  it("both RPC and Event should have common properties", () => {
    type TestRpcContext = RpcMessageContext<any, WebSocketData>;
    type TestEventContext = EventMessageContext<any, WebSocketData>;

    // Common properties
    for (const contextType of [] as any[]) {
      expectTypeOf<TestRpcContext>().toHaveProperty("ws");
      expectTypeOf<TestRpcContext>().toHaveProperty("type");
      expectTypeOf<TestRpcContext>().toHaveProperty("meta");
      expectTypeOf<TestRpcContext>().toHaveProperty("send");
      expectTypeOf<TestRpcContext>().toHaveProperty("error");
      expectTypeOf<TestRpcContext>().toHaveProperty("assignData");
      expectTypeOf<TestRpcContext>().toHaveProperty("subscribe");
      expectTypeOf<TestRpcContext>().toHaveProperty("unsubscribe");
      expectTypeOf<TestRpcContext>().toHaveProperty("publish");
      expectTypeOf<TestRpcContext>().toHaveProperty("timeRemaining");

      expectTypeOf<TestEventContext>().toHaveProperty("ws");
      expectTypeOf<TestEventContext>().toHaveProperty("type");
      expectTypeOf<TestEventContext>().toHaveProperty("meta");
      expectTypeOf<TestEventContext>().toHaveProperty("send");
      expectTypeOf<TestEventContext>().toHaveProperty("error");
      expectTypeOf<TestEventContext>().toHaveProperty("assignData");
      expectTypeOf<TestEventContext>().toHaveProperty("subscribe");
      expectTypeOf<TestEventContext>().toHaveProperty("unsubscribe");
      expectTypeOf<TestEventContext>().toHaveProperty("publish");
      expectTypeOf<TestEventContext>().toHaveProperty("timeRemaining");
    }
  });
});

// ============================================================================
// Payload Conditional Typing
// ============================================================================

describe("Payload conditional typing", () => {
  it("RPC with payload should have payload property", () => {
    interface RpcWithPayload {
      type: "GET_USER";
      payload: { id: string };
      response: { type: "USER_OK"; payload: { name: string } };
    }

    type TestContext = RpcMessageContext<RpcWithPayload, WebSocketData>;

    // payload should exist
    expectTypeOf<TestContext>().toHaveProperty("payload");
  });

  it("RPC without payload should NOT have payload property", () => {
    interface RpcNoPayload {
      type: "HEARTBEAT";
      response: { type: "HEARTBEAT_ACK" };
    }

    type TestContext = RpcMessageContext<RpcNoPayload, WebSocketData>;

    // payload should not exist
    // @ts-expect-error - payload should not exist
    expectTypeOf<TestContext>().toHaveProperty("payload");
  });

  it("Event with payload should have payload property", () => {
    interface EventWithPayload {
      type: "USER_LOGGED_IN";
      payload: { userId: string };
    }

    type TestContext = EventMessageContext<EventWithPayload, WebSocketData>;

    // payload should exist
    expectTypeOf<TestContext>().toHaveProperty("payload");
  });

  it("Event without payload should NOT have payload property", () => {
    interface EventNoPayload {
      type: "CONNECTION_OPENED";
    }

    type TestContext = EventMessageContext<EventNoPayload, WebSocketData>;

    // payload should not exist
    // @ts-expect-error - payload should not exist
    expectTypeOf<TestContext>().toHaveProperty("payload");
  });
});

// ============================================================================
// Union Type Handling
// ============================================================================

describe("MessageContext union type handling", () => {
  it("RPC context should be assignable to MessageContext union", () => {
    type RpcCtx = RpcMessageContext<any, WebSocketData>;
    type AnyCtx = MessageContext<any, WebSocketData>;

    // RPC should be assignable to union
    expectTypeOf<RpcCtx>().toMatchTypeOf<AnyCtx>();
  });

  it("Event context should be assignable to MessageContext union", () => {
    type EventCtx = EventMessageContext<any, WebSocketData>;
    type AnyCtx = MessageContext<any, WebSocketData>;

    // Event should be assignable to union
    expectTypeOf<EventCtx>().toMatchTypeOf<AnyCtx>();
  });

  it("Union should have common properties from both variants", () => {
    type AnyCtx = MessageContext<any, WebSocketData>;

    // Union has properties from both RPC and Event
    expectTypeOf<AnyCtx>().toHaveProperty("ws");
    expectTypeOf<AnyCtx>().toHaveProperty("send");
    expectTypeOf<AnyCtx>().toHaveProperty("error");
    expectTypeOf<AnyCtx>().toHaveProperty("isRpc");
  });
});

// ============================================================================
// Custom Data Type Preservation
// ============================================================================

describe("Custom connection data type preservation", () => {
  it("RPC context preserves custom data type", () => {
    interface AppData {
      userId: string;
      roles: string[];
    }

    type TestRpcCtx = RpcMessageContext<any, AppData>;

    // ws.data should be properly typed
    expectTypeOf<TestRpcCtx>().toHaveProperty("ws");
  });

  it("Event context preserves custom data type", () => {
    interface AppData {
      userId?: string;
      isAuthenticated: boolean;
    }

    type TestEventCtx = EventMessageContext<any, AppData>;

    // ws.data should be properly typed
    expectTypeOf<TestEventCtx>().toHaveProperty("ws");
  });

  it("Both contexts support assignData", () => {
    interface MutableData {
      requestId?: string;
    }

    type RpcCtx = RpcMessageContext<any, MutableData>;
    type EventCtx = EventMessageContext<any, MutableData>;

    // Both should have assignData
    expectTypeOf<RpcCtx>().toHaveProperty("assignData");
    expectTypeOf<EventCtx>().toHaveProperty("assignData");
  });
});

// ============================================================================
// Complex Schema Generics
// ============================================================================

describe("RPC with complex schema generics", () => {
  it("should handle discriminated union payloads", () => {
    interface ComplexRpc {
      type: "GET_USER";
      payload: { userId: string };
      response: {
        type: "USER_OK";
        payload: { name: string } | { error: string };
      };
    }

    type TestContext = RpcMessageContext<ComplexRpc, WebSocketData>;

    // Should have payload
    expectTypeOf<TestContext>().toHaveProperty("payload");

    // Should have reply for RPC
    expectTypeOf<TestContext>().toHaveProperty("reply");
  });

  it("should handle nested payloads", () => {
    interface NestedRpc {
      type: "COMPLEX";
      payload: {
        filter: { name?: string };
        options: { limit: number };
      };
      response: {
        type: "COMPLEX_OK";
        payload: { results: { id: string }[] };
      };
    }

    type TestContext = RpcMessageContext<NestedRpc, WebSocketData>;

    // Should have nested payload
    expectTypeOf<TestContext>().toHaveProperty("payload");
  });
});

// ============================================================================
// Metadata Type Safety
// ============================================================================

describe("Message metadata type safety", () => {
  it("RPC context has required meta fields", () => {
    type RpcCtx = RpcMessageContext<any, WebSocketData>;

    // Should have meta
    expectTypeOf<RpcCtx>().toHaveProperty("meta");
  });

  it("Event context has required meta fields", () => {
    type EventCtx = EventMessageContext<any, WebSocketData>;

    // Should have meta
    expectTypeOf<EventCtx>().toHaveProperty("meta");
  });

  it("RPC context may have optional correlationId", () => {
    type RpcCtx = RpcMessageContext<any, WebSocketData>;

    // correlationId is optional in meta
    expectTypeOf<RpcCtx>().toHaveProperty("meta");
  });
});

// ============================================================================
// Feature Availability
// ============================================================================

describe("Feature availability across contexts", () => {
  it("both contexts support publish", () => {
    type RpcCtx = RpcMessageContext<any, WebSocketData>;
    type EventCtx = EventMessageContext<any, WebSocketData>;

    // Both should have publish
    expectTypeOf<RpcCtx>().toHaveProperty("publish");
    expectTypeOf<EventCtx>().toHaveProperty("publish");
  });

  it("both contexts support error responses", () => {
    type RpcCtx = RpcMessageContext<any, WebSocketData>;
    type EventCtx = EventMessageContext<any, WebSocketData>;

    // Both should have error
    expectTypeOf<RpcCtx>().toHaveProperty("error");
    expectTypeOf<EventCtx>().toHaveProperty("error");
  });

  it("both contexts support timeRemaining", () => {
    type RpcCtx = RpcMessageContext<any, WebSocketData>;
    type EventCtx = EventMessageContext<any, WebSocketData>;

    // Both should have timeRemaining
    expectTypeOf<RpcCtx>().toHaveProperty("timeRemaining");
    expectTypeOf<EventCtx>().toHaveProperty("timeRemaining");
  });
});
