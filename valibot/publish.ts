// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "bun";
import type { InferOutput } from "valibot";
import * as v from "valibot";
import type { MessageSchemaType } from "../packages/valibot/src/types";

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
 * @param schema - The Valibot schema to validate the message against
 * @param payload - The payload to include in the message (type inferred from schema)
 * @param metaOrOpts - Optional metadata or options object with origin tracking
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

  metaOrOpts?:
    | Partial<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Schema extends v.ObjectSchema<infer TEntries, any>
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            TEntries extends Record<string, any>
            ? "meta" extends keyof TEntries
              ? InferOutput<TEntries["meta"]>
              : unknown
            : unknown
          : unknown
      >
    | {
        origin?: string; // Field name in ws.data (e.g., "userId")
        key?: string; // Meta field name, defaults to "senderId"
      },
): boolean {
  try {
    // Extract the message type from the schema
    // DIFFERENCE: Valibot requires runtime checks vs Zod's direct access
    // SAFETY: Returns early if schema structure is invalid
    const typeSchema = schema.entries.type;
    if (!typeSchema || typeSchema.type !== "literal") {
      console.error(`[ws] Schema must have a literal type field`);
      return false;
    }
    const messageType = typeSchema.literal;

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
    // NOTE: Valibot's safeParse has different arg order than Zod
    const validationResult = v.safeParse(schema, message);

    if (!validationResult.success) {
      console.error(
        `[ws] Failed to publish message of type "${messageType}" to topic "${topic}": Validation error`,
        validationResult.issues,
      );
      return false;
    }

    // Publish the validated message to the topic
    // NOTE: Valibot uses 'output' instead of Zod's 'data'
    ws.publish(topic, JSON.stringify(validationResult.output));
    return true;
  } catch (error) {
    // Catches schema extraction errors or publish failures
    console.error(`[ws] Error publishing message to topic "${topic}":`, error);
    return false;
  }
}
