// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Root Public API Type Tests
 *
 * Verifies the contract of @ws-kit/core's public type surface.
 * These tests are run via `tsc --noEmit` to check type safety.
 *
 * Reference: docs/specs/test-requirements.md
 */

import type {
  BrandedSchema,
  CreateRouterOptions,
  ErrorCode,
  EventContext,
  InferMeta,
  InferPayload,
  MessageDescriptor,
  MinimalContext,
  PlatformAdapter,
  PubSubAdapter,
  RpcContext,
  SendOptionsAsync,
  SendOptionsSync,
  ServerWebSocket,
  ValidatorAdapter,
  WebSocketData,
} from "@ws-kit/core";
import { WsKitError } from "@ws-kit/core";
import { describe, expect, expectTypeOf, it } from "bun:test";

// ============================================================================
// ServerWebSocket Interface
// ============================================================================

describe("ServerWebSocket", () => {
  it("should be opaque transport without data property", () => {
    type WS = ServerWebSocket;

    // Public API only includes send, close, and readyState
    expectTypeOf<WS>().toHaveProperty("send");
    expectTypeOf<WS>().toHaveProperty("close");
    expectTypeOf<WS>().toHaveProperty("readyState");

    // Data is NOT on ws; it lives in ctx.data
    // @ts-expect-error - ws.data must not be accessible
    // noinspection ES6UnusedImports
    type _AssertNoData = WS["data"];
  });
});

// ============================================================================
// WebSocketData<T>
// ============================================================================

describe("WebSocketData<T>", () => {
  it("should always include clientId as string", () => {
    type Data = WebSocketData<{ userId: string }>;

    expectTypeOf<Data>().toHaveProperty("clientId");
  });

  it("should merge custom properties", () => {
    type Data = WebSocketData<{ userId: string; token: string }>;
    const data: Data = {
      clientId: "uuid-v7",
      userId: "user-123",
      token: "secret",
    };

    expect(typeof data.clientId).toBe("string");
    expect(typeof data.userId).toBe("string");
    expect(typeof data.token).toBe("string");
  });
});

// ============================================================================
// MinimalContext (Base context)
// ============================================================================

describe("MinimalContext<TContext>", () => {
  it("should have core properties available to all handlers", () => {
    type Context = MinimalContext;

    // Always present: clientId, ws, type, data, assignData
    expectTypeOf<Context>().toHaveProperty("clientId");
    expectTypeOf<Context>().toHaveProperty("ws");
    expectTypeOf<Context>().toHaveProperty("type");
    expectTypeOf<Context>().toHaveProperty("data");
    expectTypeOf<Context>().toHaveProperty("assignData");
    expectTypeOf<Context["assignData"]>().toBeFunction();
  });

  it("should be generic over custom data type", () => {
    type CustomData = WebSocketData<{ userId: string }>;
    type Context = MinimalContext<CustomData>;

    // data is the parameterized type
    expectTypeOf<Context["data"]>().toEqualTypeOf<CustomData>();
  });

  it("should have assignData method for updating context data", () => {
    type Context = MinimalContext;
    expectTypeOf<Context["assignData"]>().toBeFunction();
  });
});

// ============================================================================
// EventContext (After validation plugin adds payload & send)
// ============================================================================

describe("EventContext<TContext, TPayload>", () => {
  it("should extend MinimalContext", () => {
    expectTypeOf<EventContext>().toExtend<MinimalContext>();
  });

  it("should add payload and send properties", () => {
    type Context = EventContext;

    expectTypeOf<Context>().toHaveProperty("payload");
    expectTypeOf<Context>().toHaveProperty("send");
  });

  it("should be generic over custom data and payload types", () => {
    type CustomData = WebSocketData<{ userId: string }>;
    interface Payload {
      message: string;
    }
    type Context = EventContext<CustomData, Payload>;

    expectTypeOf<Context["data"]>().toEqualTypeOf<CustomData>();
    expectTypeOf<Context["payload"]>().toEqualTypeOf<Payload>();
  });

  it("should infer send payload type from branded schema", () => {
    // Branded schema carries payload type via [SchemaTag]
    type PongSchema = MessageDescriptor &
      BrandedSchema<"PONG", { reply: string }, never>;

    // InferPayload extracts the payload type from branded schema
    type PayloadType = InferPayload<PongSchema>;

    expectTypeOf<PayloadType>().toEqualTypeOf<{ reply: string }>();
    expectTypeOf<PayloadType>().not.toBeAny();

    // Wrong shape should not be assignable to payload type
    type WrongShapeAssignable = { wrong: number } extends PayloadType
      ? true
      : false;
    expectTypeOf<WrongShapeAssignable>().toEqualTypeOf<false>();
  });

  it("send() overloads: void without waitFor, Promise with waitFor", () => {
    // Verify overload 1: fire-and-forget returns void
    type SendSyncCheck =
      EventContext["send"] extends <T extends MessageDescriptor>(
        schema: T,
        payload: InferPayload<T>,
        opts?: SendOptionsSync,
      ) => void
        ? true
        : false;
    expectTypeOf<SendSyncCheck>().toEqualTypeOf<true>();

    // Verify overload 2: with waitFor returns Promise<boolean>
    type SendAsyncCheck =
      EventContext["send"] extends <T extends MessageDescriptor>(
        schema: T,
        payload: InferPayload<T>,
        opts: SendOptionsAsync,
      ) => Promise<boolean>
        ? true
        : false;
    expectTypeOf<SendAsyncCheck>().toEqualTypeOf<true>();
  });
});

