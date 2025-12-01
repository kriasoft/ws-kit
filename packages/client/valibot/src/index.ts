// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Typed WebSocket client adapter for Valibot schemas.
 *
 * Provides full type inference for message handlers via type override pattern.
 * Zero runtime overhead - pure type-level wrapper around generic client.
 */

import type { MessageSchema as ValibotMessageSchema } from "@ws-kit/valibot";
import { createClient as createGenericClient } from "@ws-kit/client";
import type {
  AnyInboundMessage,
  ClientOptions,
  ClientState,
  WebSocketClient,
} from "@ws-kit/client";

// Re-export base types and error classes
export type {
  InferMessage,
  InferMeta,
  InferPayload,
  MessageSchema as ValibotMessageSchema,
} from "@ws-kit/valibot";
export * from "@ws-kit/client";

import type { GenericSchema, InferOutput } from "valibot";

/** @internal - Default meta type for Valibot schemas */
interface DefaultValibotMeta {
  timestamp?: number;
  correlationId?: string;
}

/** @internal - Extract meta type from branded schema, falling back to default */
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
type InferValibotMeta<S> = S extends {
  readonly [K: symbol]: { readonly meta: infer M };
}
  ? M
  : DefaultValibotMeta;

/** @internal - Extract payload type from Valibot schema */
type InferValibotPayload<S> = S extends {
  readonly __valibot_payload: infer P;
}
  ? P extends undefined
    ? never
    : P extends Record<string, GenericSchema>
      ? {
          [K in keyof P]: P[K] extends GenericSchema
            ? InferOutput<P[K]>
            : never;
        }
      : P extends GenericSchema
        ? InferOutput<P>
        : never
  : never;

/** @internal - Extract message type from Valibot schema, preserving branded meta */
type InferValibotMessage<S> = S extends {
  readonly __descriptor: { readonly messageType: infer T };
  readonly __valibot_payload: infer P;
}
  ? P extends undefined
    ? { type: T; meta: InferValibotMeta<S> }
    : {
        type: T;
        meta: InferValibotMeta<S>;
        payload: InferValibotPayloadShape<P>;
      }
  : S extends { readonly __descriptor: { readonly messageType: infer T } }
    ? { type: T; meta: InferValibotMeta<S> }
    : never;

/** @internal */
type InferValibotPayloadShape<P> =
  P extends Record<string, GenericSchema>
    ? { [K in keyof P]: P[K] extends GenericSchema ? InferOutput<P[K]> : never }
    : P extends GenericSchema
      ? InferOutput<P>
      : never;

// Re-export schema helpers for convenience
export { message, rpc, v } from "@ws-kit/valibot";

/**
 * Options for send() method with typed meta field inference.
 * Meta is required if schema defines custom meta fields beyond standard ones.
 */
type SendOptions<S> =
  DefaultValibotMeta extends InferValibotMeta<S>
    ? { meta?: InferValibotMeta<S>; correlationId?: string }
    : { meta: InferValibotMeta<S>; correlationId?: string };

/**
 * Options for request() method with typed meta field inference.
 */
type RequestOptions<S> = SendOptions<S> & {
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Typed WebSocket client interface with Valibot schema inference.
 *
 * Overrides generic client methods to provide full type safety:
 * - on(): Handler receives InferMessage<S> (typed msg with payload/meta)
 * - send(): Payload conditional typing via overloads
 * - request(): Returns Promise<InferMessage<R>>
 */
export interface ValibotWebSocketClient extends Omit<
  WebSocketClient,
  "on" | "send" | "request"
> {
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
    handler: (msg: InferValibotMessage<S>) => void,
  ): () => void;

  /**
   * Send message with payload (schema defines payload field).
   * Payload type inferred from schema, required at compile time.
   */
  send<S extends ValibotMessageSchema>(
    schema: S,
    payload: InferValibotPayload<S>,
    opts?: SendOptions<S>,
  ): InferValibotPayload<S> extends never ? never : boolean;

  /**
   * Send message without payload (schema has no payload field).
   * Payload parameter omitted at compile time.
   */
  send<S extends ValibotMessageSchema>(
    schema: S,
    opts?: SendOptions<S>,
  ): InferValibotPayload<S> extends never ? boolean : never;

  /**
   * Request/response with typed reply (with payload).
   * Payload type inferred from schema, required at compile time.
   */
  request<S extends ValibotMessageSchema, R extends ValibotMessageSchema>(
    schema: S,
    payload: InferValibotPayload<S>,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferValibotPayload<S> extends never
    ? never
    : Promise<InferValibotMessage<R>>;

  /**
   * Request/response with typed reply (no payload).
   * Payload parameter omitted at compile time.
   */
  request<S extends ValibotMessageSchema, R extends ValibotMessageSchema>(
    schema: S,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferValibotPayload<S> extends never
    ? Promise<InferValibotMessage<R>>
    : never;

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
 * Create a typed WebSocket client with Valibot schema inference.
 *
 * Pure type cast - zero runtime overhead compared to generic client.
 * All type safety is compile-time only via TypeScript inference.
 *
 * This is the recommended function name, emphasizing that this creates
 * a WebSocket client (vs other factory patterns).
 *
 * @example
 * ```typescript
 * import { message } from "@ws-kit/valibot";
 * import { wsClient } from "@ws-kit/client/valibot";
 * import * as v from "valibot";
 *
 * const HelloOk = message("HELLO_OK", { text: v.string() });
 *
 * const client = wsClient({ url: "wss://api.example.com" });
 *
 * client.on(HelloOk, (msg) => {
 *   // ✅ msg fully typed: { type: "HELLO_OK", meta: {...}, payload: { text: string } }
 *   console.log(msg.payload.text.toUpperCase());
 * });
 * ```
 */
export function wsClient(opts: ClientOptions): ValibotWebSocketClient {
  return createGenericClient(opts) as ValibotWebSocketClient;
}
