// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "@ws-kit/core";
import type { ZodObject, ZodType } from "zod";
import { z, ZodLiteral } from "zod";

/**
 * Type-safe function for sending validated messages through WebSocket.
 * Extracts payload/meta types from ZodObject shape for compile-time validation.
 */
export type SendFunction = <Schema extends MessageSchemaType>(
  schema: Schema,
  data: Schema["shape"] extends { payload: infer P }
    ? P extends ZodType
      ? z.infer<P>
      : unknown
    : unknown,
  meta?: z.infer<Schema["shape"]["meta"]>,
) => void;

/**
 * Standard error codes for type-safe error handling.
 * These codes represent common error scenarios in WebSocket applications.
 *
 * Reference: @ws-kit/core/error.ts#ErrorCode for internal error definitions.
 * Use these codes in ctx.error() for consistent error handling.
 *
 * @example
 * ```typescript
 * ctx.error("AUTH_ERROR", "Invalid credentials", { hint: "Check your password" });
 * ctx.error("RATE_LIMIT", "Too many requests");
 * ctx.error("INTERNAL_ERROR", "Database query failed");
 * ```
 */
export type ErrorCode =
  | "VALIDATION_ERROR" // Message failed schema validation
  | "AUTH_ERROR" // Authentication failed
  | "INTERNAL_ERROR" // Server-side error occurred
  | "NOT_FOUND" // Requested resource not found
  | "RATE_LIMIT"; // Rate limit exceeded

/**
 * Handler context with type-safe payload/meta access from schema definition.
 * Uses intersection types to add payload only when schema defines it, avoiding
 * optional payload field that would require runtime checks.
 *
 * Includes helper methods for error handling and request/response patterns:
 * - `error()`: Send type-safe error response
 * - `reply()`: Send response (semantically clearer than send() for request/response)
 *
 * @see ADR-001 - keyof check for discriminated unions
 */
export type MessageContext<Schema extends MessageSchemaType, Data> = {
  /** WebSocket connection with custom data */
  ws: ServerWebSocket<Data>;
  /** Message type literal from schema */
  type: Schema["shape"]["type"]["value"];
  /** Message metadata inferred from schema */
  meta: z.infer<Schema["shape"]["meta"]>;
  /** Server receive timestamp (milliseconds since epoch) - authoritative for server logic */
  receivedAt: number;
  /** Type-safe send function for validated messages */
  send: SendFunction;
  /**
   * Send a type-safe error response to the client.
   *
   * Creates and sends an ERROR message with standard error structure.
   * Error code is enforced as a union of standard codes.
   *
   * @param code - Standard error code (e.g., "AUTH_ERROR", "NOT_FOUND")
   * @param message - Human-readable error description
   * @param details - Optional error context/details
   *
   * @example
   * ```typescript
   * ctx.error("AUTH_ERROR", "Invalid credentials", { hint: "Check your password" });
   * ctx.error("RATE_LIMIT", "Too many requests");
   * ctx.error("INTERNAL_ERROR", "Database error");
   * ```
   */
  error(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): void;
  /**
   * Send a response message to the client.
   *
   * Semantic alias for send() with identical type signature.
   * Use this in request/response patterns to clarify intent.
   * Functionally equivalent to ctx.send().
   *
   * @example
   * ```typescript
   * router.onMessage(QueryMessage, (ctx) => {
   *   const result = await db.query(ctx.payload.id);
   *   ctx.reply(QueryResponse, result);  // Clearer than ctx.send()
   * });
   * ```
   */
  reply: SendFunction;
  /**
   * Merge partial data into the connection's custom data object.
   *
   * Safe way to update connection data without replacing it entirely.
   * Calls Object.assign(ctx.ws.data, partial) internally.
   *
   * @param partial - Partial object to merge into ctx.ws.data
   *
   * @example
   * ```typescript
   * router.use((ctx, next) => {
   *   const user = await authenticate(ctx.payload);
   *   ctx.assignData({ userId: user.id, roles: user.roles });
   *   return next();
   * });
   * ```
   */
  assignData(partial: Partial<Data>): void;
} & ("payload" extends keyof Schema["shape"]
  ? Schema["shape"]["payload"] extends ZodType
    ? { payload: z.infer<Schema["shape"]["payload"]> }
    : Record<string, never>
  : Record<string, never>);

