/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { ServerWebSocket } from "bun";
import type {
  CloseHandler,
  OpenHandler,
  SendFunction,
  WebSocketData,
} from "./types";

/**
 * Handles WebSocket connection lifecycle events (open/close).
 */
export class ConnectionHandler<
  T extends WebSocketData<Record<string, unknown>>,
> {
  private readonly openHandlers: OpenHandler<T>[] = [];
  private readonly closeHandlers: CloseHandler<T>[] = [];

  addOpenHandler(handler: OpenHandler<T>): void {
    this.openHandlers.push(handler);
  }

  addCloseHandler(handler: CloseHandler<T>): void {
    this.closeHandlers.push(handler);
  }

  handleOpen(ws: ServerWebSocket<T>, send: SendFunction): void {
    const clientId = ws.data.clientId;
    console.log(`[ws] Connection opened: ${clientId}`);

    const context = { ws, send };

    // Execute all registered open handlers
    this.openHandlers.forEach((handler) => {
      try {
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
      }
    });
  }

  handleClose(
    ws: ServerWebSocket<T>,
    code: number,
    reason: string | undefined,
    send: SendFunction,
  ): void {
    const clientId = ws.data.clientId;
    console.log(
      `[ws] Connection closed: ${clientId} (Code: ${code}, Reason: ${
        reason || "N/A"
      })`,
    );

    const context = { ws, code, reason, send };

    // Execute all registered close handlers
    this.closeHandlers.forEach((handler) => {
      try {
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
}
