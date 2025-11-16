// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core";
import type { Server } from "bun";

/**
 * Bun-native Pub/Sub adapter leveraging server.publish().
 *
 * Uses Bun's event-loop integrated broadcasting with zero-copy semantics.
 * All WebSocket connections that have called `ws.subscribe(topic)` will
 * receive messages published via this adapter.
 *
 * **Performance characteristics**:
 * - Zero-copy: Messages are broadcast directly without serialization overhead
 * - In-process: All subscribers must be in the same Bun instance
 * - Synchronous: Messages are delivered immediately to all subscribers
 *
 * **Scope**: Messages published to a topic are received by ALL WebSocket
 * connections in this Bun process that have subscribed to that topic.
 * For multi-process deployments (load-balanced cluster), each instance has
 * its own scope—use RedisPubSubAdapter for cross-process broadcasting.
 *
 * **Note**: For public API, use `bunPubSub()` factory function instead.
 *
 * @internal Use `bunPubSub(server)` factory for creating instances.
 */
export class BunPubSub implements PubSubAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private server: Server<any>) {}

  /**
   * Publish a message to a topic.
   *
   * All WebSocket connections subscribed to this topic (via ws.subscribe)
   * will receive the message immediately.
   *
   * Note: BunPubSub does not track subscribers, so capability is always "unknown".
   *
   * @param envelope - Validated message with topic, payload, type, meta
   * @param options - Publish options (partitionKey ignored, excludeSelf not supported)
   */
  async publish(
    envelope: PublishEnvelope,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: PublishOptions,
  ): Promise<PublishResult> {
    try {
      // Serialize message payload
      let data: string | ArrayBuffer | Uint8Array;

      if (typeof envelope.payload === "string") {
        data = envelope.payload;
      } else if (
        envelope.payload instanceof Uint8Array ||
        envelope.payload instanceof ArrayBuffer
      ) {
        data = envelope.payload;
      } else {
        // JSON-serialize objects and other types
        data = JSON.stringify(envelope.payload);
      }

      // Broadcast to all subscribers in this Bun instance
      // This is a synchronous operation in Bun's event loop
      this.server.publish(envelope.topic, data);

      // Return success with unknown capability (Bun doesn't expose subscriber count)
      return {
        ok: true,
        capability: "unknown",
      };
    } catch (cause) {
      return {
        ok: false,
        error: "ADAPTER_ERROR",
        retryable: true,
        adapter: "BunPubSub",
        details: {
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  /**
   * Subscribe a client to a topic.
   *
   * **Note**: Bun's pub/sub is connection-based; subscriptions happen via
   * `ws.subscribe(topic)` on the WebSocket. This is a no-op since actual
   * subscription management is handled per-connection by the platform.
   *
   * @param clientId - Client identifier (unused; Bun handles per-connection)
   * @param topic - Topic name
   */
  async subscribe(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    clientId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    topic: string,
  ): Promise<void> {
    // Bun's pub/sub is connection-based. Subscriptions are managed via
    // ws.subscribe(topic) on the WebSocket itself, not through this adapter method.
    // This is a no-op.
  }

  /**
   * Unsubscribe a client from a topic.
   *
   * **Note**: Like subscribe, this is a no-op for Bun as subscriptions are
   * connection-based and managed via ws.unsubscribe(topic).
   *
   * @param clientId - Client identifier (unused)
   * @param topic - Topic name (unused)
   */
  async unsubscribe(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    clientId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    topic: string,
  ): Promise<void> {
    // No-op for Bun pub/sub
  }

  /**
   * Get local subscribers for a topic.
   *
   * **Note**: Bun's pub/sub doesn't expose subscriber tracking. This always
   * returns an empty async iterable since we cannot enumerate subscribers.
   * The router will attempt delivery to all connections separately.
   *
   * @param topic - Topic name (unused; no subscriber tracking)
   */
  async *getSubscribers(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    topic: string,
  ): AsyncIterable<string> {
    // Bun doesn't expose subscriber enumeration, so we yield nothing.
    // The router will handle delivery to subscribed WebSocket connections.
  }
}
