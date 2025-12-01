// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Typed WebSocket client adapter for Zod schemas.
 *
 * Provides full type inference for message handlers via type override pattern.
 * Zero runtime overhead - pure type-level wrapper around generic client.
 */

import type { MessageSchema as ZodMessageSchema } from "@ws-kit/zod";
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
  MessageSchema as ZodMessageSchema,
} from "@ws-kit/zod";
export * from "@ws-kit/client";

import type { z as zodNs, ZodObject, ZodRawShape, ZodType } from "zod";

/** @internal - Extract meta type from branded schema, falling back to empty object */
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
type InferZodMeta<S> = S extends {
  readonly [K: symbol]: { readonly meta: infer M };
}
  ? M
  : {};

/** @internal - Extract payload type from Zod schema */
type InferZodPayload<S> = S extends { readonly __zod_payload: infer P }
  ? P extends undefined
    ? never
    : P extends ZodRawShape
      ? { [K in keyof P]: P[K] extends ZodType<infer U> ? U : never }
      : P extends ZodObject<any>
        ? zodNs.infer<P>
        : never
  : never;

/** @internal - Extract message type from Zod schema, preserving branded meta */
type InferZodMessage<S> = S extends {
  readonly __descriptor: { readonly messageType: infer T };
  readonly __zod_payload: infer P;
}
  ? P extends undefined
    ? { type: T; meta: InferZodMeta<S> }
    : { type: T; meta: InferZodMeta<S>; payload: InferZodPayloadShape<P> }
  : S extends { readonly __descriptor: { readonly messageType: infer T } }
    ? { type: T; meta: InferZodMeta<S> }
    : never;

/** @internal */
type InferZodPayloadShape<P> = P extends ZodRawShape
  ? { [K in keyof P]: P[K] extends ZodType<infer U> ? U : never }
  : P extends ZodObject<any>
    ? zodNs.infer<P>
    : never;

// Re-export schema helpers for convenience
export { message, rpc, z } from "@ws-kit/zod";

/** @internal - Check if type is an empty object (no keys) */
/**
 * Options for send() method with typed meta field inference.
 * Meta is required if schema defines custom meta fields.
 */
/** @internal - Check if meta is effectively empty (no keys) */
type IsMetaEmpty<S> = keyof InferZodMeta<S> extends never ? true : false;

/**
 * Options for send() method with typed meta field inference.
 * Meta is required if schema defines custom meta fields.
 */
type SendOptions<S> =
  IsMetaEmpty<S> extends true
    ? { meta?: Record<string, unknown>; correlationId?: string }
    : { meta: InferZodMeta<S>; correlationId?: string };

/**
 * Options for request() method with typed meta field inference.
 */
type RequestOptions<S> = SendOptions<S> & {
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Typed WebSocket client interface with Zod schema inference.
 *
 * Overrides generic client methods to provide full type safety:
 * - on(): Handler receives InferMessage<S> (typed msg with payload/meta)
 * - send(): Payload conditional typing via overloads
 * - request(): Returns Promise<InferMessage<R>>
 */
export interface ZodWebSocketClient extends Omit<
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
  on<S extends ZodMessageSchema>(
    schema: S,
    handler: (msg: InferZodMessage<S>) => void,
  ): () => void;

  /**
   * Send message with payload (schema defines payload field).
   * Payload type inferred from schema, required at compile time.
   */
  send<S extends ZodMessageSchema>(
    schema: S,
    payload: InferZodPayload<S>,
    opts?: SendOptions<S>,
  ): InferZodPayload<S> extends never ? never : boolean;

  /**
   * Send message without payload (schema has no payload field).
   * Payload parameter omitted at compile time.
   */
  send<S extends ZodMessageSchema>(
    schema: S,
    opts?: SendOptions<S>,
  ): InferZodPayload<S> extends never ? boolean : never;

  /**
   * Request/response with typed reply (with payload).
   * Payload type inferred from schema, required at compile time.
   */
  request<S extends ZodMessageSchema, R extends ZodMessageSchema>(
    schema: S,
    payload: InferZodPayload<S>,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferZodPayload<S> extends never ? never : Promise<InferZodMessage<R>>;

  /**
   * Request/response with typed reply (no payload).
   * Payload parameter omitted at compile time.
   */
  request<S extends ZodMessageSchema, R extends ZodMessageSchema>(
    schema: S,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferZodPayload<S> extends never ? Promise<InferZodMessage<R>> : never;

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
 * Create a typed WebSocket client with Zod schema inference.
 *
 * Pure type cast - zero runtime overhead compared to generic client.
 * All type safety is compile-time only via TypeScript inference.
 *
 * This is the recommended function name, emphasizing that this creates
 * a WebSocket client (vs other factory patterns).
 *
 * @example
 * ```typescript
 * import { message } from "@ws-kit/zod";
 * import { wsClient } from "@ws-kit/client/zod";
 * import { z } from "zod";
 *
 * const HelloOk = message("HELLO_OK", { text: z.string() });
 *
 * const client = wsClient({ url: "wss://api.example.com" });
 *
 * client.on(HelloOk, (msg) => {
 *   // ✅ msg fully typed: { type: "HELLO_OK", meta: {...}, payload: { text: string } }
 *   console.log(msg.payload.text.toUpperCase());
 * });
 * ```
 */
export function wsClient(opts: ClientOptions): ZodWebSocketClient {
  return createGenericClient(opts) as ZodWebSocketClient;
}
