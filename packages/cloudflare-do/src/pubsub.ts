// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { PubSub } from "@ws-kit/core";

/**
 * Cloudflare Durable Object Pub/Sub implementation using BroadcastChannel.
 *
 * All WebSocket connections within a DO instance can publish and receive messages
 * via BroadcastChannel. This is suitable for per-resource setups (one DO per room,
 * game session, etc.).
 *
 * **Scope**: Messages are broadcast ONLY to WebSocket connections **within this DO instance**.
 * They do NOT automatically propagate to other DO instances. For multi-DO coordination,
 * use the `federate()` helper to explicitly coordinate across shards.
 *
 * **Usage**:
 * ```typescript
 * const pubsub = new DurablePubSub();
 * await pubsub.publish("notifications", JSON.stringify({ type: "NOTIFICATION", text: "Hello" }));
 *
 * // In message handlers via router:
 * router.on(SomeSchema, async (ctx) => {
 *   ctx.ws.subscribe("room:123");  // Subscribe to channel
 *   await router.publish("room:123", ResponseMessage, response);  // Broadcast within this DO
 * });
 * ```
 *
 * **Performance characteristics**:
 * - In-memory: Messages stay within the DO instance
 * - Synchronous: BroadcastChannel messages are immediate
 * - No serialization overhead: Direct JavaScript objects
 * - Automatic cleanup: Subscriptions cleaned up when connections close
 */
export class DurablePubSub implements PubSub {
  private subscriptions = new Map<
    string,
    Set<(message: unknown) => void | Promise<void>>
  >();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private broadcastChannel: any;

  constructor() {
    // BroadcastChannel is available in Cloudflare Workers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BC = globalThis.BroadcastChannel as any;
    if (!BC) {
      console.warn(
        "[DurablePubSub] BroadcastChannel not available, subscriptions will not work",
      );
      return;
    }

    this.broadcastChannel = new BC("ws-kit:pubsub");

    // Listen for messages from other open handlers in this DO
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.broadcastChannel.onmessage = (event: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { channel, message } = (event as any).data;
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        handlers.forEach((handler) => {
          Promise.resolve(handler(message)).catch((error: unknown) => {
            console.error(
              `[DurablePubSub] Error in handler for ${channel}:`,
              error,
            );
          });
        });
      }
    };
  }

  /**
   * Publish a message to a channel.
   *
   * The message is broadcast via BroadcastChannel to all handlers subscribed
   * to this channel within this DO instance.
   *
   * @param channel - Channel name
   * @param message - Message to broadcast
   */
  async publish(channel: string, message: unknown): Promise<void> {
    // Serialize message if needed
    let data: unknown;

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

    // Broadcast to all handlers via BroadcastChannel
    // This reaches all open connections within this DO instance
    this.broadcastChannel.postMessage({
      channel,
      message: data,
    });

    // Also trigger local handlers immediately
    const handlers = this.subscriptions.get(channel);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(data);
        } catch (error) {
          console.error(
            `[DurablePubSub] Error in handler for ${channel}:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Subscribe to a channel.
   *
   * The handler will be called whenever a message is published to this channel
   * within this DO instance.
   *
   * @param channel - Channel name
   * @param handler - Handler to call when messages arrive
   */
  subscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    const handlers = this.subscriptions.get(channel);
    if (handlers) {
      handlers.add(handler);
    }
  }

  /**
   * Unsubscribe from a channel.
   *
   * @param channel - Channel name
   * @param handler - Handler to remove
   */
  unsubscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    const handlers = this.subscriptions.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscriptions.delete(channel);
      }
    }
  }

  /**
   * Close the BroadcastChannel and clean up subscriptions.
   *
   * Called by the handler when the DO is being destroyed.
   */
  destroy(): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch (error) {
        console.error("[DurablePubSub] Error closing BroadcastChannel:", error);
      }
    }
    this.subscriptions.clear();
  }
}
