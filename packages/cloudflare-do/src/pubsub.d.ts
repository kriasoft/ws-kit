import type { PubSubDriver, PublishEnvelope } from "@ws-kit/core/pubsub";
/**
 * Cloudflare Durable Object namespace interface for pub/sub.
 */
export interface DurableObjectNamespace {
  get(id: DurableObjectId): DurableObjectStub;
  idFromName(name: string): DurableObjectId;
}
export interface DurableObjectId {
  readonly id: string;
}
export interface DurableObjectStub {
  fetch(request: Request | string, options?: RequestInit): Promise<Response>;
}
/**
 * Options for Cloudflare DO pub/sub driver.
 */
export interface CloudflareDOPubSubOptions {
  /**
   * HTTP path for publish requests sent to DO.
   * @default "/publish"
   */
  publishPath?: string;
  /**
   * Custom encoder for PublishEnvelope → string.
   * @default JSON.stringify
   */
  encode?: (envelope: PublishEnvelope) => string;
  /**
   * Custom decoder for string → PublishEnvelope.
   * @default JSON.parse
   */
  decode?: (data: string) => PublishEnvelope;
}
/**
 * Cloudflare Durable Objects pub/sub driver: subscription index + DO publish.
 *
 * Uses Durable Objects as a pub/sub coordinator. Each topic maps to a single DO
 * instance (via `idFromName(topic)`). Publishing sends an HTTP request to the DO,
 * which handles broadcasting to other instances.
 *
 * **Local stats only**: `matchedLocal` reflects process-local subscribers.
 * For distributed systems, use `capability: "unknown"` (we can't know global count).
 *
 * Usage:
 * ```ts
 * import { durableObjectsPubSub, durableObjectsConsumer } from "@ws-kit/cloudflare-do";
 *
 * const driver = durableObjectsPubSub(env.DO_NAMESPACE);
 * const consumer = durableObjectsConsumer(env.DO_NAMESPACE);
 *
 * // Wire consumer to router delivery (via DO alarms, queues, or webhooks)
 * consumer.start((envelope) => deliverLocally(driver, envelope));
 * ```
 *
 * **Implementation notes**:
 * - Each topic → one DO instance (via `idFromName(topic)`)
 * - Publishing sends HTTP POST to DO at `{publishPath}`
 * - DO handles inbound message distribution (via alarms, queues, webhooks, etc.)
 * - Ingress wires DO callbacks back to router for local delivery
 */
export declare function durableObjectsPubSub(
  namespace: DurableObjectNamespace,
  opts?: CloudflareDOPubSubOptions,
): PubSubDriver;
//# sourceMappingURL=pubsub.d.ts.map
