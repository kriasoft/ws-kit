/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket, WebSocketHandler } from "bun";
import { v7 as randomUUIDv7 } from "uuid";
import { ConnectionHandler } from "./connection";
import { MessageRouter } from "./message";
import type {
  CloseHandler,
  MessageHandler,
  MessageSchemaType,
  OpenHandler,
  SendFunction,
  UpgradeOptions,
  WebSocketData,
} from "./types";

/**
 * Adapter interface for pluggable validation libraries.
 * Implementations bridge Zod/Valibot specifics with generic router logic.
 */
export interface ValidatorAdapter {
  getMessageType(schema: MessageSchemaType): string;
  safeParse(
    schema: MessageSchemaType,
    data: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { success: boolean; data?: any; error?: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  infer<T extends MessageSchemaType>(schema: T): any; // For TypeScript only
}

/**
 * WebSocket router for Bun that provides type-safe message routing with validation.
 * Routes incoming messages to handlers based on message type.
 *
 * @template T - Application-specific data to store with each WebSocket connection.
 *               Always includes a clientId property generated automatically.
 */
export class WebSocketRouter<
  T extends Record<string, unknown> = Record<string, never>,
> {
  private readonly connectionHandler = new ConnectionHandler<
    WebSocketData<T>
  >();
  private readonly messageRouter: MessageRouter<WebSocketData<T>>;
  private readonly validator: ValidatorAdapter;

  constructor(validator: ValidatorAdapter) {
    this.validator = validator;
    this.messageRouter = new MessageRouter<WebSocketData<T>>(validator);
  }

  /**
   * Merges open, close, and message handlers from another WebSocketRouter instance.
   *
   * USE CASE: Compose routers from different modules/features.
   * WARNING: Message type conflicts are resolved by last-write-wins.
   *
   * NOTE: Accepts `| any` to support Zod/Valibot router instances. The type override
   * in derived classes creates an LSP variance issue, making them technically incompatible
   * with the base type. This is an intentional trade-off for better developer experience.
   *
   * @param router - Router instance to merge routes from (including Zod/Valibot routers)
   * @returns This router instance for method chaining
   * @see specs/adrs.md#ADR-001 - Explains the type override variance issue
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addRoutes(router: WebSocketRouter<T> | any): this {
    // HACK: Access private members through type assertions.
    // Safer than exposing internal state publicly.
    interface AccessibleConnectionHandler {
      openHandlers: OpenHandler<WebSocketData<T>>[];
      closeHandlers: CloseHandler<WebSocketData<T>>[];
    }

    interface AccessibleMessageRouter {
      messageHandlers: Map<
        string,
        {
          schema: MessageSchemaType;
          handler: MessageHandler<MessageSchemaType, WebSocketData<T>>;
        }
      >;
    }

    // Merge open handlers
    const otherConnectionHandler =
      router.connectionHandler as unknown as AccessibleConnectionHandler;
    otherConnectionHandler.openHandlers.forEach((handler) => {
      this.connectionHandler.addOpenHandler(handler);
    });

    // Merge close handlers
    otherConnectionHandler.closeHandlers.forEach((handler) => {
      this.connectionHandler.addCloseHandler(handler);
    });

    // Merge message handlers
    const thisMessageRouter = this
      .messageRouter as unknown as AccessibleMessageRouter;
    const otherMessageRouter =
      router.messageRouter as unknown as AccessibleMessageRouter;

    otherMessageRouter.messageHandlers.forEach((value, key) => {
      thisMessageRouter.messageHandlers.set(key, value);
    });

    return this;
  }

  /**
   * Upgrades an HTTP request to a WebSocket connection.
   *
   * FLOW: Generate clientId → Attempt upgrade → Return appropriate HTTP response
   * NOTE: clientId (UUID v7) is both stored in data and sent as header.
   */
  public upgrade(req: Request, options: UpgradeOptions<WebSocketData<T>>) {
    const { server, data, headers } = options;
    const clientId = randomUUIDv7(); // UUID v7 for time-ordered IDs
    const upgraded = server.upgrade(req, {
      data: { clientId, ...data },
      headers: {
        "x-client-id": clientId,
        ...headers,
      },
    });

    // Bun's upgrade() returns false if upgrade fails (e.g., not a WS request)
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

    // 101 Switching Protocols - standard WebSocket upgrade response
    return new Response(null, { status: 101 });
  }

  onOpen(handler: OpenHandler<WebSocketData<T>>): this {
    this.connectionHandler.addOpenHandler(handler);
    return this;
  }

  onClose(handler: CloseHandler<WebSocketData<T>>): this {
    this.connectionHandler.addCloseHandler(handler);
    return this;
  }

  onMessage<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: MessageHandler<Schema, WebSocketData<T>>,
  ): this {
    this.messageRouter.addMessageHandler(schema, handler);
    return this;
  }

  /**
   * Returns a WebSocket handler that can be used with `Bun.serve`.
   *
   * USAGE: Pass to Bun.serve({ websocket: router.websocket })
   * NOTE: Methods are bound to preserve 'this' context.
   */
  get websocket(): WebSocketHandler<WebSocketData<T>> {
    return {
      open: this.handleOpen.bind(this),
      message: this.handleMessage.bind(this),
      close: this.handleClose.bind(this),
    };
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Private methods - Internal event handlers
  // ———————————————————————————————————————————————————————————————————————————

  private handleOpen(ws: ServerWebSocket<WebSocketData<T>>) {
    const send = this.createSendFunction(ws);
    this.connectionHandler.handleOpen(ws, send);
  }

  private handleClose(
    ws: ServerWebSocket<WebSocketData<T>>,
    code: number,
    reason?: string,
  ) {
    const send = this.createSendFunction(ws);
    this.connectionHandler.handleClose(ws, code, reason, send);
  }

  private handleMessage(
    ws: ServerWebSocket<WebSocketData<T>>,
    message: string | Buffer,
  ) {
    const send = this.createSendFunction(ws);
    this.messageRouter.handleMessage(ws, message, send);
  }

  /**
   * Creates a send function for a specific WebSocket connection.
   *
   * PURPOSE: Provides handlers with a validated way to send messages.
   * Each connection gets its own send function with clientId pre-bound.
   */
  private createSendFunction(
    ws: ServerWebSocket<WebSocketData<T>>,
  ): SendFunction {
    return (
      schema: MessageSchemaType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      meta: any = {},
    ) => {
      try {
        // Extract the message type from the schema
        const messageType = this.validator.getMessageType(schema);

        // Create the message object with the required structure
        // NOTE: clientId from the connection, timestamp auto-generated
        const message = {
          type: messageType,
          meta: {
            clientId: ws.data.clientId,
            timestamp: Date.now(),
            ...meta,
          },
          ...(payload !== undefined && { payload }), // Omit if undefined
        };

        // Validate the constructed message against the schema
        const validationResult = this.validator.safeParse(schema, message);

        if (!validationResult.success) {
          console.error(
            `[ws] Failed to send message of type "${messageType}": Validation error`,
            validationResult.error,
          );
          return;
        }

        // Send the validated message
        // NOTE: ws.send() goes to this specific connection only (not broadcast)
        ws.send(JSON.stringify(validationResult.data));
      } catch (error) {
        console.error(`[ws] Error sending message:`, error);
      }
    };
  }
}
