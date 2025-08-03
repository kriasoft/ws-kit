/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import * as v from "valibot";
import type { InferOutput, ObjectSchema } from "valibot";

/**
 * Base schema for message metadata.
 * Provides common fields that are available on all messages.
 * Can be extended for specific message types.
 */
export const MessageMetadataSchema = v.object({
  clientId: v.optional(v.string()),
  timestamp: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  correlationId: v.optional(v.string()),
});

/**
 * Base message schema that all specific message types extend.
 * Defines the minimum structure required for routing.
 */
export const MessageSchema = v.object({
  type: v.string(),
  meta: MessageMetadataSchema,
});

/**
 * Standard error codes for WebSocket communication.
 * Used in ErrorMessage payloads for consistent error handling.
 */
export const ErrorCode = v.picklist([
  "INVALID_MESSAGE_FORMAT",
  "VALIDATION_FAILED",
  "UNSUPPORTED_MESSAGE_TYPE",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
]);

export type ErrorCode = InferOutput<typeof ErrorCode>;

/**
 * Creates a type-safe WebSocket message schema with Valibot.
 *
 * The schema includes:
 * - A literal type field for routing messages
 * - Metadata for tracking client info and message context
 * - Optional payload for the message data
 *
 * Types are fully inferred for use with WebSocketRouter handlers.
 */
export function messageSchema<T extends string>(
  messageType: T,
): ObjectSchema<
  {
    type: v.LiteralSchema<T, T>;
    meta: typeof MessageMetadataSchema;
  },
  undefined
>;

export function messageSchema<
  T extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends v.BaseSchema<any, any, any>,
>(
  messageType: T,
  payload: P,
): ObjectSchema<
  {
    type: v.LiteralSchema<T, T>;
    meta: typeof MessageMetadataSchema;
    payload: P;
  },
  undefined
>;

export function messageSchema<
  T extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  M extends ObjectSchema<any, any>,
>(
  messageType: T,
  payload: undefined,
  meta: M,
): ObjectSchema<
  {
    type: v.LiteralSchema<T, T>;
    meta: ObjectSchema<
      typeof MessageMetadataSchema.entries & M["entries"],
      undefined
    >;
  },
  undefined
>;

export function messageSchema<
  T extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends v.BaseSchema<any, any, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  M extends ObjectSchema<any, any>,
>(
  messageType: T,
  payload: P,
  meta: M,
): ObjectSchema<
  {
    type: v.LiteralSchema<T, T>;
    meta: ObjectSchema<
      typeof MessageMetadataSchema.entries & M["entries"],
      undefined
    >;
    payload: P;
  },
  undefined
>;

export function messageSchema<
  T extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends v.BaseSchema<any, any, any> | undefined = undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  M extends ObjectSchema<any, any> | undefined = undefined,
>(
  messageType: T,
  payload?: P,
  meta?: M,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ObjectSchema<any, any> {
  const metaSchema = meta
    ? v.object({ ...MessageMetadataSchema.entries, ...meta.entries })
    : MessageMetadataSchema;

  const baseSchema = {
    type: v.literal(messageType),
    meta: metaSchema,
  };

  if (payload === undefined) {
    return v.object(baseSchema);
  }

  return v.object({
    ...baseSchema,
    payload,
  });
}

/**
 * Standard error message schema for consistent error responses.
 */
export const ErrorMessage = messageSchema(
  "ERROR",
  v.object({
    code: ErrorCode,
    message: v.optional(v.string()),
    context: v.optional(v.record(v.string(), v.any())),
  }),
);

/**
 * Creates a validated WebSocket message from a schema.
 *
 * @example
 * ```typescript
 * const EchoSchema = messageSchema("ECHO", v.object({ text: v.string() }));
 * const message = createMessage(EchoSchema, { text: "Hello" });
 *
 * if (message.success) {
 *   ws.send(JSON.stringify(message.output));
 * }
 * ```
 */
export function createMessage<T extends MessageSchemaType>(
  schema: T,
  payload: T["entries"]["payload"] extends v.BaseSchema<
    unknown,
    unknown,
    v.BaseIssue<unknown>
  >
    ? InferOutput<T["entries"]["payload"]>
    : undefined,
  meta?: Partial<InferOutput<T["entries"]["meta"]>>,
) {
  const messageData = {
    type: schema.entries.type.literal,
    payload,
    meta: meta || {},
  };

  return v.safeParse(schema as any, messageData);
}

// Helper type for the schema type returned by messageSchema
type MessageSchemaType = ObjectSchema<
  {
    type: v.LiteralSchema<string, string>;
    meta: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
    payload?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  },
  undefined
>;
