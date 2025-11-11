import type { BrokerConsumer, PublishEnvelope } from "@ws-kit/core/pubsub";
/**
 * Options for Cloudflare DO consumer.
 */
export interface CloudflareDOConsumerOptions {
  /**
   * Custom decoder for string → PublishEnvelope.
   * @default JSON.parse
   */
  decode?: (data: string) => PublishEnvelope;
}
/**
 * Cloudflare Durable Objects broker consumer: receives messages from DO and invokes handler.
 *
 * **Responsibility**: Wire DO callbacks (alarms, queues, webhooks) → `onMessage(envelope)`.
 * **Not responsibility**: Subscription indexing, local delivery, DO state management.
 *
 * Works with `durableObjectsPubSub()` driver; router/platform wires the delivery:
 * ```ts
 * const driver = durableObjectsPubSub(env.DO_NAMESPACE);
 * const consumer = durableObjectsConsumer();
 *
 * consumer.start((envelope) => {
 *   // router calls deliverLocally(driver, envelope)
 * });
 * ```
 *
 * **Implementation in your DO**:
 * In your Durable Object's `fetch()` handler, call the router's consumer callback:
 * ```ts
 * export class TopicDO {
 *   constructor(state: DurableObjectState, env: Env) {
 *     this.env = env;
 *     this.ingress = env.INGRESS_CALLBACK; // Or use WebSocket broadcast
 *   }
 *
 *   async fetch(request: Request) {
 *     if (request.url.endsWith("/publish")) {
 *       const envelope = await request.json();
 *       // Call back to router/platform ingress handler
 *       await this.ingress?.(envelope);
 *     }
 *   }
 * }
 * ```
 *
 * **Delivery patterns** (pick one):
 * 1. **HTTP callback** — DO calls back to router via HTTP after receiving publish
 * 2. **Alarm** — DO schedules alarm, wakes up, calls callback
 * 3. **Queue** — DO sends messages to Cloudflare Queue, router consumes
 * 4. **WebSocket broadcast** — DO holds WebSocket connections, broadcasts directly
 * 5. **Pub/Sub** — Use Cloudflare Pub/Sub for distributed message passing
 *
 * This ingress interface is intentionally minimal; routing and DO implementation
 * are provided by your application code.
 */
export declare function durableObjectsConsumer(
  opts?: CloudflareDOConsumerOptions,
): BrokerConsumer;
/**
 * Helper: decode and invoke consumer handler for a message.
 *
 * Use this in your Durable Object to wire published messages back to the router:
 * ```ts
 * // In your DO's fetch handler (POST /publish)
 * const envelope = JSON.parse(await request.text());
 * await consumerHandler(envelope); // or await handleDOPublish(consumer, body)
 * ```
 */
export declare function handleDOPublish(
  consumer: BrokerConsumer,
  body: string,
  decode?: (data: string) => PublishEnvelope,
): Promise<void>;
//# sourceMappingURL=consumer.d.ts.map
