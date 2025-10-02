// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

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
 * @param metaOrOpts - Optional metadata or options object with origin tracking
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
  metaOrOpts?:
    | Partial<z.infer<Schema["shape"]["meta"]>>
    | {
        origin?: string; // Field name in ws.data (e.g., "userId")
        key?: string; // Meta field name, defaults to "senderId"
      },
): boolean {
  try {
    // Extract the message type from the schema
    // ASSUMES: Schema was created by messageSchema() which guarantees type.value exists
    const messageType = schema.shape.type.value;

    // Build meta with timestamp (producer time for UI display)
    const baseMeta: Record<string, unknown> = { timestamp: Date.now() };

    // Handle origin option for sender tracking
    let meta: Record<string, unknown>;
    if (metaOrOpts && "origin" in metaOrOpts) {
      const { origin, key = "senderId", ...rest } = metaOrOpts;
      // Only inject if ws.data[origin] is defined and not null (no-op otherwise)
      if (origin && ws.data[origin] !== undefined && ws.data[origin] !== null) {
        meta = { ...baseMeta, ...rest, [key]: ws.data[origin] };
      } else {
        meta = { ...baseMeta, ...rest };
      }
    } else {
      meta = { ...baseMeta, ...metaOrOpts };
    }

    // Create the message object with the required structure
    // NOTE: timestamp is auto-populated (producer time); clientId is NEVER injected
    const message = {
      type: messageType,
      meta,
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
