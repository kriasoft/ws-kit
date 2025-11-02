// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { MessageContextMethods, ServerWebSocket } from "@ws-kit/core";
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
 * Standard error codes for type-safe error handling (per ADR-015).
 * These codes represent common error scenarios in WebSocket and RPC applications,
 * aligned with gRPC conventions.
 *
 * Terminal errors (don't auto-retry):
 * - UNAUTHENTICATED: Missing or invalid authentication
 * - PERMISSION_DENIED: Authenticated but insufficient permissions
 * - INVALID_ARGUMENT: Input validation or semantic violation
 * - FAILED_PRECONDITION: Stateful precondition not met
 * - NOT_FOUND: Resource does not exist
 * - ALREADY_EXISTS: Uniqueness or idempotency violation
 * - ABORTED: Concurrency conflict (race condition)
 *
 * Transient errors (retry with backoff):
 * - DEADLINE_EXCEEDED: RPC timed out
 * - RESOURCE_EXHAUSTED: Rate limit, quota, or buffer overflow
 * - UNAVAILABLE: Transient infrastructure error
 *
 * Server/evolution:
 * - UNIMPLEMENTED: Feature not supported or deployed
 * - INTERNAL: Unexpected server error
 * - CANCELLED: Call cancelled (client disconnect, abort)
 *
 * Reference: @ws-kit/core/error.ts#ErrorCode for internal definitions.
 * Use these codes in ctx.error() for consistent error handling.
 *
 * @example
 * ```typescript
 * ctx.error("UNAUTHENTICATED", "Invalid token");
 * ctx.error("PERMISSION_DENIED", "Insufficient permissions");
 * ctx.error("INVALID_ARGUMENT", "Email is required");
 * ctx.error("DEADLINE_EXCEEDED", "Request timed out");
 * ctx.error("NOT_FOUND", "User not found");
 * ctx.error("INTERNAL", "Database query failed");
 * ```
 */
export type RpcErrorCode =
  | "UNAUTHENTICATED" // Missing or invalid authentication
  | "PERMISSION_DENIED" // Authorization failed (after successful auth)
  | "INVALID_ARGUMENT" // Input validation or semantic violation
  | "FAILED_PRECONDITION" // Stateful precondition not met
  | "NOT_FOUND" // Resource does not exist
  | "ALREADY_EXISTS" // Uniqueness or idempotency violation
  | "ABORTED" // Concurrency conflict (race condition)
  | "DEADLINE_EXCEEDED" // RPC request timed out
  | "RESOURCE_EXHAUSTED" // Rate limit, quota, or buffer overflow
  | "UNAVAILABLE" // Transient infrastructure error (retriable)
  | "UNIMPLEMENTED" // Feature not supported or deployed
  | "INTERNAL" // Unexpected server error
  | "CANCELLED"; // Request was cancelled by client or peer

/**
 * @deprecated Use RpcErrorCode instead (renamed for clarity)
 */
export type ErrorCode = RpcErrorCode;

/**
 * Handler context with type-safe payload/meta access from schema definition.
 * Uses intersection types to add payload only when schema defines it, avoiding
 * optional payload field that would require runtime checks.
 *
 * Includes helper methods for error handling and request/response patterns:
 * - `error()`: Send type-safe error response
 * - `send()`: Send response to a single client
 *
 * @see ADR-001 - keyof check for discriminated unions
 */
export type MessageContext<
  Schema extends MessageSchemaType,
  Data extends { clientId: string },
> = MessageContextMethods<Data> & {
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
   * @param code - Standard error code (e.g., "UNAUTHENTICATED", "NOT_FOUND")
   * @param message - Human-readable error description
   * @param details - Optional error context/details
   *
   * @example
   * ```typescript
   * ctx.error("UNAUTHENTICATED", "Invalid credentials", { hint: "Check your password" });
   * ctx.error("RESOURCE_EXHAUSTED", "Too many requests");
   * ctx.error("INTERNAL", "Database error");
   * ```
   */
  error(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): void;
} & ("payload" extends keyof Schema["shape"]
    ? Schema["shape"]["payload"] extends ZodType
      ? { payload: z.infer<Schema["shape"]["payload"]> }
      : Record<string, never>
    : Record<string, never>);

export type MessageHandler<
  Schema extends MessageSchemaType,
  Data extends { clientId: string },
> = (context: MessageContext<Schema, Data>) => void | Promise<void>;

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

export interface MessageHandlerEntry<
  Data extends { clientId: string } = { clientId: string },
> {
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
