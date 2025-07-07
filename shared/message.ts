/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import type {
  MessageHandler,
  MessageSchemaType,
  SendFunction,
  WebSocketData,
} from "./types";
import type { ValidatorAdapter } from "./router";

/**
 * Handles WebSocket message parsing, validation, and routing.
 */
export class MessageRouter<T extends WebSocketData<Record<string, unknown>>> {
  private readonly messageHandlers = new Map<
    string,
    { schema: MessageSchemaType; handler: MessageHandler<MessageSchemaType, T> }
  >();

  constructor(private readonly validator: ValidatorAdapter) {}

  addMessageHandler<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: MessageHandler<Schema, T>,
  ): void {
    const messageType = this.validator.getMessageType(schema);

    if (this.messageHandlers.has(messageType)) {
      console.warn(
        `Handler for message type "${messageType}" is being overwritten.`,
      );
    }

    this.messageHandlers.set(messageType, {
      schema,
      handler: handler as MessageHandler<MessageSchemaType, T>,
    });
  }

  handleMessage(
    ws: ServerWebSocket<T>,
    message: string | Buffer,
    send: SendFunction,
  ): void {
    const clientId = ws.data.clientId;
    let parsedMessage: unknown;

    try {
      // Assuming messages are JSON strings
      if (typeof message === "string") {
        parsedMessage = JSON.parse(message);
      } else if (message instanceof Buffer) {
        // Or handle Buffer messages if needed, e.g., parse as JSON
        parsedMessage = JSON.parse(message.toString());
      } else {
        console.warn(
          `[ws] Received non-string/buffer message from ${clientId}`,
        );
        return;
      }

      // Basic validation for message structure (must have a 'type' property)
      if (
        typeof parsedMessage !== "object" ||
        parsedMessage === null ||
        typeof (parsedMessage as { type: unknown }).type !== "string"
      ) {
        console.warn(
          `[ws] Received invalid message format from ${clientId}:`,
          parsedMessage,
        );
        return;
      }
    } catch (error) {
      console.error(`[ws] Failed to parse message from ${clientId}:`, error);
      return;
    }

    const messageType = (parsedMessage as { type: string }).type;
    const handlerEntry = this.messageHandlers.get(messageType);

    if (!handlerEntry) {
      console.warn(
        `[ws] No handler found for message type "${messageType}" from ${clientId}`,
      );
      return;
    }

    const { schema, handler } = handlerEntry;

    try {
      // Validate the message against the registered schema
      const validationResult = this.validator.safeParse(schema, parsedMessage);

      if (!validationResult.success) {
        console.error(
          `[ws] Message validation failed for type "${messageType}" from ${clientId}:`,
          validationResult.error,
        );
        return;
      }

      // Prepare the context for the handler
      const validatedData = validationResult.data;
      const context = {
        ws,
        type: validatedData.type,
        meta: validatedData.meta,
        ...(validatedData.payload !== undefined && {
          payload: validatedData.payload,
        }),
        send,
      };

      // Execute the handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = handler(context as any);

      // Handle async handlers
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error(
            `[ws] Unhandled promise rejection in message handler for type "${messageType}" from ${clientId}:`,
            error,
          );
        });
      }
    } catch (error) {
      // Catch synchronous errors in handlers
      console.error(
        `[ws] Error in message handler for type "${messageType}" from ${clientId}:`,
        error,
      );
    }
  }
}
