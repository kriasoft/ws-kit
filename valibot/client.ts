// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Typed WebSocket client adapter for Valibot schemas.
 *
 * Provides full type inference for message handlers via type override pattern (ADR-002).
 * Zero runtime overhead - pure type-level wrapper around generic client.
 *
 * @see specs/adrs.md#ADR-002 - Type override rationale
 * @see specs/client.md - Client API specification
 */

import { createClient as createGenericClient } from "../client/index.js";
import type {
  AnyInboundMessage,
  ClientOptions,
  ClientState,
  WebSocketClient,
} from "../client/types.js";
import type {
  InferMessage,
  InferMeta,
  InferPayload,
  MessageSchemaType as ValibotMessageSchema,
} from "./types.js";

// Re-export base types and error classes
export * from "../client/types.js";
export type {
  InferMessage,
  InferMeta,
  InferPayload,
  MessageSchemaType as ValibotMessageSchema,
} from "./types.js";

/**
 * Options for send() method with typed meta field inference.
 */
interface SendOptions<S extends ValibotMessageSchema> {
  meta?: InferMeta<S>;
  correlationId?: string;
}

/**
 * Options for request() method with typed meta field inference.
 */
interface RequestOptions<S extends ValibotMessageSchema>
  extends SendOptions<S> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Typed WebSocket client interface with Valibot schema inference.
 *
 * Overrides generic client methods to provide full type safety:
 * - on(): Handler receives InferMessage<S> (typed msg with payload/meta)
 * - send(): Payload conditional typing via overloads
 * - request(): Returns Promise<InferMessage<R>>
 *
 * @see specs/adrs.md#ADR-002 - Type override implementation pattern
 */
export interface ValibotWebSocketClient
  extends Omit<WebSocketClient, "on" | "send" | "request"> {
  readonly state: ClientState;
  readonly isConnected: boolean;
  readonly protocol: string;

  connect(): Promise<void>;
  close(opts?: { code?: number; reason?: string }): Promise<void>;

  onState(cb: (state: ClientState) => void): () => void;
  onceOpen(): Promise<void>;

  /**
   * Register typed message handler.
   * Handler receives fully typed message inferred from schema.
   */
  on<S extends ValibotMessageSchema>(
    schema: S,
    handler: (msg: InferMessage<S>) => void,
  ): () => void;

  /**
   * Send message with payload (schema defines payload field).
   * Payload type inferred from schema, required at compile time.
   */
  send<S extends ValibotMessageSchema>(
    schema: S,
    payload: InferPayload<S>,
    opts?: SendOptions<S>,
  ): InferPayload<S> extends never ? never : boolean;

  /**
   * Send message without payload (schema has no payload field).
   * Payload parameter omitted at compile time.
   */
  send<S extends ValibotMessageSchema>(
    schema: S,
    opts?: SendOptions<S>,
  ): InferPayload<S> extends never ? boolean : never;

  /**
   * Request/response with typed reply (with payload).
   * Payload type inferred from schema, required at compile time.
   */
  request<S extends ValibotMessageSchema, R extends ValibotMessageSchema>(
    schema: S,
    payload: InferPayload<S>,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferPayload<S> extends never ? never : Promise<InferMessage<R>>;

  /**
   * Request/response with typed reply (no payload).
   * Payload parameter omitted at compile time.
   */
  request<S extends ValibotMessageSchema, R extends ValibotMessageSchema>(
    schema: S,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferPayload<S> extends never ? Promise<InferMessage<R>> : never;

  /**
   * Hook for unhandled message types.
   * Receives structurally valid messages with no registered schema.
   */
  onUnhandled(cb: (msg: AnyInboundMessage) => void): () => void;

  /**
   * Hook for non-fatal internal errors.
   * Fires for: parse failures, validation failures, queue overflow.
   */
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

/**
 * Create typed WebSocket client with Valibot schema inference.
 *
 * Pure type cast - zero runtime overhead compared to generic client.
 * All type safety is compile-time only via TypeScript inference.
 *
 * @example
 * ```typescript
 * import * as v from "valibot";
 * import { createMessageSchema } from "bun-ws-router/valibot";
 * import { createClient } from "bun-ws-router/valibot/client";
 *
 * const { messageSchema } = createMessageSchema(v);
 * const HelloOk = messageSchema("HELLO_OK", { text: v.string() });
 *
 * const client = createClient({ url: "wss://api.example.com" });
 *
 * client.on(HelloOk, (msg) => {
 *   // ✅ msg fully typed: { type: "HELLO_OK", meta: {...}, payload: { text: string } }
 *   console.log(msg.payload.text.toUpperCase());
 * });
 * ```
 *
 * @see specs/client.md - Full client API documentation
 * @see specs/adrs.md#ADR-002 - Type override implementation details
 */
export function createClient(opts: ClientOptions): ValibotWebSocketClient {
  return createGenericClient(opts) as ValibotWebSocketClient;
}
