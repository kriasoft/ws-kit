/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import * as v from "valibot";
import type { InferOutput } from "valibot";
import type { MessageSchemaType } from "./types";

/**
 * Validates a message against its schema and publishes it to a WebSocket topic.
 * Complements Bun's native WebSocket PubSub functionality with schema validation.
 *
 * @param ws - The ServerWebSocket instance to publish from
 * @param topic - The topic to publish to (subscribers will receive the message)
 * @param schema - The Valibot schema to validate the message against
 * @param payload - The payload to include in the message (type inferred from schema)
 * @param meta - Optional additional metadata to include (type inferred from schema)
 * @returns True if message was validated and published successfully
 */
export function publish<Schema extends MessageSchemaType>(
  ws: ServerWebSocket<{ clientId: string } & Record<string, unknown>>,
  topic: string,
  schema: Schema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Schema extends v.ObjectSchema<infer TEntries, any>
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TEntries extends Record<string, any>
      ? "payload" extends keyof TEntries
        ? InferOutput<TEntries["payload"]>
        : unknown
      : unknown
    : unknown,

  meta: Partial<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Schema extends v.ObjectSchema<infer TEntries, any>
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        TEntries extends Record<string, any>
        ? "meta" extends keyof TEntries
          ? InferOutput<TEntries["meta"]>
          : unknown
        : unknown
      : unknown
  > = {},
): boolean {
  try {
    // Extract the message type from the schema
    const typeSchema = schema.entries.type;
    if (!typeSchema || typeSchema.type !== "literal") {
      console.error(`[ws] Schema must have a literal type field`);
      return false;
    }
    const messageType = typeSchema.literal;

    // Create the message object with the required structure
    const message = {
      type: messageType,
      meta: {
        clientId: ws.data.clientId,
        timestamp: Date.now(),
        ...meta,
      },
      ...(payload !== undefined && { payload }),
    };

    // Validate the constructed message against the schema
    const validationResult = v.safeParse(schema, message);

    if (!validationResult.success) {
      console.error(
        `[ws] Failed to publish message of type "${messageType}" to topic "${topic}": Validation error`,
        validationResult.issues,
      );
      return false;
    }

    // Publish the validated message to the topic
    ws.publish(topic, JSON.stringify(validationResult.output));
    return true;
  } catch (error) {
    console.error(`[ws] Error publishing message to topic "${topic}":`, error);
    return false;
  }
}
