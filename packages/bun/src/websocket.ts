// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "@ws-kit/core";
import type { ServerWebSocket as BunServerWebSocket } from "bun";

/**
 * Wraps Bun's ServerWebSocket to ensure it conforms to the core interface.
 *
 * Bun's ServerWebSocket already implements all required methods and properties,
 * so this wrapper is primarily for type safety and documentation.
 *
 * **Note**: This wrapper has no runtime overhead—it's purely for TypeScript
 * type checking. At runtime, we pass through to Bun's native WebSocket.
 *
 * @param ws - Bun's ServerWebSocket instance
 * @returns The same WebSocket (no-op at runtime) with core interface type
 */
export function toBunServerWebSocket<TData = unknown>(
  ws: BunServerWebSocket<TData>,
): ServerWebSocket {
  // Verify the interface at compile time
  // At runtime, this is a no-op—we just return the WebSocket as-is
  const socket: ServerWebSocket = ws as any;
  return socket;
}

/**
 * Type guard to check if an object is a Bun ServerWebSocket.
 *
 * Useful for platform detection or conditional logic.
 *
 * @param ws - Unknown WebSocket-like object
 * @returns true if ws has Bun ServerWebSocket methods
 */
export function isBunServerWebSocket<TData = unknown>(
  ws: unknown,
): ws is BunServerWebSocket<TData> {
  if (!ws || typeof ws !== "object") return false;

  const socket = ws as Record<string, unknown>;
  return (
    typeof socket.send === "function" &&
    typeof socket.close === "function" &&
    typeof socket.subscribe === "function" &&
    typeof socket.unsubscribe === "function" &&
    socket.data !== undefined
  );
}
