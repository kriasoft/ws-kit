/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { z } from "zod";

/**
 * Base schema for message metadata.
 * Provides common fields that are available on all messages.
 * Can be extended for specific message types.
 */
export const MessageMetadataSchema = z.object({
  clientId: z.string().optional(),
  timestamp: z.number().int().positive().optional(),
  correlationId: z.string().optional(),
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
  "INVALID_MESSAGE_FORMAT",
  "VALIDATION_FAILED",
  "UNSUPPORTED_MESSAGE_TYPE",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * Creates a type-safe WebSocket message schema with optimized overloads.
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
): ZodObject<{
  type: z.ZodLiteral<T>;
  meta: typeof MessageMetadataSchema;
}>;

export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny> | ZodTypeAny,
>(
  messageType: T,
  payload: P,
): ZodObject<{
  type: z.ZodLiteral<T>;
  meta: typeof MessageMetadataSchema;
  payload: P extends Record<string, ZodTypeAny> ? ZodObject<P> : P;
}>;

export function messageSchema<T extends string, M extends ZodRawShape>(
  messageType: T,
  payload: undefined,
  meta: ZodObject<M>,
): ZodObject<{
  type: z.ZodLiteral<T>;
  meta: ZodObject<typeof MessageMetadataSchema.shape & M>;
}>;

export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny> | ZodTypeAny,
  M extends ZodRawShape,
>(
  messageType: T,
  payload: P,
  meta: ZodObject<M>,
): ZodObject<{
  type: z.ZodLiteral<T>;
  meta: ZodObject<typeof MessageMetadataSchema.shape & M>;
  payload: P extends Record<string, ZodTypeAny> ? ZodObject<P> : P;
}>;

export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny> | ZodTypeAny | undefined = undefined,
  M extends ZodRawShape = Record<string, never>,
>(
  messageType: T,
  payload?: P,
  meta?: ZodObject<M>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ZodObject<any> {
  const metaSchema = meta
    ? MessageMetadataSchema.extend(meta.shape)
    : MessageMetadataSchema;

  const baseSchema = {
    type: z.literal(messageType),
    meta: metaSchema,
  };

  if (payload === undefined) {
    return z.object(baseSchema);
  }

  const payloadSchema =
    payload instanceof z.ZodType
      ? payload
      : z.object(payload as Record<string, ZodTypeAny>);

  return z.object({
    ...baseSchema,
    payload: payloadSchema,
  });
}

/**
 * Standard error message schema for consistent error responses.
 */
export const ErrorMessage = messageSchema("ERROR", {
  code: ErrorCode,
  message: z.string().optional(),
  context: z.record(z.any()).optional(),
});
