// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PubSub, PubSubPublishOptions } from "@ws-kit/core";
import type { Server } from "bun";

/**
 * Bun-native Pub/Sub implementation leveraging server.publish().
 *
 * Uses Bun's event-loop integrated broadcasting with zero-copy semantics.
 * All WebSocket connections that have called `ws.subscribe(channel)` will
 * receive messages published via this PubSub.
 *
 * **Performance characteristics**:
 * - Zero-copy: Messages are broadcast directly without serialization overhead
 * - In-process: All subscribers must be in the same Bun instance
 * - Synchronous: Messages are delivered immediately to all subscribers
 *
 * **Scope**: Messages published to a channel are received by ALL WebSocket
 * connections in this Bun process that have subscribed to that channel.
 * For multi-process deployments (load-balanced cluster), each instance has
 * its own scope—use RedisPubSub for cross-process broadcasting.
 *
 * **Usage**:
 * ```typescript
 * const pubsub = new BunPubSub(server);
 * await pubsub.publish("room:123", JSON.stringify({ type: "ROOM:UPDATE", text: "Hello" }));
 *
 * // In message handlers via router:
 * router.on(SomeSchema, async (ctx) => {
 *   ctx.ws.subscribe("room:123");  // Connection subscribes
 *   await router.publish("room:123", ResponseMessage, response);  // Broadcast to all subscribers
 * });
 * ```
 */
export class BunPubSub implements PubSub {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private server: Server<any>) {}

  /**
   * Publish a message to a channel.
   *
   * All WebSocket connections subscribed to this channel (via ws.subscribe)
   * will receive the message immediately.
   *
   * Messages are serialized as-is:
   * - Strings pass through unchanged
   * - Objects are JSON-stringified
   * - Buffers/Uint8Array pass through unchanged
   *
   * **Note**: BunPubSub does not support `excludeSubscriber` option since Bun's
   * pub/sub delivers to all subscribers without filtering. Use MemoryPubSub or
   * implement client-side filtering for excludeSelf behavior.
   *
   * @param channel - Channel name
   * @param message - Message to broadcast
   * @param options - Publish options (partitionKey ignored, excludeSubscriber not supported)
   */
  async publish(
    channel: string,
    message: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: PubSubPublishOptions,
  ): Promise<void> {
    // Note: options are accepted for interface compatibility but mostly ignored
    // partitionKey is not applicable to Bun's single-instance pub/sub
    // excludeSubscriber is not supported by Bun's native pub/sub

    // Serialize message if needed
    let data: string | ArrayBuffer | Uint8Array;

    if (typeof message === "string") {
      data = message;
    } else if (
      message instanceof Uint8Array ||
      message instanceof ArrayBuffer
    ) {
      data = message;
    } else {
      // JSON-serialize objects and other types
      data = JSON.stringify(message);
    }

    // Broadcast to all subscribers in this Bun instance
    // This is a synchronous operation in Bun's event loop
    this.server.publish(channel, data);
  }

  /**
   * Subscribe to a channel with a callback handler.
   *
   * **Note**: Bun's pub/sub is connection-based, not callback-based.
   * Subscriptions happen via `ws.subscribe(channel)` on the WebSocket.
   * This method is a no-op for Bun because:
   * 1. Server-side handlers are not supported by Bun's pub/sub
   * 2. Messages are only sent to WebSocket connections, not arbitrary callbacks
   *
   * For server-side subscription logic, use the router's on() method instead.
   *
   * @param channel - Channel name (ignored)
   * @param handler - Handler to call (ignored)
   */
  subscribe(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    // Bun pub/sub doesn't support server-side subscriptions with callbacks.
    // WebSocket subscriptions are managed per-connection via ws.subscribe/unsubscribe.
    // This is a no-op.
  }

  /**
   * Unsubscribe from a channel.
   *
   * **Note**: Like subscribe, this is a no-op for Bun as explained above.
   *
   * @param channel - Channel name (ignored)
   * @param handler - Handler to remove (ignored)
   */
  unsubscribe(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    // No-op for Bun pub/sub
  }
}
