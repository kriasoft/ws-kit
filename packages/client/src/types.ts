// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * TypeScript types for browser WebSocket client.
 * See @docs/specs/client.md for full API documentation.
 */

export type ClientState =
  | "closed" // No connection; initial state or post-disconnect
  | "connecting" // Connection attempt in progress
  | "open" // WebSocket connected, messages flow
  | "closing" // Graceful disconnect initiated
  | "reconnecting"; // Waiting during backoff delay before retry

export interface ClientOptions {
  url: string | URL;
  protocols?: string | string[];

  reconnect?: {
    enabled?: boolean; // default: true
    maxAttempts?: number; // default: Infinity
    initialDelayMs?: number; // default: 300
    maxDelayMs?: number; // default: 10_000
    jitter?: "full" | "none"; // default: "full"
  };

  queue?: "drop-oldest" | "drop-newest" | "off"; // default: "drop-newest"
  queueSize?: number; // default: 1000

  autoConnect?: boolean; // default: false

  pendingRequestsLimit?: number; // default: 1000

  auth?: {
    getToken?: () =>
      | string
      | null
      | undefined
      | Promise<string | null | undefined>;
    attach?: "query" | "protocol"; // default: "query"
    queryParam?: string; // default: "access_token"
    protocolPrefix?: string; // default: "bearer."
    protocolPosition?: "append" | "prepend"; // default: "append"
  };

  wsFactory?: (url: string | URL, protocols?: string | string[]) => WebSocket;
}

// Type helpers for schema-based operations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMessageSchema = any; // Must use any to support both Zod and Valibot schemas

export interface AnyInboundMessage {
  type: string;
  meta?: Record<string, unknown>;
  payload?: unknown;
}

// Handler type for typed message handlers
export type MessageHandler = (msg: unknown) => void;

export interface WebSocketClient {
  readonly state: ClientState;
  readonly isConnected: boolean;
  readonly protocol: string;

  connect(): Promise<void>;
  close(opts?: { code?: number; reason?: string }): Promise<void>;

  onState(cb: (state: ClientState) => void): () => void;
  onceOpen(): Promise<void>;

  on<S extends AnyMessageSchema>(
    schema: S,
    handler: MessageHandler,
  ): () => void;

  send<S extends AnyMessageSchema>(
    schema: S,
    payload: unknown,
    opts?: { meta?: Record<string, unknown>; correlationId?: string },
  ): boolean;

  request<S extends AnyMessageSchema, R extends AnyMessageSchema>(
    schema: S,
    payload: unknown,
    reply: R,
    opts?: {
      timeoutMs?: number;
      meta?: Record<string, unknown>;
      correlationId?: string;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;

  onUnhandled(cb: (msg: AnyInboundMessage) => void): () => void;

  onError(
    cb: (
      error: Error,
      context: {
        type: "parse" | "validation" | "overflow" | "unknown";
        details?: unknown;
      },
    ) => void,
  ): () => void;
}
