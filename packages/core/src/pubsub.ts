// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket } from "bun";
import type { PubSub } from "./types.js";

/**
 * In-memory Pub/Sub implementation suitable for testing and single-server deployments.
 *
 * Uses a Map-based channel registry with handler arrays. Broadcasts are
 * synchronous and immediate.
 *
 * **Scope**: Messages published on one MemoryPubSub instance are only received
 * by subscribers on the same instance. Not suitable for multi-process deployments.
 *
 * **Use when**:
 * - Testing WebSocket router behavior
 * - Single Bun server (no horizontal scaling)
 * - Cloudflare Durable Object per-instance (not cross-shard)
 *
 * **Don't use for**:
 * - Multi-process deployments (use RedisPubSub instead)
 * - Applications requiring persistence (use platform-specific adapters)
 */
export class MemoryPubSub implements PubSub {
  private channels = new Map<
    string,
    Set<(message: unknown) => void | Promise<void>>
  >();

  /**
   * Publish a message to a channel.
   *
   * All subscribers to this channel receive the message immediately.
   * If a handler throws, the error is logged but doesn't stop other handlers.
   *
   * @param channel - Channel name
   * @param message - Message to publish
   */
  async publish(channel: string, message: unknown): Promise<void> {
    const handlers = this.channels.get(channel);
    if (!handlers) return;

    const promises: Promise<void>[] = [];

    for (const handler of handlers) {
      try {
        const result = handler(message);
        if (result instanceof Promise) {
          promises.push(
            result.catch((err) => {
              console.error(
                `Error in PubSub handler for channel "${channel}":`,
                err,
              );
            }),
          );
        }
      } catch (err) {
        console.error(`Error in PubSub handler for channel "${channel}":`, err);
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Subscribe to a channel.
   *
   * The handler will be called for each message published to this channel.
   * A single handler can be subscribed multiple times.
   *
   * @param channel - Channel name
   * @param handler - Handler function to call for each message
   */
  subscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    let handlers = this.channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channels.set(channel, handlers);
    }

    handlers.add(handler);
  }

  /**
   * Unsubscribe from a channel.
   *
   * Removes the handler from the subscriber list. If the handler was
   * subscribed multiple times, only one subscription is removed.
   *
   * @param channel - Channel name
   * @param handler - Handler function to remove
   */
  unsubscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void {
    const handlers = this.channels.get(channel);
    if (handlers) {
      handlers.delete(handler);

      // Clean up empty channel sets
      if (handlers.size === 0) {
        this.channels.delete(channel);
      }
    }
  }

  /**
   * Clear all subscriptions from all channels.
   *
   * Useful for cleanup in testing or when resetting state.
   */
  clear(): void {
    this.channels.clear();
  }

  /**
   * Get the number of subscribers for a channel.
   *
   * Useful for debugging and testing.
   *
   * @param channel - Channel name
   * @returns Number of subscribers
   */
  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}

/**
 * Publish a validated message to a WebSocket broadcast topic.
 *
 * This utility function:
 * - Validates the payload against the schema
 * - Auto-injects metadata (timestamp, origin if specified)
 * - Never injects clientId into message metadata
 * - Publishes to the WebSocket's broadcast topic
 *
 * @param ws - ServerWebSocket connection
 * @param topic - Broadcast topic name
 * @param schema - Message schema (must have parse/validate method)
 * @param payload - Message payload
 * @param meta - Optional metadata (origin tracking, custom fields, etc.)
 * @returns true if publish succeeded, false if validation failed
 *
 * @example
 * ```typescript
 * const ChatMsg = message("CHAT", { text: z.string() });
 * const success = publish(ws, "room:123", ChatMsg, { text: "Hello" });
 * ```
 *
 * **Origin Tracking:**
 * ```typescript
 * // Inject userId from ws.data into message meta as senderId
 * publish(ws, "room", ChatMsg, { text: "Hi" }, { origin: "userId" });
 * // Custom key: publish(..., { origin: "userId", key: "authorId" });
 * ```
 */
export function publish(
  ws: ServerWebSocket<{ clientId: string } & Record<string, unknown>>,
  topic: string,
  schema: {
    parse?: (data: unknown) => unknown;
    safeParse?: (data: unknown) => {
      success: boolean;
      data?: unknown;
      error?: unknown;
    };
    shape?: Record<string, any>;
  },
  payload: unknown,
  meta?: Record<string, unknown> & { origin?: string; key?: string },
): boolean {
  try {
    // Extract origin tracking options
    const { origin, key = "senderId", ...customMeta } = meta || {};

    // Build metadata with auto-injected fields
    const messageMetadata: Record<string, unknown> = {
      timestamp: customMeta.timestamp ?? Date.now(),
      ...customMeta,
    };

    // Inject origin if specified and value exists
    if (origin && origin in ws.data) {
      const originValue = ws.data[origin];
      // Only inject if value is truthy (not null, undefined, etc)
      if (originValue !== null && originValue !== undefined) {
        messageMetadata[key] = originValue;
      }
    }

    // Get the message type from the schema
    // For Zod schemas: schema.shape.type.value contains the literal type value
    let messageType = "MESSAGE";
    if ((schema as any).shape?.type?.value) {
      messageType = (schema as any).shape.type.value;
    } else if ((schema as any).__type) {
      messageType = (schema as any).__type;
    }

    // Build the message structure
    const message = {
      type: messageType,
      payload,
      meta: messageMetadata,
    };

    // Validate using schema's parse or safeParse
    let validated = message;
    if (typeof (schema as any).parse === "function") {
      validated = (schema as any).parse(message);
    } else if (typeof (schema as any).safeParse === "function") {
      const result = (schema as any).safeParse(message);
      if (!result.success) {
        return false; // Validation failed
      }
      validated = result.data;
    }

    // Publish to topic
    const data = JSON.stringify(validated);
    ws.publish(topic, data);
    return true;
  } catch {
    return false; // Any error means validation or publish failed
  }
}
