// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubDriver,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core/pubsub";
import { memoryPubSub } from "@ws-kit/memory";

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
 * **Capability**: Returns `capability: "unknown"` since Durable Objects cannot
 * reliably count global subscribers across all instances.
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
export function durableObjectsPubSub(
  namespace: DurableObjectNamespace,
  opts?: CloudflareDOPubSubOptions,
): PubSubDriver {
  const { publishPath = "/publish", encode = JSON.stringify } = opts ?? {};

  // Maintain local subscription index
  const local = memoryPubSub();

  return {
    async publish(
      envelope: PublishEnvelope,
      _opts?: PublishOptions,
    ): Promise<PublishResult> {
      // Send to topic's DO (one DO per topic via idFromName)
      const doId = namespace.idFromName(envelope.topic);
      const stub = namespace.get(doId);
      const body = encode(envelope);

      try {
        const response = await stub.fetch(publishPath, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          console.error(
            `[durableObjectsDriver] publish to ${envelope.topic} failed: ${response.status}`,
          );
        }
      } catch (err) {
        // Log error but don't fail the entire publish
        console.error(
          `[durableObjectsDriver] publish to ${envelope.topic} failed:`,
          err,
        );
      }

      // Return capability only (Durable Objects can't reliably count global subscribers)
      return {
        ok: true,
        capability: "unknown", // Distributed adapter: can't know global count
      };
    },

    subscribe: (clientId: string, topic: string): Promise<void> =>
      local.subscribe(clientId, topic),

    unsubscribe: (clientId: string, topic: string): Promise<void> =>
      local.unsubscribe(clientId, topic),

    getLocalSubscribers: (topic: string): AsyncIterable<string> =>
      local.getLocalSubscribers(topic),

    listTopics: local.listTopics?.bind(local),

    hasTopic: local.hasTopic?.bind(local),
  };
}
