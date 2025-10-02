// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "bun";
import { normalizeInboundMessage } from "./normalize.js";
import type { ValidatorAdapter } from "./router";
import type {
  MessageHandler,
  MessageSchemaType,
  SendFunction,
  WebSocketData,
} from "./types";

/**
 * Handles WebSocket message parsing, validation, and routing.
 *
 * ARCHITECTURE: Maps message types (strings) to their handlers.
 * Only one handler per message type - last registration wins.
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

    // WARNING: Overwriting handlers is allowed but logged.
    // Common in development with hot reload.
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
    // Capture ingress timestamp FIRST for accuracy in time-sensitive operations
    const receivedAt = Date.now();
    const clientId = ws.data.clientId;
    let parsedMessage: unknown;

    try {
      // Parse incoming messages as JSON
      // NOTE: Both string and Buffer are supported for flexibility.
      // Binary protocols would need different handling here.
      if (typeof message === "string") {
        parsedMessage = JSON.parse(message);
      } else if (message instanceof Buffer) {
        parsedMessage = JSON.parse(message.toString());
      } else {
        console.warn(
          `[ws] Received non-string/buffer message from ${clientId}`,
        );
        return;
      }

      // Basic validation for message structure (must have a 'type' property)
      // CRITICAL: This prevents routing errors before schema validation.
      // Messages without string 'type' field are silently dropped.
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
      // Normalize message (security: strip reserved keys, ensure meta exists)
      const normalized = normalizeInboundMessage(parsedMessage);

      // Validate the message against the registered schema
      const validationResult = this.validator.safeParse(schema, normalized);

      if (!validationResult.success) {
        console.error(
          `[ws] Message validation failed for type "${messageType}" from ${clientId}:`,
          validationResult.error,
        );
        return;
      }

      // Prepare the context for the handler
      // NOTE: Payload is conditionally included via spread operator.
      // This allows handlers to check for payload existence vs undefined value.
      const validatedData = validationResult.data;
      const context = {
        ws,
        type: validatedData.type,
        meta: validatedData.meta,
        ...(validatedData.payload !== undefined && {
          payload: validatedData.payload,
        }),
        receivedAt, // Server receive timestamp (captured at ingress, authoritative)
        send,
      };

      // Execute the handler
      // NOTE: Type cast needed due to generic type erasure at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = handler(context as any);

      // Handle async handlers
      // BEHAVIOR: Async errors are logged but don't affect other messages.
      // Each message is processed independently.
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
