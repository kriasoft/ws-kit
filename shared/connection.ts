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
 *
 * DESIGN: Multiple handlers can be registered for the same event,
 * executing in registration order. Errors in one handler don't affect others.
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
    // BEHAVIOR: Handlers run sequentially but don't await promises.
    // Errors are logged but don't prevent other handlers from running.
    this.openHandlers.forEach((handler) => {
      try {
        const result = handler(context);
        // Fire-and-forget async handlers - errors logged but not propagated
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
    // NOTE: Close handlers still execute even if connection is already closed.
    // This ensures cleanup code always runs.
    this.closeHandlers.forEach((handler) => {
      try {
        const result = handler(context);
        // Fire-and-forget async handlers - errors logged but not propagated
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