// ============================================================================
// RpcContext (RPC handler context)
// ============================================================================

describe("RpcContext<TContext, TPayload, TResponse>", () => {
  it("should extend MinimalContext", () => {
    expectTypeOf<RpcContext>().toExtend<MinimalContext>();
  });

  it("should add reply and progress methods for RPC", () => {
    type Context = RpcContext;

    expectTypeOf<Context>().toHaveProperty("reply");
    expectTypeOf<Context>().toHaveProperty("progress");
  });
});

// ============================================================================
// ValidatorAdapter Interface
// ============================================================================

describe("ValidatorAdapter", () => {
  it("should have validate and validateOutgoing methods", () => {
    type Adapter = ValidatorAdapter;

    expectTypeOf<Adapter>().toHaveProperty("validate");
    expectTypeOf<Adapter>().toHaveProperty("validateOutgoing");
  });
});

// ============================================================================
// PlatformAdapter Interface
// ============================================================================

describe("PlatformAdapter", () => {
  it("should have send, close, and getServerWebSocket methods", () => {
    type Adapter = PlatformAdapter;

    expectTypeOf<Adapter>().toHaveProperty("send");
    expectTypeOf<Adapter>().toHaveProperty("close");
    expectTypeOf<Adapter>().toHaveProperty("getServerWebSocket");
  });

  it("should optionally have getConnectionInfo", () => {
    type Adapter = PlatformAdapter;
    expectTypeOf<Adapter>().toHaveProperty("getConnectionInfo");
  });
});

// ============================================================================
// PubSubAdapter Interface
// ============================================================================

describe("PubSubAdapter", () => {
  it("should have publish, subscribe, unsubscribe methods", () => {
    type Adapter = PubSubAdapter;

    expectTypeOf<Adapter>().toHaveProperty("publish");
    expectTypeOf<Adapter>().toHaveProperty("subscribe");
    expectTypeOf<Adapter>().toHaveProperty("unsubscribe");
  });
});

// ============================================================================
// ErrorCode and WsKitError
// ============================================================================

describe("ErrorCode", () => {
  it("should be a string literal union type", () => {
    type Code = ErrorCode;
    expectTypeOf<Code>().toBeString();
  });
});

describe("WsKitError", () => {
  it("should extend Error", () => {
    expectTypeOf<WsKitError>().toExtend<Error>();
  });

  it("should have .code property of type ErrorCode", () => {
    type CodeOfError = WsKitError<ErrorCode>["code"];
    expectTypeOf<CodeOfError>().toEqualTypeOf<ErrorCode>();
  });
});

// ============================================================================
// Schema Type Inference Utilities
// ============================================================================

describe("InferMeta", () => {
  it("should extract meta type from branded schema", () => {
    // Branded schema with custom meta type
    type TracedSchema = MessageDescriptor &
      BrandedSchema<"TRACED", { data: number }, never, { traceId: string }>;

    type MetaType = InferMeta<TracedSchema>;
    expectTypeOf<MetaType>().toEqualTypeOf<{ traceId: string }>();
    expectTypeOf<MetaType>().not.toBeAny();
  });

  it("should return unknown for schemas without meta branding", () => {
    // Plain message descriptor without branding
    type PlainDescriptor = MessageDescriptor;
    type MetaType = InferMeta<PlainDescriptor>;
    expectTypeOf<MetaType>().toEqualTypeOf<unknown>();
  });

  it("should extract default meta type from schema with default meta", () => {
    // Schema with default (empty) meta
    type DefaultMetaSchema = MessageDescriptor &
      BrandedSchema<"MSG", { text: string }, never>;

    type MetaType = InferMeta<DefaultMetaSchema>;
    // Default meta is Record<string, unknown>
    expectTypeOf<MetaType>().toEqualTypeOf<Record<string, unknown>>();
  });
});

// ============================================================================
// CreateRouterOptions
// ============================================================================

describe("CreateRouterOptions", () => {
  it("should optionally configure heartbeat and limits", () => {
    type Options = CreateRouterOptions;

    // Optional runtime configuration (plugins added via .plugin() method)
    expectTypeOf<Options>().toHaveProperty("heartbeat");
    expectTypeOf<Options>().toHaveProperty("limits");
  });

  it("should allow heartbeat config with intervalMs and timeoutMs", () => {
    const opts: CreateRouterOptions = {
      heartbeat: {
        intervalMs: 30_000,
        timeoutMs: 5_000,
      },
    };
    expect(opts.heartbeat?.intervalMs).toBe(30_000);
  });

  it("should allow limits config with maxPending and maxPayloadBytes", () => {
    const opts: CreateRouterOptions = {
      limits: {
        maxPending: 100,
        maxPayloadBytes: 1024 * 1024,
      },
    };
    expect(opts.limits?.maxPending).toBe(100);
  });
});
