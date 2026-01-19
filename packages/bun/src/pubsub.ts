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
 * **Limitations**:
 * - excludeSelf is not supported (returns UNSUPPORTED). Bun's server.publish()
 *   broadcasts directly with no way to intercept or filter delivery.
 *   Use memory or Redis adapter if excludeSelf is required.
 *
 * **Note**: For public API, use `bunPubSub()` factory function instead.
 *
 * @internal Use `bunPubSub(server)` factory for creating instances.
 */
export class BunPubSub implements PubSubAdapter {
  constructor(private server: Server<any>) {}

  /**
   * Publish a message to a topic.
   *
   * All WebSocket connections subscribed to this topic (via ws.subscribe)
   * will receive the message immediately.
   *
   * **excludeSelf limitation**: Bun's native pub/sub broadcasts directly via
   * server.publish() with no way to intercept delivery or enumerate subscribers.
   * This makes excludeSelf impossible - use memory or Redis adapter if needed.
   *
   * @param envelope - Validated message with topic, payload, type, meta
   * @param options - Publish options (excludeSelf returns UNSUPPORTED)
   */
  async publish(
    envelope: PublishEnvelope,
    options?: PublishOptions,
  ): Promise<PublishResult> {
    // Bun's server.publish() is a direct broadcast with no delivery interception.
    // We can't enumerate subscribers or skip specific clients, so excludeSelf
    // is architecturally impossible. Return UNSUPPORTED to be honest.
    if (options?.excludeSelf === true) {
      return {
        ok: false,
        error: "UNSUPPORTED",
        retryable: false,
        adapter: "BunPubSub",
        details: {
          feature: "excludeSelf",
          reason:
            "Bun native pub/sub broadcasts directly; use memory or Redis adapter",
        },
      };
    }

    try {
      // Serialize complete envelope (type, payload, meta) as JSON
      // to preserve full message structure across pub/sub boundary
      let data: string | ArrayBuffer | Uint8Array;

      if (
        typeof envelope.payload === "string" &&
        !envelope.type &&
        !envelope.meta
      ) {
        // Optimization: if payload is plain string with no type/meta,
        // send it directly as-is
        data = envelope.payload;
      } else if (
        envelope.payload instanceof Uint8Array &&
        !envelope.type &&
        !envelope.meta
      ) {
        // Optimization: pass-through binary payload if no envelope metadata
        data = envelope.payload;
      } else if (
        envelope.payload instanceof ArrayBuffer &&
        !envelope.type &&
        !envelope.meta
      ) {
        // Optimization: pass-through binary payload if no envelope metadata
        data = envelope.payload;
      } else {
        // General case: serialize full envelope to preserve type and meta
        const message: Record<string, any> = { payload: envelope.payload };
        if (envelope.type) message.type = envelope.type;
        // Strip internal fields from meta before wire serialization
        if (envelope.meta && typeof envelope.meta === "object") {
          const wireMeta = Object.fromEntries(
            Object.entries(envelope.meta).filter(
              ([k]) => k !== "excludeClientId",
            ),
          );
          if (Object.keys(wireMeta).length > 0) {
            message.meta = wireMeta;
          }
        }
        data = JSON.stringify(message);
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
