/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { v7 as randomUUIDv7 } from "uuid";
import { z } from "zod";
import { WebSocketHandlers } from "./handlers";
import type {
  CloseHandler,
  MessageHandler,
  MessageSchemaType,
  OpenHandler,
  SendFunction,
  UpgradeOptions,
  WebSocketData,
  WebSocketRouterOptions,
} from "./types";

export class WebSocketRouter<
  Metadata extends Record<string, unknown> = Record<string, never>,
> {
  private readonly server: Server;
  private readonly handlers = new WebSocketHandlers<WebSocketData<Metadata>>();

  constructor(options?: WebSocketRouterOptions) {
    this.server = options?.server ?? (undefined as unknown as Server);
  }

  /**
   * Merges open, close, and message handlers from another WebSocketRouter instance.
   */
  addRoutes(ws: WebSocketRouter<Metadata>): this {
    ws.handlers.message.forEach((handler, value) => {
      this.handlers.message.set(value, handler);
    });
    this.handlers.open.push(...ws.handlers.open);
    this.handlers.close.push(...ws.handlers.close);
    return this;
  }

  /**
   * Upgrades an HTTP request to a WebSocket connection.
   */
  public upgrade(
    req: Request,
    options: UpgradeOptions<WebSocketData<Metadata>>,
  ) {
    const { server, data, headers } = options;
    const clientId = randomUUIDv7();
    const upgraded = server.upgrade(req, {
      data: { clientId, ...data },
      headers: {
        "x-client-id": clientId,
        ...headers,
      },
    });

    if (!upgraded) {
      return new Response(
        "Failed to upgrade the request to a WebSocket connection",
        {
          status: 500,
          headers: {
            "Content-Type": "text/plain",
          },
        },
      );
    }

    return new Response(null, { status: 101 });
  }

  onOpen(handler: OpenHandler<WebSocketData<Metadata>>): this {
    this.handlers.open.push(handler);
    return this;
  }

  onClose(handler: CloseHandler<WebSocketData<Metadata>>): this {
    this.handlers.close.push(handler);
    return this;
  }

  onMessage<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: MessageHandler<Schema, WebSocketData<Metadata>>,
  ): this {
    const messageType = schema.shape.type._def.value;

    if (this.handlers.message.has(messageType)) {
      console.warn(
        `Handler for message type "${messageType}" is being overwritten.`,
      );
    }

    this.handlers.message.set(messageType, {
      schema,
      handler: handler as MessageHandler<
        MessageSchemaType,
        WebSocketData<Metadata>
      >,
    });

    return this;
  }

  /**
   * Returns a WebSocket handler that can be used with `Bun.serve`.
   */
  get websocket(): WebSocketHandler<WebSocketData<Metadata>> {
    return {
      open: this.handleOpen.bind(this),
      message: this.handleMessage.bind(this),
      close: this.handleClose.bind(this),
    };
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Private methods
  // ———————————————————————————————————————————————————————————————————————————

  private handleOpen(ws: ServerWebSocket<WebSocketData<Metadata>>) {
    const clientId = ws.data.clientId;
    console.log(`[ws] Connection opened: ${clientId}`);

    const context = {
      ws,
      send: this.createSendFunction(ws),
    };

    // Execute all registered open handlers
    this.handlers.open.forEach((handler) => {
      try {
        // Call the handler, passing the WebSocket instance
        const result = handler(context);
        // Handle async handlers if they return a promise
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(
              `Unhandled promise rejection in open handler for ${clientId}:`,
              error,
            );
          });
        }
      } catch (error) {
        console.error(`Error in open handler for ${clientId}:`, error);
        // ws.close(1011, "Internal server error during connection setup");
      }
    });
  }

  private handleClose(
    ws: ServerWebSocket<WebSocketData<Metadata>>,
    code: number,
    reason?: string,
  ) {
    const clientId = ws.data.clientId;
    console.log(
      `[ws] Connection closed: ${clientId} (Code: ${code}, Reason: ${
        reason || "N/A"
      })`,
    );

    const context = {
      ws,
      code,
      reason,
      send: this.createSendFunction(ws),
    };

    // Execute all registered close handlers
    this.handlers.close.forEach((handler) => {
      try {
        // Call the handler, passing the WebSocket instance, code, and reason
        const result = handler(context);
        // Handle async handlers if they return a promise
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(
              `[ws] Unhandled promise rejection in close handler for ${clientId}:`,
              error,
            );
          });
        }
      } catch (error) {
        // Catch synchronous errors in handlers
        console.error(`[ws] Error in close handler for ${clientId}:`, error);
      }
    });
  }

  private handleMessage(
    ws: ServerWebSocket<WebSocketData<Metadata>>,
    message: string | Buffer,
  ) {
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
        // Optionally send an error message back or close the connection
        // ws.send(JSON.stringify({ error: "Invalid message format" }));
        // ws.close(1003, "Invalid message format");
        return;
      }
    } catch (error) {
      console.error(`[ws] Failed to parse message from ${clientId}:`, error);
      // Optionally send an error message back or close the connection
      // ws.send(JSON.stringify({ error: "Invalid JSON" }));
      // ws.close(1003, "Invalid JSON");
      return;
    }

    const messageType = (parsedMessage as { type: string }).type;
    const handlerEntry = this.handlers.message.get(messageType);

    if (!handlerEntry) {
      console.warn(
        `[ws] No handler found for message type "${messageType}" from ${clientId}`,
      );
      // Optionally send a message indicating the type is unsupported
      // ws.send(JSON.stringify({ error: `Unsupported message type: ${messageType}` }));
      return;
    }

    const { schema, handler } = handlerEntry;

    try {
      // Validate the message against the registered schema
      const validationResult = schema.safeParse(parsedMessage);

      if (!validationResult.success) {
        console.error(
          `[ws] Message validation failed for type "${messageType}" from ${clientId}:`,
          validationResult.error.errors, // Log Zod errors
        );
        // Optionally send detailed validation errors back (be cautious with sensitive info)
        // ws.send(JSON.stringify({ error: "Validation failed", details: validationResult.error.flatten() }));
        // ws.close(1007, "Invalid message payload");
        return;
      }

      // Prepare the context for the handler
      const validatedData = validationResult.data;
      const context = {
        ws,
        type: validatedData.type, // Already known, but include for consistency
        meta: validatedData.meta,
        // Conditionally add payload if it exists in the schema and data
        ...(validatedData.payload !== undefined && {
          payload: validatedData.payload,
        }),
        send: this.createSendFunction(ws),
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
      // Optionally close the connection on handler error
      // ws.close(1011, "Internal server error during message handling");
    }
  }

  /**
   * Creates a send function for a specific WebSocket connection.
   * This function allows handlers to send typed messages with proper validation.
   */
  private createSendFunction<T extends WebSocketData<Metadata>>(
    ws: ServerWebSocket<T>,
  ): SendFunction {
    return <Schema extends MessageSchemaType>(
      schema: Schema,
      payload: Schema["shape"] extends { payload: infer P }
        ? P extends z.ZodTypeAny
          ? z.infer<P>
          : unknown
        : unknown,
      meta: Partial<z.infer<Schema["shape"]["meta"]>> = {},
    ) => {
      try {
        // Extract the message type from the schema
        const messageType = schema.shape.type._def.value;

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
        const validationResult = schema.safeParse(message);

        if (!validationResult.success) {
          console.error(
            `[ws] Failed to send message of type "${messageType}": Validation error`,
            validationResult.error.errors,
          );
          return;
        }

        // Send the validated message
        ws.send(JSON.stringify(validationResult.data));
      } catch (error) {
        console.error(`[ws] Error sending message:`, error);
      }
    };
  }
}
