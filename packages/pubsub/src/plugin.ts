// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/pubsub plugin — adds pub/sub capability to router
 *
 * Orchestrates local and distributed pub/sub:
 * - Tracks connected clients via onOpen/onClose lifecycle hooks
 * - Delivers messages to local subscribers via deliverLocally()
 * - Manages optional distributed broker ingress via init()/shutdown()
 *
 * Router constructs PublishEnvelope (topic, payload, type) and PublishOptions,
 * then calls adapter.publish(envelope, options) to broadcast.
 */

import type { Router, Plugin, MessageDescriptor } from "@ws-kit/core";
import type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
} from "@ws-kit/core/pubsub";

/**
 * Pub/Sub plugin factory.
 * Enhances a router with:
 * - publish(topic, schema, payload, opts?) — broadcast to topic subscribers
 * - subscriptions — query active topics
 * - pubsub.init() — start broker consumer if present
 * - pubsub.shutdown() — stop broker consumer and close adapter
 *
 * **Plugin Responsibilities**:
 * - Track connected clients (onOpen/onClose hooks)
 * - Deliver messages to local subscribers (deliverLocally)
 * - Manage adapter lifecycle (init/shutdown)
 *
 * **Adapter Responsibilities**:
 * - Maintain per-client subscriptions
 * - Fan-out metrics (matchedLocal count)
 * - Optional: broker ingestion (start/stop)
 *
 * **Timing Contract**:
 * Platforms MUST call router.pubsub.init() after routes are registered
 * and before accepting external traffic. This ensures subscribers are ready.
 *
 * Usage:
 * ```ts
 * const router = createRouter()
 *   .plugin(withPubSub(memoryAdapter()));
 *
 * router.on(Message, (ctx) => {
 *   const result = await ctx.publish("topic", schema, payload);
 *   if (result.ok) {
 *     console.log(`Matched ${result.matchedLocal} local subscribers`);
 *   }
 *   await ctx.topics.subscribe("room:123");
 * });
 *
 * // Platform initialization
 * await router.pubsub.init(); // Start broker consumer if present
 * // ... handle connections ...
 * await router.pubsub.shutdown(); // Clean up
 * ```
 */
