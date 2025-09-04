/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { Server, ServerWebSocket } from "bun";
import type { MessageSchemaType, WebSocketData } from "./types";
import type { ValidatorAdapter } from "./router";

/**
 * Generic publish function that works with any validator adapter.
 *
 * ARCHITECTURE: This shared implementation is used internally by the router.
 * Public APIs (zod/publish and valibot/publish) provide type-safe wrappers.
 *
 * NOTE: Accepts either Server or ServerWebSocket for flexibility in usage.
 */
export function publishWithValidator<
  T extends WebSocketData<Record<string, unknown>>,
>(
  validator: ValidatorAdapter,
  server: Server | ServerWebSocket<T>,
  topic: string,
  schema: MessageSchemaType,
  messageType: string, // Pre-extracted to avoid adapter-specific logic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any = {},
): boolean {
  try {
    // Create the message object with the required structure
    // DIFFERENCE: No clientId here - that's added in the public APIs
    const message = {
      type: messageType,
      meta: {
        timestamp: Date.now(),
        ...meta,
      },
      ...(payload !== undefined && { payload }), // Omit payload key if undefined
    };

    // Validate the constructed message against the schema
    // DELEGATION: Uses adapter's safeParse to handle validator differences
    const validationResult = validator.safeParse(schema, message);

    if (!validationResult.success) {
      console.error(
        `[ws] Failed to publish message of type "${messageType}": Validation error`,
        validationResult.error,
      );
      return false;
    }

    // Publish the validated message
    // NOTE: Both Server and ServerWebSocket have .publish() method
    server.publish(topic, JSON.stringify(validationResult.data));

    return true;
  } catch (error) {
    // Generic error handler - adapter errors should be caught upstream
    console.error(`[ws] Error publishing message:`, error);
    return false;
  }
}
