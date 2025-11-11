// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type tests for @ws-kit/core
 *
 * These tests are run via `tsc --noEmit` to verify type safety.
 * They use expectTypeOf from bun:test for compile-time assertions.
 *
 * Reference: docs/specs/test-requirements.md
 */

import { describe, it, expectTypeOf } from "bun:test";
import type {
  ServerWebSocket,
  WebSocketData,
  MessageContext,
  ValidatorAdapter,
  PlatformAdapter,
  PubSub,
  RouterHooks,
  WebSocketRouterOptions,
} from "@ws-kit/core";
import { WsKitError } from "@ws-kit/core";
import type { ErrorCode } from "@ws-kit/core";
import { MemoryPubSub } from "@ws-kit/pubsub/internal";

// ============================================================================
// ServerWebSocket Interface Tests
// ============================================================================

describe("ServerWebSocket<T>", () => {
  it("should accept generic data parameter", () => {
    type CustomData = WebSocketData<{ userId: string; role: "admin" | "user" }>;
    type WS = ServerWebSocket<CustomData>;

    expectTypeOf<WS>().toHaveProperty("data");
    expectTypeOf<WS["data"]>().toMatchTypeOf<CustomData>();
  });

  it("should have required methods", () => {
    type WS = ServerWebSocket;

    expectTypeOf<WS>().toHaveProperty("send");
    expectTypeOf<WS>().toHaveProperty("close");
    expectTypeOf<WS>().toHaveProperty("subscribe");
    expectTypeOf<WS>().toHaveProperty("unsubscribe");
  });
});

// ============================================================================
// WebSocketData Tests
// ============================================================================

describe("WebSocketData<T>", () => {
  it("should always include clientId", () => {
    type Data = WebSocketData<{ userId: string }>;

    expectTypeOf<Data>().toHaveProperty("clientId");
    expectTypeOf<Data["clientId"]>().toBeString();
  });

  it("should merge custom properties", () => {
    type Data = WebSocketData<{ userId: string; token: string }>;
    const data: Data = {
      clientId: "uuid-v7",
      userId: "user-123",
      token: "secret",
    };

    expectTypeOf(data.clientId).toBeString();
    expectTypeOf(data.userId).toBeString();
  });
});

// ============================================================================
// MessageContext Tests
// ============================================================================

describe("MessageContext<TSchema, TData>", () => {
  it("should have required properties", () => {
    type Context = MessageContext;

    expectTypeOf<Context>().toHaveProperty("ws");
    expectTypeOf<Context>().toHaveProperty("type");
    expectTypeOf<Context>().toHaveProperty("meta");
    expectTypeOf<Context>().toHaveProperty("send");
  });

  it("should type ws as ServerWebSocket with generic data", () => {
    type CustomData = WebSocketData<{ userId: string }>;

    type Context = MessageContext<any, CustomData>;

    expectTypeOf<Context["ws"]>().toMatchTypeOf<ServerWebSocket<CustomData>>();
  });

  it("should have SendFunction", () => {
    type Context = MessageContext;

    expectTypeOf<Context["send"]>().toBeFunction();
    // SendFunction signature: (schema: any, data: any, meta?: any) => void
  });
});

// ============================================================================
// ValidatorAdapter Tests
// ============================================================================

describe("ValidatorAdapter", () => {
  it("should require getMessageType method", () => {
    type Adapter = ValidatorAdapter;

    expectTypeOf<Adapter>().toHaveProperty("getMessageType");
    expectTypeOf<Adapter["getMessageType"]>().toBeFunction();
  });

  it("should require safeParse method", () => {
    type Adapter = ValidatorAdapter;

    expectTypeOf<Adapter>().toHaveProperty("safeParse");
    expectTypeOf<Adapter["safeParse"]>().toBeFunction();
  });

  it("should require infer method (TypeScript only)", () => {
    type Adapter = ValidatorAdapter;

    expectTypeOf<Adapter>().toHaveProperty("infer");
    expectTypeOf<Adapter["infer"]>().toBeFunction();
  });
});

// ============================================================================
// PlatformAdapter Tests
// ============================================================================

describe("PlatformAdapter", () => {
  it("should optionally include pubsub", () => {
    type Adapter = PlatformAdapter;

    expectTypeOf<Adapter>().toHaveProperty("pubsub");
  });

  it("should optionally include getServerWebSocket method", () => {
    type Adapter = PlatformAdapter;

    expectTypeOf<Adapter>().toHaveProperty("getServerWebSocket");
  });

  it("should optionally include init and destroy methods", () => {
    type Adapter = PlatformAdapter;

    expectTypeOf<Adapter>().toHaveProperty("init");
    expectTypeOf<Adapter>().toHaveProperty("destroy");
  });
});

