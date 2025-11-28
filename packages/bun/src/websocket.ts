// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "@ws-kit/core";
import type { ServerWebSocket as BunServerWebSocket } from "bun";

/**
 * Adapts Bun's ServerWebSocket to conform to the core interface.
 *
 * Bun's ServerWebSocket already implements all required methods and properties,
 * so this adapter is primarily for type safety and documentation.
 *
 * **Note**: This adapter has no runtime overhead—it's purely for TypeScript
 * type checking. At runtime, we pass through to Bun's native WebSocket.
 *
 * This function is for Bun-specific application code. The router itself receives
 * platform-specific WebSockets and handles the adaptation internally.
 *
 * @param ws - Bun's ServerWebSocket instance (can have generic TData)
 * @returns The same WebSocket (no-op at runtime) cast to core's non-generic ServerWebSocket
 */
export function adaptBunWebSocket<TData = unknown>(
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
export function isBunWebSocket<TData = unknown>(
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
