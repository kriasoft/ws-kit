/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ZodLiteral, ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { z } from "zod";

/**
 * Defines the base structure for message metadata.
 * Can be extended for specific message types.
 */
export const MessageMetadataSchema = z.object({
  clientId: z.string().optional(),
  timestamp: z.number().int().positive().optional(),
  corelationId: z.string().optional(),
});

/**
 * Defines the absolute base structure for any message.
 * Specific message schemas should extend this, typically using `z.literal` for the type.
 */
export const MessageSchema = z.object({
  type: z.string(),
  meta: MessageMetadataSchema,
});

// -----------------------------------------------------------------------
// Type Definitions
// -----------------------------------------------------------------------

/**
 * Type for a message schema with no payload
 */
export type BaseMessageSchema<T extends string> = ZodObject<{
  type: ZodLiteral<T>;
  meta: typeof MessageMetadataSchema;
}>;

/**
 * Type for a message schema with a payload
 */
export type PayloadMessageSchema<
  T extends string,
  P extends ZodTypeAny
> = ZodObject<{
  type: ZodLiteral<T>;
  meta: typeof MessageMetadataSchema;
  payload: P;
}>;

/**
 * Type for a message schema with a custom meta object
 */
export type MessageSchemaWithCustomMeta<
  T extends string,
  M extends ZodRawShape
> = ZodObject<{
  type: ZodLiteral<T>;
  meta: ZodObject<typeof MessageMetadataSchema.shape & M>;
}>;

/**
 * Type for a message schema with a payload and custom meta object
 */
export type PayloadMessageSchemaWithCustomMeta<
  T extends string,
  P extends ZodTypeAny,
  M extends ZodRawShape
> = ZodObject<{
  type: ZodLiteral<T>;
  meta: ZodObject<typeof MessageMetadataSchema.shape & M>;
  payload: P;
}>;

// -----------------------------------------------------------------------
// Function Overloads
// -----------------------------------------------------------------------

/**
 * Creates a message schema with a literal type but no payload or custom metadata
 */
export function messageSchema<T extends string>(
  messageType: T
): BaseMessageSchema<T>;

/**
 * Creates a message schema with a literal type and a payload schema (object form)
 */
export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny>
>(messageType: T, payload: P): PayloadMessageSchema<T, ZodObject<P>>;

/**
 * Creates a message schema with a literal type and a payload schema (ZodType form)
 */
export function messageSchema<T extends string, P extends ZodTypeAny>(
  messageType: T,
  payload: P
): PayloadMessageSchema<T, P>;

/**
 * Creates a message schema with a literal type and custom metadata
 */
export function messageSchema<T extends string, M extends ZodRawShape>(
  messageType: T,
  payload: undefined,
  meta: ZodObject<M>
): MessageSchemaWithCustomMeta<T, M>;

/**
 * Creates a message schema with a literal type, payload (object form), and custom metadata
 */
export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny>,
  M extends ZodRawShape
>(
  messageType: T,
  payload: P,
  meta: ZodObject<M>
): PayloadMessageSchemaWithCustomMeta<T, ZodObject<P>, M>;

/**
 * Creates a message schema with a literal type, payload (ZodType form), and custom metadata
 */
export function messageSchema<
  T extends string,
  P extends ZodTypeAny,
  M extends ZodRawShape
>(
  messageType: T,
  payload: P,
  meta: ZodObject<M>
): PayloadMessageSchemaWithCustomMeta<T, P, M>;

// -----------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------

/**
 * A helper function to create specific WebSocket message schemas.
 * It extends the base `MessageSchema`, setting a literal type, adding a payload schema,
 * and optionally extending the metadata schema.
 *
 * Implementation for all overloads
 */
export function messageSchema<
  T extends string,
  P extends Record<string, ZodTypeAny> | ZodTypeAny | undefined = undefined,
  M extends ZodRawShape = {}
>(
  messageType: T,
  payload?: P,
  meta?: M extends {} ? undefined : ZodObject<M>
): P extends undefined
  ? M extends {}
    ? BaseMessageSchema<T>
    : MessageSchemaWithCustomMeta<T, M>
  : P extends Record<string, ZodTypeAny>
  ? M extends {}
    ? PayloadMessageSchema<T, ZodObject<P>>
    : PayloadMessageSchemaWithCustomMeta<T, ZodObject<P>, M>
  : M extends {}
  ? PayloadMessageSchema<T, P & ZodTypeAny>
  : PayloadMessageSchemaWithCustomMeta<T, P & ZodTypeAny, M> {
  // Create base schema with type and meta
  const baseSchema = MessageSchema.extend({
    type: z.literal(messageType),
    meta: meta
      ? MessageMetadataSchema.extend((meta as ZodObject<any>).shape)
      : MessageMetadataSchema,
  });

  // If no payload schema provided, return without payload
  if (payload === undefined) {
    return baseSchema as any;
  }

  // Add payload to schema based on input type
  return baseSchema.extend({
    payload:
      payload instanceof z.ZodType
        ? payload
        : z.object(payload as Record<string, ZodTypeAny>),
  }) as any;
}