export type MessageHandler<Schema extends MessageSchemaType, Data> = (
  context: MessageContext<Schema, Data>,
) => void | Promise<void>;

/**
 * Base constraint for all message schemas created by messageSchema().
 * type is ZodLiteral for exact string matching during routing.
 * meta uses ZodType to allow MessageMetadataSchema extensions.
 */
export type MessageSchemaType = ZodObject<{
  type: ZodLiteral<string>;
  meta: ZodType;
  payload?: ZodType;
}>;

export interface MessageHandlerEntry<Data = unknown> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, Data>;
}

/**
 * Type helpers for client-side type inference (ADR-002).
 * Used by typed client adapters to extract message types from schemas.
 */

/**
 * Infer full inbound message type (as received by handlers).
 *
 * Includes optional timestamp/correlationId (may be present from client),
 * plus schema-defined extended meta and payload (if defined).
 *
 * @example
 * ```typescript
 * const HelloOk = messageSchema("HELLO_OK", { text: z.string() });
 * type Msg = InferMessage<typeof HelloOk>;
 * // { type: "HELLO_OK", meta: { timestamp?: number, correlationId?: string }, payload: { text: string } }
 *
 * client.on(HelloOk, (msg) => {
 *   msg.type // "HELLO_OK" (literal type)
 *   msg.meta.timestamp // number | undefined
 *   msg.payload.text // string
 * });
 * ```
 */
export type InferMessage<S extends MessageSchemaType> = z.infer<S>;

/**
 * Infer payload type from schema, or never if no payload defined.
 *
 * Returns `never` (not `undefined`) for no-payload schemas to enable
 * clean overload discrimination in send() and request() methods.
 *
 * @example
 * ```typescript
 * const WithPayload = messageSchema("MSG", { id: z.number() });
 * const NoPayload = messageSchema("PING");
 *
 * type P1 = InferPayload<typeof WithPayload>; // { id: number }
 * type P2 = InferPayload<typeof NoPayload>;   // never
 * ```
 */
export type InferPayload<S extends MessageSchemaType> =
  "payload" extends keyof S["shape"]
    ? S["shape"]["payload"] extends ZodType
      ? z.infer<S["shape"]["payload"]>
      : never
    : never;

/**
 * Infer extended meta fields for outbound messages.
 *
 * Omits auto-injected fields (timestamp, correlationId) which are provided
 * via opts.meta or opts.correlationId. Only includes schema-defined extended meta.
 *
 * Used to enforce required extended meta fields at compile time for send/request.
 *
 * @example
 * ```typescript
 * const RoomMsg = messageSchema("CHAT", { text: z.string() }, { roomId: z.string() });
 * type Meta = InferMeta<typeof RoomMsg>; // { roomId: string }
 * // timestamp and correlationId are omitted (auto-injected by client)
 *
 * client.send(RoomMsg, { text: "hi" }, { meta: { roomId: "general" } });
 * ```
 */
export type InferMeta<S extends MessageSchemaType> =
  "meta" extends keyof S["shape"]
    ? Omit<z.infer<S["shape"]["meta"]>, "timestamp" | "correlationId">
    : Record<string, never>;

/** Re-export shared types that are validator-agnostic. See: @ws-kit/core */
export type {
  CloseHandler,
  CloseHandlerContext,
  OpenHandler,
  OpenHandlerContext,
  WebSocketData,
  WebSocketRouterOptions,
} from "@ws-kit/core";
