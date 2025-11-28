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
 * Adapter returns PublishResult with capability + matched (if knowable).
 */

import type {
  ConnectionData,
  MessageDescriptor,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core";
import { getRouterPluginAPI, ROUTER_IMPL } from "@ws-kit/core/internal";
import { definePlugin } from "@ws-kit/core/plugin";
import type { PublishEnvelope } from "@ws-kit/core/pubsub";
import type { PubSubObserver, WithPubSubOptions } from "./types";

/**
 * Pub/Sub plugin factory.
 * Enhances a router with:
 * - publish(topic, schema, payload, opts?) — broadcast to topic subscribers
 * - subscriptions — query active topics
 * - pubsub.init() — start broker consumer if present
 * - pubsub.shutdown() — stop broker consumer and close adapter
 * - pubsub.tap(observer) — register observer for publish/subscribe events (test/instrumentation)
 *
 * **Plugin Responsibilities**:
 * - Track connected clients (onOpen/onClose hooks)
 * - Deliver messages to local subscribers (deliverLocally)
 * - Manage adapter lifecycle (init/shutdown)
 * - Fast-fail excludeSelf: true with UNSUPPORTED error
 * - Notify observers of publish/subscribe operations
 *
 * **Adapter Responsibilities**:
 * - Maintain per-client subscriptions
 * - Return publish metrics (capability + matched count if knowable)
 * - Optional: broker ingestion (start/stop)
 *
 * **Timing Contract**:
 * Platforms MUST call router.pubsub.init() after routes are registered
 * and before accepting external traffic. This ensures subscribers are ready.
 *
 * **Usage**:
 * ```ts
 * const router = createRouter()
 *   .plugin(withPubSub({
 *     adapter: memoryPubSub(),
 *     observer: {
 *       onPublish: (rec) => console.log(`Published to ${rec.topic}`),
 *     },
 *     limits: { maxTopicsPerConn: 100 },
 *     topic: {
 *       normalize: (t) => t.toLowerCase(),
 *       validate: (t) => { if (!t) throw new Error("empty topic"); },
 *     },
 *   }));
 *
 * router.on(Message, (ctx) => {
 *   const result = await ctx.publish("topic", schema, payload);
 *   if (result.ok) {
 *     console.log(`Capability: ${result.capability}, Matched: ${result.matched ?? "unknown"} subscribers`);
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
/**
 * Pub/Sub plugin API interface.
 * Added to the router when withPubSub() is applied.
 */
interface WithPubSubAPI {
  /**
   * Marker for capability-gating in Router type system.
   * Ensures publish() and topics only appear in keyof when withPubSub() is applied.
   * @internal
   */
  readonly pubsub:
    | true
    | {
        tap(observer: PubSubObserver): () => void;
        init(): Promise<void>;
        shutdown(): Promise<void>;
      };

  /**
   * Publish a message to a topic.
   * @param topic Topic name
   * @param schema Message descriptor
   * @param payload Message payload
   * @param opts Publish options (partitionKey, excludeSelf, meta)
   * @returns Result with success/failure and metrics
   */
  publish(
    topic: string,
    schema: MessageDescriptor,
    payload: unknown,
    opts?: PublishOptions,
  ): Promise<PublishResult>;

  /**
   * Topic introspection and subscription management.
   */
  topics: {
    list(): readonly string[] | Promise<readonly string[]>;
    has(topic: string): boolean | Promise<boolean>;
  };
}

export function withPubSub<TContext extends ConnectionData = ConnectionData>(
  opts: WithPubSubOptions,
): ReturnType<typeof definePlugin<TContext, WithPubSubAPI>> {
  const adapter = opts.adapter;
  const observer = opts.observer;

  return definePlugin<TContext, WithPubSubAPI>((router) => {
    // Track active send functions by client ID for local delivery
    const sends = new Map<string, (frame: unknown) => void | Promise<void>>();

    // Track observers for testing/instrumentation
    const observers: PubSubObserver[] = [];
    if (observer) {
      observers.push(observer);
    }

    /**
     * Notify all observers of an event.
     */
    const notifyObservers = async (
      method: keyof PubSubObserver,
      arg: any,
    ): Promise<void> => {
      // Fire all observers in parallel (don't block on slow observers)
      const promises = observers
        .map((obs) => obs[method]?.(arg))
        .filter(Boolean);
      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }
    };

    /**
     * Register a send function for a client when connection opens.
     * Called by lifecycle.handleOpen for each new WebSocket.
     */
    const onClientOpen = async (ws: any) => {
      // Get clientId from router's mapping
      const routerImpl = (router as any)[ROUTER_IMPL];
      const clientId = routerImpl?.getClientId?.(ws);
      if (clientId && typeof ws.send === "function") {
        sends.set(clientId, ws.send.bind(ws));
      }
    };

    /**
     * Unregister a send function for a client when connection closes.
     * Also unsubscribe from all topics to prevent ghost memberships.
     * Called by lifecycle.handleClose for each closed WebSocket.
     */
    const onClientClose = async (ws: any) => {
      // Get clientId from router's mapping
      const routerImpl = (router as any)[ROUTER_IMPL];
      const clientId = routerImpl?.getClientId?.(ws);
      if (!clientId) return;

      // Remove send function
      sends.delete(clientId);

      // Clean up subscriptions via adapter
      // Use replace() if available for atomic cleanup; otherwise fall back to unsubscribe
      try {
        if (typeof adapter.replace === "function") {
          // Atomic: replace subscriptions with empty set
          await adapter.replace(clientId, []);
        }
      } catch (err) {
        // Log error but don't crash shutdown
        const lifecycle = routerImpl.getInternalLifecycle?.();
        lifecycle?.handleError(err, null);
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
     * **Never throws for runtime conditions.** All expected failures return
     * a result object with ok:false and an error code.
     *
     * **excludeSelf handling:**
     * - When `excludeSelf: true`, the sender's clientId is added to envelope metadata
     *   as `excludeClientId`, and deliverLocally() skips that client during fan-out.
     * - This works for both router.publish() and ctx.publish() calls.
     *
     * @param topic - Topic name (validation is middleware responsibility)
     * @param schema - Message schema (for router observability and type name)
     * @param payload - Validated payload (may include meta from message schema)
     * @param opts - Optional: partitionKey (sharding hint), excludeSelf, meta
     * @param senderClientId - Optional: client ID of the publisher (for excludeSelf filtering)
     * @returns PublishResult with capability + matched (if knowable) or error
     */
    const publish = async (
      topic: string,
      schema: MessageDescriptor,
      payload: unknown,
      opts?: PublishOptions,
      senderClientId?: string,
    ): Promise<PublishResult> => {
      // Construct envelope: the message itself
      const envelope: PublishEnvelope = {
        topic: topic,
        payload,
        type: schema.messageType, // Schema type for observability
        ...(opts?.meta && { meta: opts.meta }), // Pass through optional metadata
      };

      // If excludeSelf is true and we know the sender's clientId,
      // store it in envelope metadata for deliverLocally to use
      if (opts?.excludeSelf === true && senderClientId) {
        envelope.meta = envelope.meta || {};
        (envelope.meta as any).excludeClientId = senderClientId;
      }

      // Construct adapter options (partitionKey, excludeSelf, signal)
      const publishOpts: PublishOptions | undefined = opts
        ? {
            ...(opts.partitionKey && { partitionKey: opts.partitionKey }),
            ...(opts.excludeSelf && { excludeSelf: opts.excludeSelf }),
            ...(opts.meta && { meta: opts.meta }),
            ...(opts.signal && { signal: opts.signal }),
          }
        : undefined;

      const result = await adapter.publish(envelope, publishOpts);

      // Notify observers after publish (success or failure)
      if (result.ok) {
        void notifyObservers("onPublish", {
          topic: envelope.topic,
          type: envelope.type,
          payload: envelope.payload,
          meta: envelope.meta,
          timestamp: Date.now(),
        });

        // Also notify router observers (for testing/monitoring via router.observe())
        const routerImpl = (router as any)[ROUTER_IMPL];
        if (routerImpl?.notifyPublish) {
          routerImpl.notifyPublish({
            topic: envelope.topic,
            type: envelope.type,
            payload: envelope.payload,
            meta: envelope.meta,
          });
        }
      }

      return result;
    };

    /**
     * Convenience helpers for querying topic state.
     */
    const topics = {
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

    /**
     * Register context enhancer to attach pub/sub methods.
     * Uses negative priority (-10) to run before validation plugins (priority 0),
     * ensuring ctx.publish exists when validation enhancers try to wrap it.
     */
    const api = getRouterPluginAPI(router);
    api.addContextEnhancer(
      (ctx: any) => {
        // Attach publish() method for broadcasting to topic subscribers
        ctx.publish = async (
          topic: string,
          schema: MessageDescriptor,
          payload: any,
          opts?: PublishOptions,
        ): Promise<PublishResult> => {
          // Pass the sender's clientId for excludeSelf filtering
          return await publish(topic, schema, payload, opts, ctx.clientId);
        };

        // Also store in extensions for validator plugin access
        ctx.extensions.set("pubsub", { publish: ctx.publish });

        // Attach topics helper for subscription management
        // Topics are scoped to this connection via ctx.clientId
        ctx.topics = {
          subscribe: async (topic: string): Promise<void> => {
            // Subscribe this client to a topic via the adapter
            // clientId is stable and unique per connection
            if (typeof adapter.subscribe === "function") {
              await adapter.subscribe(ctx.clientId, topic);
              // Notify observers after successful subscription
              void notifyObservers("onSubscribe", {
                clientId: ctx.clientId,
                topic,
                timestamp: Date.now(),
              });
            }
          },
          unsubscribe: async (topic: string): Promise<void> => {
            // Unsubscribe this client from a topic via the adapter
            if (typeof adapter.unsubscribe === "function") {
              await adapter.unsubscribe(ctx.clientId, topic);
              // Notify observers after successful unsubscription
              void notifyObservers("onUnsubscribe", {
                clientId: ctx.clientId,
                topic,
                timestamp: Date.now(),
              });
            }
          },
          has: (topic: string): boolean => {
            // Check if THIS client is subscribed to the topic
            // The adapter is responsible for tracking per-client subscriptions
            // For now, we rely on the adapter implementation
            // A more complete impl would maintain a per-connection set
            // This is a placeholder that requires adapter support
            // TODO: Implement per-connection subscription tracking via adapter
            return false;
          },
        };
      },
      { priority: -10 }, // Run before validation plugins (priority 0)
    );

    // Return the plugin API extensions with capability marker
    return {
      pubsub: {
        /**
         * Register an observer for pub/sub operations (testing, instrumentation).
         * Can be called multiple times to add multiple observers.
         * Returns an unsubscribe function to remove the observer.
         *
         * @example
         * ```ts
         * const observer = {
         *   onPublish(rec) { console.log(`Published: ${rec.topic}`); },
         *   onSubscribe(info) { console.log(`Subscribed: ${info.clientId} -> ${info.topic}`); },
         * };
         *
         * const unsub = router.pubsub.tap(observer);
         * // ... router operations ...
         * unsub(); // Remove observer
         * ```
         */
        tap(observer: PubSubObserver): () => void {
          observers.push(observer);
          // Return unsubscribe function
          return () => {
            const idx = observers.indexOf(observer);
            if (idx >= 0) observers.splice(idx, 1);
          };
        },

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
      publish,
      topics,
    };
  });
}
