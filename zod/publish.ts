/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import type { ZodType } from "zod";
import { z } from "zod";
import type { MessageSchemaType } from "./types";

/**
 * Validates a message against its schema and publishes it to a WebSocket topic.
 *
 * PURPOSE: Ensures all published messages conform to their schemas, preventing
 * runtime errors for subscribers expecting specific message formats.
 *
 * FLOW: Extract type → Construct message → Validate → Publish (or log error)
 *
 * @param ws - The ServerWebSocket instance to publish from
 * @param topic - The topic to publish to (subscribers will receive the message)
 * @param schema - The Zod schema to validate the message against
 * @param payload - The payload to include in the message (type inferred from schema)
 * @param meta - Optional additional metadata to include (type inferred from schema)
 * @returns True if message was validated and published successfully
 */
export function publish<Schema extends MessageSchemaType>(
  ws: ServerWebSocket<{ clientId: string } & Record<string, unknown>>,
  topic: string,
  schema: Schema,
  payload: Schema["shape"] extends { payload: infer P }
    ? P extends ZodType
      ? z.infer<P>
      : unknown
    : unknown,
  meta: Partial<z.infer<Schema["shape"]["meta"]>> = {},
): boolean {
  try {
    // Extract the message type from the schema
    // ASSUMES: Schema was created by messageSchema() which guarantees type.value exists
    const messageType = schema.shape.type.value;

    // Create the message object with the required structure
    // NOTE: clientId and timestamp are auto-populated, user meta can override
    const message = {
      type: messageType,
      meta: {
        clientId: ws.data.clientId,
        timestamp: Date.now(),
        ...meta,
      },
      ...(payload !== undefined && { payload }), // Omit payload key if undefined
    };

    // Validate the constructed message against the schema
    // CRITICAL: Prevents malformed messages from reaching subscribers
    const validationResult = schema.safeParse(message);

    if (!validationResult.success) {
      console.error(
        `[ws] Failed to publish message of type "${messageType}" to topic "${topic}": Validation error`,
        validationResult.error.issues,
      );
      return false;
    }

    // Publish the validated message to the topic
    // NOTE: Uses Bun's native PubSub - message is sent to all topic subscribers
    ws.publish(topic, JSON.stringify(validationResult.data));
    return true;
  } catch (error) {
    // Catches schema extraction errors or publish failures
    console.error(`[ws] Error publishing message to topic "${topic}":`, error);
    return false;
  }
}