export function withPubSub<TConn>(
  adapter: PubSubAdapter,
): Plugin<TConn, { pubsub: true }> {
  return (router: Router<TConn, any>) => {
    // Track active send functions by client ID for local delivery
    const sends = new Map<string, (frame: unknown) => void | Promise<void>>();

    /**
     * Register a send function for a client when connection opens.
     * Called by lifecycle.handleOpen for each new WebSocket.
     */
    const onClientOpen = async (ws: any) => {
      const clientId = ws.data?.clientId;
      if (clientId && typeof ws.send === "function") {
        sends.set(clientId, ws.send.bind(ws));
      }
    };

    /**
     * Unregister a send function for a client when connection closes.
     * Called by lifecycle.handleClose for each closed WebSocket.
     */
    const onClientClose = async (ws: any) => {
      const clientId = ws.data?.clientId;
      if (clientId) {
        sends.delete(clientId);
      }
    };

    /**
     * Deliver a message envelope to all locally subscribed clients.
     * This is the core delivery orchestrator:
     * - Encodes envelope once
     * - Iterates adapter.getSubscribers(topic) with backpressure
     * - Sends to each client, respecting exclude-self if set
     * - Catches and logs send errors without breaking the loop
     */
    const deliverLocally = async (env: PublishEnvelope) => {
      // Exclude self: if envelope.meta.excludeClientId is set, skip that client
      const excludeId = (env.meta as any)?.excludeClientId;

      // Iterate subscribers (async iterable respects backpressure)
      for await (const clientId of adapter.getSubscribers(env.topic)) {
        // Skip excluded client
        if (excludeId && clientId === excludeId) continue;

        // Get the send function for this client
        const send = sends.get(clientId);
        if (!send) continue; // Client disconnected; skip

        try {
          // Send the envelope frame
          await Promise.resolve(send(env));
        } catch (error) {
          // Log delivery error but continue loop
          // (client may have disconnected mid-delivery)
          const lifecycle = (router as any).getInternalLifecycle?.();
          lifecycle?.handleError(error, null);
        }
      }
    };

    // Lifecycle state for idempotent init/shutdown
    let started = false;
    let stop: void | (() => void) | Promise<() => void> | null = null;

    /**
     * Publish message to a topic.
     * Router materializes the message; adapter broadcasts.
     *
     * @param topic - Topic name (validation is middleware responsibility)
     * @param schema - Message schema (for router observability and type name)
     * @param payload - Validated payload (may include meta from message schema)
     * @param opts - Optional: partitionKey (sharding hint), signal (cancellation)
     * @returns PublishResult with optional matched/deliveredLocal counts
     * @throws On adapter failure
     */
    const publish = async (
      topic: string,
      schema: MessageDescriptor,
      payload: unknown,
      opts?: {
        partitionKey?: string;
        signal?: AbortSignal;
      },
    ) => {
      // Construct envelope: the message itself
      const envelope: PublishEnvelope = {
        topic,
        payload,
        type: schema.type || schema.name, // Schema name for observability
      };

      // Construct options: distribution logic only (meta belongs in envelope)
      const publishOpts: PublishOptions | undefined = opts
        ? {
            partitionKey: opts.partitionKey,
            signal: opts.signal,
          }
        : undefined;

      const result = await adapter.publish(envelope, publishOpts);
      return result;
    };

    /**
     * Convenience helpers for querying subscription state.
     */
    const subscriptions = {
      /**
       * List all active topics in this process.
       */
      list: () => {
        if (adapter.listTopics) {
          return adapter.listTopics();
        }
        return [];
      },

      /**
       * Check if a topic has active subscribers.
       */
      has: (topic: string) => {
        if (adapter.hasTopic) {
          return adapter.hasTopic(topic);
        }
        return false;
      },
    };

    /**
     * Hook lifecycle events to track connected clients.
     * Plugins hook into router lifecycle for setup/cleanup.
     */
    const lifecycle = (router as any).getInternalLifecycle?.();
    if (lifecycle) {
      lifecycle.onOpen(onClientOpen);
      lifecycle.onClose(onClientClose);
    }

    // Initialize enhanced router with publish/subscriptions + pubsub.init/shutdown
    const enhanced = Object.assign(router, {
      publish,
      subscriptions,
      pubsub: {
        /**
         * Initialize distributed broker consumer (idempotent).
         * Platforms MUST call this after routes are registered and before traffic.
         * If called multiple times, only the first call has effect.
         */
        async init() {
          if (started) return; // Already initialized
          started = true;

          // If adapter has broker ingestion, wire it up
          if (typeof adapter.start === "function") {
            try {
              // Promise.resolve normalizes both sync and async stop returns
              stop = await Promise.resolve(adapter.start(deliverLocally));
            } catch (err) {
              // Broker connection failed; reset started flag and rethrow
              started = false;
              console.error("[pubsub] Failed to start broker consumer", {
                err,
              });
              throw err;
            }
          }
        },

        /**
         * Shutdown broker consumer and close adapter (idempotent).
         * Stops consuming messages and cleans up broker connections.
         * Safe to call multiple times.
         */
        async shutdown() {
          // Call stop function if present
          const s = await Promise.resolve(stop);
          if (typeof s === "function") {
            await Promise.resolve(s());
          }

          // Close adapter if it has a close method
          if (typeof adapter.close === "function") {
            await adapter.close();
          }

          // Reset state for potential re-init
          started = false;
          stop = null;
        },
      },
    }) as Router<TConn, { pubsub: true }>;

    (enhanced as any).__caps = { pubsub: true };
    return enhanced;
  };
}
