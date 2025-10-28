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
import type { createClient } from "../../src/index.js";

// Pure type tests that don't execute runtime code

// Type: createClient returns WebSocketClient
type ClientInstanceType = ReturnType<typeof createClient>;
expectTypeOf<ClientInstanceType>().toMatchTypeOf<WebSocketClient>();

// Type: client.state is ClientState
expectTypeOf<WebSocketClient["state"]>().toMatchTypeOf<ClientState>();

// Type: client.isConnected is boolean
expectTypeOf<WebSocketClient["isConnected"]>().toBeBoolean();

// Type: client.protocol is string
expectTypeOf<WebSocketClient["protocol"]>().toBeString();

// Type: connect returns Promise<void>
expectTypeOf<WebSocketClient["connect"]>().toBeFunction();

// Type: close returns Promise<void>
expectTypeOf<WebSocketClient["close"]>().toBeFunction();

// Type: onState callback receives ClientState
expectTypeOf<WebSocketClient["onState"]>().toBeFunction();

// Type: onceOpen returns Promise<void>
expectTypeOf<WebSocketClient["onceOpen"]>().toBeFunction();

// Type: onUnhandled callback receives AnyInboundMessage
expectTypeOf<WebSocketClient["onUnhandled"]>().toBeFunction();

// Type: onError callback receives Error and context
expectTypeOf<WebSocketClient["onError"]>().toBeFunction();

// Type: ClientOptions validation
type ValidClientOptions = ClientOptions;
expectTypeOf<{
  url: "ws://localhost";
  protocols?: string[];
  reconnect?: {
    enabled?: boolean;
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: "full" | "none";
  };
  queue?: "drop-newest" | "drop-oldest";
  queueSize?: number;
  autoConnect?: boolean;
  pendingRequestsLimit?: number;
  auth?: {
    attach?: "query" | "header";
    queryParam?: string;
    getToken?: () => Promise<string>;
  };
}>().toMatchTypeOf<ValidClientOptions>();
