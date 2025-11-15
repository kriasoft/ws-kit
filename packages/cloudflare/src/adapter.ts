// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PlatformAdapter, ServerWebSocket } from "@ws-kit/core";
import { DurablePubSub } from "./pubsub.js";

/**
 * Create a Cloudflare Durable Object platform adapter.
 *
 * The adapter provides:
 * - DurablePubSub using BroadcastChannel for per-instance broadcasting
 * - Platform-agnostic interface compatible with core router
 *
 * **Usage**:
 * ```typescript
 * import { createDurableObjectAdapter } from "@ws-kit/cloudflare";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter({
 *   platform: createDurableObjectAdapter(),
 * });
 * ```
 *
 * **Important**: Unlike the Bun adapter, the DO adapter does NOT require a server
 * instance because DO doesn't have a global pub/sub like Bun does. Instead,
 * BroadcastChannel provides per-instance communication.
 *
 * @returns A PlatformAdapter suitable for use with WebSocketRouter
 */
export function createDurableObjectAdapter(): PlatformAdapter {
  const pubsub = new DurablePubSub();

  return {
    // Use DurablePubSub for per-instance broadcasting
    pubsub,

    // Cleanup when DO is destroyed
    destroy: () => {
      pubsub.destroy();
      return Promise.resolve();
    },
  };
}

/**
 * Wrap a Cloudflare WebSocket to conform to the ServerWebSocket interface.
 *
 * Cloudflare's WebSocket class already conforms, but this wrapper provides
 * type safety and documentation.
 *
 * @param ws - Cloudflare WebSocket instance
 * @returns The same WebSocket typed as ServerWebSocket
 */
export function toDurableObjectServerWebSocket<TData = unknown>(
  ws: unknown,
): ServerWebSocket {
  // Verify the interface at compile time
  // At runtime, this is a no-op—we just return the WebSocket as-is
  // Note: The generic TData parameter is only for source compatibility.
  // Core's ServerWebSocket is intentionally non-generic (per ADR-033).
  return ws as ServerWebSocket;
}

/**
 * Type guard to check if an object is a Cloudflare WebSocket.
 *
 * @param ws - Unknown WebSocket-like object
 * @returns true if ws has required WebSocket methods
 */
export function isDurableObjectServerWebSocket<TData = unknown>(
  ws: unknown,
): ws is ServerWebSocket {
  if (!ws || typeof ws !== "object") return false;

  const socket = ws as Record<string, unknown>;
  return (
    typeof socket.send === "function" &&
    typeof socket.close === "function" &&
    typeof socket.accept === "function" &&
    socket.readyState !== undefined
  );
}
