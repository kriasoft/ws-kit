// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type tests for @ws-kit/client
 *
 * Verifies:
 * - Client interface types
 * - Message handler callback signatures
 * - State transitions
 * - Error callback types
 */

import { expectTypeOf } from "bun:test";
import type {
  AnyInboundMessage,
  ClientOptions,
  ClientState,
  WebSocketClient,
} from "../../src/types.js";
import { createClient } from "../../src/index.js";

// Type: createClient returns WebSocketClient
const client = createClient({ url: "ws://localhost" });
expectTypeOf(client).toMatchTypeOf<WebSocketClient>();

// Type: client.state is ClientState
expectTypeOf(client.state).toMatchTypeOf<ClientState>();

// Type: client.isConnected is boolean
expectTypeOf(client.isConnected).toBeBoolean();

// Type: client.protocol is string
expectTypeOf(client.protocol).toBeString();

// Type: connect returns Promise<void>
expectTypeOf(client.connect).toBeFunction();
expectTypeOf(client.connect()).resolves.toBeVoid();

// Type: close returns Promise<void>
expectTypeOf(client.close).toBeFunction();
expectTypeOf(client.close()).resolves.toBeVoid();

// Type: onState callback receives ClientState
expectTypeOf(client.onState).toBeFunction();
const unsubscribeState = client.onState((state: ClientState) => {
  expectTypeOf(state).toMatchTypeOf<ClientState>();
});
expectTypeOf(unsubscribeState).toBeFunction();

// Type: onceOpen returns Promise<void>
expectTypeOf(client.onceOpen).toBeFunction();
expectTypeOf(client.onceOpen()).resolves.toBeVoid();

// Type: onUnhandled callback receives AnyInboundMessage
expectTypeOf(client.onUnhandled).toBeFunction();
const unsubUnhandled = client.onUnhandled((msg: AnyInboundMessage) => {
  expectTypeOf(msg).toMatchTypeOf<AnyInboundMessage>();
  expectTypeOf(msg.type).toBeString();
});
expectTypeOf(unsubUnhandled).toBeFunction();

// Type: onError callback receives Error and context
expectTypeOf(client.onError).toBeFunction();
const unsubError = client.onError(
  (
    error: Error,
    context: {
      type: "parse" | "validation" | "overflow" | "unknown";
      details?: unknown;
    },
  ) => {
    expectTypeOf(error).toMatchTypeOf<Error>();
    expectTypeOf(context.type).toMatchTypeOf<
      "parse" | "validation" | "overflow" | "unknown"
    >();
  },
);
expectTypeOf(unsubError).toBeFunction();

// Type: ClientOptions validation
const opts: ClientOptions = {
  url: "ws://localhost",
  protocols: ["protocol1", "protocol2"],
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: "full",
  },
  queue: "drop-newest",
  queueSize: 500,
  autoConnect: true,
  pendingRequestsLimit: 100,
  auth: {
    attach: "query",
    queryParam: "token",
    getToken: async () => "my-token",
  },
};

expectTypeOf(opts).toMatchTypeOf<ClientOptions>();