// ============================================================================
// PubSub Interface Tests
// ============================================================================

describe("PubSub", () => {
  it("should have publish method", () => {
    type PS = PubSub;

    expectTypeOf<PS>().toHaveProperty("publish");
    expectTypeOf<PS["publish"]>().toBeFunction();
  });

  it("should have subscribe method", () => {
    type PS = PubSub;

    expectTypeOf<PS>().toHaveProperty("subscribe");
    expectTypeOf<PS["subscribe"]>().toBeFunction();
  });

  it("should have unsubscribe method", () => {
    type PS = PubSub;

    expectTypeOf<PS>().toHaveProperty("unsubscribe");
    expectTypeOf<PS["unsubscribe"]>().toBeFunction();
  });
});

// ============================================================================
// MemoryPubSub Implementation Tests
// ============================================================================

describe("MemoryPubSub", () => {
  it("should implement PubSub interface", () => {
    const pubsub = new MemoryPubSub();

    expectTypeOf<typeof pubsub>().toMatchTypeOf<PubSub>();
  });

  it("should have publish method that returns Promise<void>", () => {
    const pubsub = new MemoryPubSub();
    const result = pubsub.publish("test", {});

    expectTypeOf(result).resolves.toBeVoid();
  });

  it("should have subscribe method with handler", () => {
    const pubsub = new MemoryPubSub();

    expectTypeOf<typeof pubsub.subscribe>().toBeFunction();
  });

  it("should have additional methods for testing", () => {
    const pubsub = new MemoryPubSub();

    expectTypeOf<typeof pubsub>().toHaveProperty("clear");
    expectTypeOf<typeof pubsub>().toHaveProperty("subscriberCount");
  });
});

// ============================================================================
// Error Code Tests
// ============================================================================

describe("ErrorCode", () => {
  it("should be a string literal union type", () => {
    type TestCode = ErrorCode;
    expectTypeOf<TestCode>().toBeString();
  });
});

// ============================================================================
// WsKitError Tests
// ============================================================================

describe("WsKitError", () => {
  it("should be an Error subclass", () => {
    expectTypeOf<WsKitError>().toMatchTypeOf<Error>();
  });
});

// ============================================================================
// RouterHooks Tests
// ============================================================================

describe("RouterHooks", () => {
  it("should have optional lifecycle hooks", () => {
    type Hooks = RouterHooks;

    expectTypeOf<Hooks>().toHaveProperty("onOpen");
    expectTypeOf<Hooks>().toHaveProperty("onClose");
    expectTypeOf<Hooks>().toHaveProperty("onAuth");
    expectTypeOf<Hooks>().toHaveProperty("onError");
  });

  it("should support custom data type", () => {
    type CustomData = WebSocketData<{ userId: string }>;
    type Hooks = RouterHooks<CustomData>;

    // Hooks should be assignable with handlers that accept CustomData

    const hooks: Hooks = {
      onOpen: (ctx) => {
        expectTypeOf(ctx.ws.data.clientId).toBeString();
        expectTypeOf(ctx.ws.data.userId).toBeString();
      },
    };
  });
});

// ============================================================================
// WebSocketRouterOptions Tests
// ============================================================================

describe("WebSocketRouterOptions", () => {
  it("should accept validator adapter", () => {
    type Options = WebSocketRouterOptions;

    expectTypeOf<Options>().toHaveProperty("validator");
  });

  it("should accept platform adapter", () => {
    type Options = WebSocketRouterOptions;

    expectTypeOf<Options>().toHaveProperty("platform");
  });

  it("should accept pubsub", () => {
    type Options = WebSocketRouterOptions;

    expectTypeOf<Options>().toHaveProperty("pubsub");
  });

  it("should accept hooks", () => {
    type Options = WebSocketRouterOptions;

    expectTypeOf<Options>().toHaveProperty("hooks");
  });

  it("should accept heartbeat config", () => {
    type Options = WebSocketRouterOptions;

    expectTypeOf<Options>().toHaveProperty("heartbeat");
  });

  it("should accept limits config", () => {
    type Options = WebSocketRouterOptions;

    expectTypeOf<Options>().toHaveProperty("limits");
  });
});

// Constants are internal and not part of the public API
