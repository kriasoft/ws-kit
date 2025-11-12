// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/pubsub middleware — policy enforcement for pub/sub operations
 */

import type { Middleware, MinimalContext } from "@ws-kit/core";
import type { PubSubPolicyHooks, Topics } from "./types";

/**
 * Options for usePubSub middleware.
 */
export interface UsePubSubOptions<TContext = unknown> {
  /**
   * Policy hooks for normalization and authorization.
   */
  hooks?: PubSubPolicyHooks<TContext>;
}

/**
 * Create a middleware that enforces pub/sub policies (normalization, authorization).
 *
 * This middleware wraps ctx.topics and ctx.publish methods to apply
 * normalization (e.g., lowercase topics) and authorization checks before
 * delegating to the actual adapter.
 *
 * Usage:
 * ```ts
 * const router = createRouter()
 *   .use(usePubSub({
 *     hooks: {
 *       normalizeTopic: (topic) => topic.toLowerCase(),
 *       authorize: async (action, topic, ctx) => {
 *         if (action === "subscribe" && !ctx.data.canSubscribe) {
 *           throw new Error("Not authorized");
 *         }
 *       },
 *     },
 *   }));
 * ```
 */
export function usePubSub<TContext = unknown>(
  options?: UsePubSubOptions<TContext>,
): Middleware<TContext> {
  const { hooks } = options ?? {};

  return async (ctx, next) => {
    const contextWithPubSub = ctx as any;
    const clientId = contextWithPubSub.ws?.clientId;

    // Wrap ctx.topics methods if they exist
    if (contextWithPubSub.topics) {
      const topics = contextWithPubSub.topics as Topics;
      const wrappedTopics = wrapTopicsWithPolicies(
        topics,
        hooks,
        clientId,
        ctx.data as TContext,
      );
      contextWithPubSub.topics = wrappedTopics;
    }

    // Wrap ctx.publish method if it exists
    if (contextWithPubSub.publish) {
      const originalPublish = contextWithPubSub.publish.bind(contextWithPubSub);
      contextWithPubSub.publish = async (
        topic: string,
        schema: any,
        payload: unknown,
        opts?: any,
      ) => {
        if (hooks?.normalizeTopic) {
          topic = hooks.normalizeTopic(topic, {
            clientId,
            data: ctx.data as TContext,
          });
        }
        if (hooks?.authorize) {
          await hooks.authorize("publish", topic, {
            clientId,
            data: ctx.data as TContext,
          });
        }
        return originalPublish(topic, schema, payload, opts);
      };
    }

    return next();
  };
}

/**
 * Wrap Topics methods with policy enforcement.
 */
function wrapTopicsWithPolicies<TContext>(
  topics: Topics,
  hooks: PubSubPolicyHooks<TContext> | undefined,
  clientId: string,
  data: TContext,
): Topics {
  const wrapped = {
    ...topics,

    async subscribe(topic: string, options?: any) {
      topic = normalizeTopic(topic, hooks, clientId, data);
      await authorizeOperation("subscribe", topic, hooks, clientId, data);
      return topics.subscribe(topic, options);
    },

    async unsubscribe(topic: string, options?: any) {
      topic = normalizeTopic(topic, hooks, clientId, data);
      await authorizeOperation("unsubscribe", topic, hooks, clientId, data);
      return topics.unsubscribe(topic, options);
    },

    async subscribeMany(topicList: Iterable<string>, options?: any) {
      const normalized = Array.from(topicList).map((topic) =>
        normalizeTopic(topic, hooks, clientId, data),
      );

      for (const topic of normalized) {
        await authorizeOperation("subscribe", topic, hooks, clientId, data);
      }

      return topics.subscribeMany(normalized, options);
    },

    async unsubscribeMany(topicList: Iterable<string>, options?: any) {
      const normalized = Array.from(topicList).map((topic) =>
        normalizeTopic(topic, hooks, clientId, data),
      );

      for (const topic of normalized) {
        await authorizeOperation("unsubscribe", topic, hooks, clientId, data);
      }

      return topics.unsubscribeMany(normalized, options);
    },

    async clear(options?: any) {
      return topics.clear(options);
    },

    async replace(topicList: Iterable<string>, options?: any) {
      const normalized = Array.from(topicList).map((topic) =>
        normalizeTopic(topic, hooks, clientId, data),
      );

      for (const topic of normalized) {
        await authorizeOperation("subscribe", topic, hooks, clientId, data);
      }

      return topics.replace(normalized, options);
    },

    // ReadonlySet interface
    has(topic: string): boolean {
      topic = normalizeTopic(topic, hooks, clientId, data);
      return topics.has(topic);
    },

    get size(): number {
      return topics.size;
    },

    entries(): IterableIterator<[string, string]> {
      return topics.entries();
    },

    keys(): IterableIterator<string> {
      return topics.keys();
    },

    values(): IterableIterator<string> {
      return topics.values();
    },

    [Symbol.iterator](): IterableIterator<string> {
      return topics[Symbol.iterator]();
    },

    forEach(
      callback: (value: string, key: string, set: ReadonlySet<string>) => void,
      thisArg?: unknown,
    ): void {
      return topics.forEach(callback, thisArg);
    },
  } as unknown as Topics;

  return wrapped;
}

/**
 * Apply topic normalization if configured.
 */
function normalizeTopic<TContext>(
  topic: string,
  hooks: PubSubPolicyHooks<TContext> | undefined,
  clientId: string,
  data: TContext,
): string {
  if (!hooks?.normalizeTopic) {
    return topic;
  }
  return hooks.normalizeTopic(topic, {
    clientId,
    data,
  });
}

/**
 * Check authorization if configured.
 */
async function authorizeOperation<TContext>(
  action: "subscribe" | "unsubscribe" | "publish",
  topic: string,
  hooks: PubSubPolicyHooks<TContext> | undefined,
  clientId: string,
  data: TContext,
): Promise<void> {
  if (!hooks?.authorize) {
    return;
  }
  await hooks.authorize(action, topic, {
    clientId,
    data,
  });
}
