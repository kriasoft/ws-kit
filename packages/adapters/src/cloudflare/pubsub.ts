// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  PubSubDriver,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core/pubsub";
import { memoryPubSub } from "../memory/pubsub.js";

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
 * import { durableObjectsPubSub, durableObjectsConsumer } from "@ws-kit/cloudflare";
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

      // Return local stats only
      let matchedLocal = 0;
      for await (const _id of local.getLocalSubscribers(envelope.topic)) {
        matchedLocal++;
      }

      return {
        ok: true,
        capability: "unknown", // Distributed adapter: can't know global count
        matchedLocal, // Local-only: process subscribers only
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
