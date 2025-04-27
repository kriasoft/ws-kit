/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
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

/**
 * A helper function to create specific WebSocket message schemas.
 * It extends the base `MessageSchema`, setting a literal type, adding a payload schema,
 * and optionally extending the metadata schema.
 */
export function messageSchema<
  Payload extends Record<string, ZodTypeAny> | ZodTypeAny | undefined,
  Metadata extends ZodRawShape | undefined = undefined
>(
  messageType: string,
  schema?: Payload,
  meta?: Metadata extends ZodRawShape ? ZodObject<Metadata> : undefined
) {
  // Create base schema with type and meta
  const baseSchema = MessageSchema.extend({
    type: z.literal(messageType),
    meta: meta
      ? MessageMetadataSchema.extend(meta.shape)
      : MessageMetadataSchema,
  });

  // If no payload schema provided, return without payload
  if (schema === undefined) {
    return baseSchema;
  }

  // Add payload to schema based on input type
  return baseSchema.extend({
    payload:
      schema instanceof z.ZodType
        ? schema
        : z.object(schema as Record<string, ZodTypeAny>),
  });
}
