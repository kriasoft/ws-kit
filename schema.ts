/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ZodLiteral, ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { z } from "zod";

/**
 * Base schema for message metadata.
 * Provides common fields that are available on all messages.
 * Can be extended for specific message types.
 */
export const MessageMetadataSchema = z.object({
  clientId: z.string().optional(),
  timestamp: z.number().int().positive().optional(),
  corelationId: z.string().optional(),
});

/**
 * Base message schema that all specific message types extend.
 * Defines the minimum structure required for routing.
 */
export const MessageSchema = z.object({
  type: z.string(),
  meta: MessageMetadataSchema,
});

/**
 * Standard error codes for WebSocket communication.
 * Used in ErrorMessage payloads for consistent error handling.
 */
export const ErrorCode = z.enum([
  "INVALID_MESSAGE_FORMAT", // Message isn't valid JSON or lacks required structure
  "VALIDATION_FAILED", // Message failed schema validation
  "UNSUPPORTED_MESSAGE_TYPE", // No handler registered for this message type
  "AUTHENTICATION_FAILED", // Client isn't authenticated or has invalid credentials
  "AUTHORIZATION_FAILED", // Client lacks permission for the requested action
  "RESOURCE_NOT_FOUND", // Requested resource (user, room, etc.) doesn't exist
  "RATE_LIMIT_EXCEEDED", // Client is sending messages too frequently
  "INTERNAL_SERVER_ERROR", // Unexpected server error occurred
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * Standard error message schema for consistent error responses.
 */
export const ErrorMessage = messageSchema("ERROR", {
  code: ErrorCode,
  message: z.string().optional(),
  context: z.record(z.any()).optional(),
});

// -----------------------------------------------------------------------
// Type Definitions
// -----------------------------------------------------------------------

/**
 * Schema type for messages without a payload
 */
export type BaseMessageSchema<T extends string> = ZodObject<{
  type: ZodLiteral<T>;
  meta: typeof MessageMetadataSchema;
}>;

/**
 * Schema type for messages with a payload
 */
export type PayloadMessageSchema<
  T extends string,
  P extends ZodTypeAny,
> = ZodObject<{
  type: ZodLiteral<T>;
  meta: typeof MessageMetadataSchema;
  payload: P;
}>;

/**
 * Schema type for messages with custom metadata
 */
export type MessageSchemaWithCustomMeta<
  T extends string,
  M extends ZodRawShape,
> = ZodObject<{
  type: ZodLiteral<T>;
  meta: ZodObject<typeof MessageMetadataSchema.shape & M>;
}>;

/**
 * Schema type for messages with both payload and custom metadata
 */
export type PayloadMessageSchemaWithCustomMeta<
  T extends string,
  P extends ZodTypeAny,
  M extends ZodRawShape,
> = ZodObject<{
  type: ZodLiteral<T>;
  meta: ZodObject<typeof MessageMetadataSchema.shape & M>;
  payload: P;
}>;

// -----------------------------------------------------------------------
// Function Overloads
// -----------------------------------------------------------------------

/**
 * Creates a basic message schema with just type and standard metadata
 */
export function messageSchema<T extends string>(
  messageType: T,
): BaseMessageSchema<T>;

/**
 * Creates a message schema with a payload defined as an object
 */
export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny>,
>(messageType: T, payload: P): PayloadMessageSchema<T, ZodObject<P>>;

/**
 * Creates a message schema with a payload defined as a ZodType
 */
export function messageSchema<T extends string, P extends ZodTypeAny>(
  messageType: T,
  payload: P,
): PayloadMessageSchema<T, P>;

/**
 * Creates a message schema with custom metadata
 */
export function messageSchema<T extends string, M extends ZodRawShape>(
  messageType: T,
  payload: undefined,
  meta: ZodObject<M>,
): MessageSchemaWithCustomMeta<T, M>;

/**
 * Creates a message schema with an object payload and custom metadata
 */
export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny>,
  M extends ZodRawShape,
>(
  messageType: T,
  payload: P,
  meta: ZodObject<M>,
): PayloadMessageSchemaWithCustomMeta<T, ZodObject<P>, M>;

/**
 * Creates a message schema with a ZodType payload and custom metadata
 */
export function messageSchema<
  T extends string,
  P extends ZodTypeAny,
  M extends ZodRawShape,
>(
  messageType: T,
  payload: P,
  meta: ZodObject<M>,
): PayloadMessageSchemaWithCustomMeta<T, P, M>;

// -----------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------

/**
 * Creates a type-safe WebSocket message schema.
 *
 * The schema includes:
 * - A literal type field for routing messages
 * - Metadata for tracking client info and message context
 * - Optional payload for the message data
 *
 * Types are fully inferred for use with WebSocketRouter handlers.
 */
export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny> | ZodTypeAny | undefined = undefined,
  M extends ZodRawShape = Record<string, never>,
>(
  messageType: T,
  payload?: P,
  meta?: ZodObject<M>,
): P extends undefined
  ? M extends Record<string, never>
    ? BaseMessageSchema<T>
    : MessageSchemaWithCustomMeta<T, M>
  : P extends Record<string, ZodTypeAny>
    ? M extends Record<string, never>
      ? PayloadMessageSchema<T, ZodObject<P>>
      : PayloadMessageSchemaWithCustomMeta<T, ZodObject<P>, M>
    : M extends Record<string, never>
      ? PayloadMessageSchema<T, P & ZodTypeAny>
      : PayloadMessageSchemaWithCustomMeta<T, P & ZodTypeAny, M> {
  // Create base schema with type and meta
  const baseMetaSchema = meta
    ? MessageMetadataSchema.extend(meta.shape)
    : MessageMetadataSchema;

  const baseSchema = z.object({
    type: z.literal(messageType),
    meta: baseMetaSchema,
  });

  // If no payload schema provided, return without payload
  if (payload === undefined) {
    // @ts-expect-error - TypeScript can't verify complex conditional return types
    return baseSchema;
  }

  const payloadSchema =
    payload instanceof z.ZodType
      ? payload
      : z.object(payload as Record<string, ZodTypeAny>);

  // Add payload to schema
  const finalSchema = baseSchema.extend({
    payload: payloadSchema,
  });

  // @ts-expect-error - TypeScript can't verify complex conditional return types
  return finalSchema;
}
