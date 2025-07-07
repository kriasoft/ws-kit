/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { Server, ServerWebSocket } from "bun";
import type { MessageSchemaType, WebSocketData } from "./types";
import type { ValidatorAdapter } from "./router";

/**
 * Generic publish function that works with any validator adapter.
 */
export function publishWithValidator<
  T extends WebSocketData<Record<string, unknown>>,
>(
  validator: ValidatorAdapter,
  server: Server | ServerWebSocket<T>,
  topic: string,
  schema: MessageSchemaType,
  messageType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any = {},
): boolean {
  try {
    // Create the message object with the required structure
    const message = {
      type: messageType,
      meta: {
        timestamp: Date.now(),
        ...meta,
      },
      ...(payload !== undefined && { payload }),
    };

    // Validate the constructed message against the schema
    const validationResult = validator.safeParse(schema, message);

    if (!validationResult.success) {
      console.error(
        `[ws] Failed to publish message of type "${messageType}": Validation error`,
        validationResult.error,
      );
      return false;
    }

    // Publish the validated message
    server.publish(topic, JSON.stringify(validationResult.data));

    return true;
  } catch (error) {
    console.error(`[ws] Error publishing message:`, error);
    return false;
  }
}
