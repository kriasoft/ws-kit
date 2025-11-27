// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Typed WebSocket client adapter for Zod schemas.
 *
 * Provides full type inference for message handlers via type override pattern.
 * Zero runtime overhead - pure type-level wrapper around generic client.
 */

import type {
  InferMessage,
  InferMeta,
  InferPayload,
  MessageSchema as ZodMessageSchema,
} from "@ws-kit/zod";
import { createClient as createGenericClient } from "../../src/index.js";
import type {
  AnyInboundMessage,
  ClientOptions,
  ClientState,
  WebSocketClient,
} from "../../src/types.js";

// Re-export base types and error classes
export type {
  InferMessage,
  InferMeta,
  InferPayload,
  MessageSchema as ZodMessageSchema,
} from "@ws-kit/zod";
export * from "../../src/errors.js";
export * from "../../src/types.js";

// Re-export schema helpers for convenience
export { message, rpc, z } from "@ws-kit/zod";

/**
 * Options for send() method with typed meta field inference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface SendOptions<S extends any = ZodMessageSchema> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: InferMeta<any>;
  correlationId?: string;
}

/**
 * Options for request() method with typed meta field inference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface RequestOptions<
  S extends any = ZodMessageSchema,
> extends SendOptions<S> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on<S extends any>(
    schema: S,
    handler: (msg: InferMessage<any>) => void,
  ): () => void;

  /**
   * Send message with payload (schema defines payload field).
   * Payload type inferred from schema, required at compile time.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send<S extends any>(
    schema: S,
    payload: InferPayload<any>,
    opts?: SendOptions<S>,
  ): InferPayload<any> extends never ? never : boolean;

  /**
   * Send message without payload (schema has no payload field).
   * Payload parameter omitted at compile time.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send<S extends any>(
    schema: S,
    opts?: SendOptions<S>,
  ): InferPayload<any> extends never ? boolean : never;

  /**
   * Request/response with typed reply (with payload).
   * Payload type inferred from schema, required at compile time.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request<S extends any, R extends any>(
    schema: S,
    payload: InferPayload<any>,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferPayload<any> extends never ? never : Promise<InferMessage<any>>;

  /**
   * Request/response with typed reply (no payload).
   * Payload parameter omitted at compile time.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request<S extends any, R extends any>(
    schema: S,
    reply: R,
    opts?: RequestOptions<S>,
  ): InferPayload<any> extends never ? Promise<InferMessage<any>> : never;

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
