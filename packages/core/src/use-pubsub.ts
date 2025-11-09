// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  MessageContext,
  MessageSchemaType,
  Middleware,
  UsePubSubOptions,
  WebSocketData,
} from "./types.js";
import { PubSubError, type PubSubAclDetails } from "./pubsub-error.js";

/**
 * Pub/Sub middleware factory for topic authorization, normalization, and lifecycle hooks.
 *
 * Provides a composable middleware that intercepts topic operations and applies:
 * - Topic normalization (lowercase, trim, etc.)
 * - Authorization checks (per-topic access control)
 * - Lifecycle hooks (logging, analytics, cleanup)
 *
 * Per spec docs/specs/pubsub.md#configuration--middleware
 *
 * @param options - Hook configuration (all optional)
 * @returns Middleware that enforces pub/sub policies
 *
 * @example
 * ```typescript
 * const router = createRouter<AppData>();
 *
 * router.use(
 *   usePubSub({
 *     normalize: (topic) => topic.toLowerCase(),
 *     authorizeSubscribe: (ctx, topic) => {
 *       if (topic.startsWith("user:notifications:")) {
 *         const userId = topic.split(":").pop();
 *         return ctx.ws.data.userId === userId;
 *       }
 *       return true; // Public topics
 *     },
 *     onSubscribe: (ctx, topic) => {
 *       logger.info(`User subscribed to ${topic}`);
 *     },
 *   }),
 * );
 * ```
 */
export function usePubSub<TData extends WebSocketData = WebSocketData>(
  options?: UsePubSubOptions<TData>,
): Middleware<TData> {
  // Extract options with defaults
  const {
    normalize = (topic: string) => topic,
    authorizeSubscribe,
    // authorizePublish, // Future: use for publish() hook when implemented
    onSubscribe,
    onUnsubscribe,
    invalidateAuth,
  } = options || {};

  return async (ctx: MessageContext<MessageSchemaType, TData>, next) => {
    // Wrap ctx.topics methods with hooks
    const topics = ctx.topics;

    // Store original methods
    const originalSubscribe = topics.subscribe.bind(topics);
    const originalUnsubscribe = topics.unsubscribe.bind(topics);
    const originalSubscribeMany = topics.subscribeMany.bind(topics);
    const originalUnsubscribeMany = topics.unsubscribeMany.bind(topics);
    const originalReplace = topics.replace.bind(topics);
    const originalClear = topics.clear.bind(topics);

    // Wrap subscribe with hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.topics as any).subscribe = async (topic: string) => {
      // Step 1: Normalize
      const normalized = normalize(topic);

      // Step 2: Authorize (if provided)
      if (authorizeSubscribe) {
        const authorized = await authorizeSubscribe(ctx, normalized);
        if (!authorized) {
          const details: PubSubAclDetails = {
            op: "subscribe",
            topic: normalized,
          };
          throw new PubSubError(
            "ACL_SUBSCRIBE",
            `Not authorized to subscribe to topic "${normalized}"`,
            details,
          );
        }
      }

      // Step 3-7: Call original (handles validation, adapter call, mutation, lifecycle)
      // Note: Original doesn't have hooks yet, so we call it then fire lifecycle hooks
      const wasAlreadySubscribed = topics.has(normalized);
      await originalSubscribe(normalized);

      // Step 7: Lifecycle hook (fire-and-forget, no rollback on error)
      if (!wasAlreadySubscribed && onSubscribe) {
        try {
          await onSubscribe(ctx, normalized);
        } catch (err) {
          // Log but don't rethrow (best-effort hook)
          console.error(
            `[ws] Error in onSubscribe hook for topic "${normalized}":`,
            err,
          );
        }
      }
    };

    // Wrap unsubscribe with hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.topics as any).unsubscribe = async (topic: string) => {
      // Step 1: Normalize (but don't validate/authorize on unsubscribe if not subscribed)
      const normalized = normalize(topic);

      // Check if currently subscribed before proceeding
      const wasSubscribed = topics.has(normalized);
      if (!wasSubscribed) {
        // Soft no-op: skip validation and hooks
        return;
      }

      // Step 2: Validate (only if currently subscribed)
      // This is handled by original method

      // Step 3-7: Call original
      await originalUnsubscribe(normalized);

      // Step 7: Lifecycle hook (fire-and-forget, no rollback on error)
      if (onUnsubscribe) {
        try {
          await onUnsubscribe(ctx, normalized);
        } catch (err) {
          // Log but don't rethrow (best-effort hook)
          console.error(
            `[ws] Error in onUnsubscribe hook for topic "${normalized}":`,
            err,
          );
        }
      }
    };

    // Wrap subscribeMany with hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.topics as any).subscribeMany = async (topicList: Iterable<string>) => {
      // Normalize all topics first
      const normalized = Array.from(topicList).map(normalize);
      const uniqueTopics = new Set(normalized);

      // Authorize all topics (before any adapter calls)
      if (authorizeSubscribe) {
        for (const topic of uniqueTopics) {
          const authorized = await authorizeSubscribe(ctx, topic);
          if (!authorized) {
            const details: PubSubAclDetails = {
              op: "subscribe",
              topic,
            };
            throw new PubSubError(
              "ACL_SUBSCRIBE",
              `Not authorized to subscribe to topic "${topic}"`,
              details,
            );
          }
        }
      }

      // Track which topics were already subscribed
      const wasSubscribed = new Set<string>();
      for (const topic of uniqueTopics) {
        if (topics.has(topic)) {
          wasSubscribed.add(topic);
        }
      }

      // Call original (handles validation, adapter, mutation)
      const result = await originalSubscribeMany(normalized);

      // Fire lifecycle hooks for newly subscribed topics (fire-and-forget)
      if (onSubscribe && result.added > 0) {
        for (const topic of uniqueTopics) {
          if (!wasSubscribed.has(topic)) {
            try {
              await onSubscribe(ctx, topic);
            } catch (err) {
              console.error(
                `[ws] Error in onSubscribe hook for topic "${topic}":`,
                err,
              );
            }
          }
        }
      }

      return result;
    };

    // Wrap unsubscribeMany with hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.topics as any).unsubscribeMany = async (
      topicList: Iterable<string>,
    ) => {
      // Normalize all topics
      const normalized = Array.from(topicList).map(normalize);
      const uniqueTopics = new Set(normalized);

      // Track which topics were subscribed before
      const wasSubscribed = new Set<string>();
      for (const topic of uniqueTopics) {
        if (topics.has(topic)) {
          wasSubscribed.add(topic);
        }
      }

      // Call original (handles soft no-op, validation, adapter, mutation)
      const result = await originalUnsubscribeMany(normalized);

      // Fire lifecycle hooks for actually unsubscribed topics (fire-and-forget)
      if (onUnsubscribe && result.removed > 0) {
        for (const topic of wasSubscribed) {
          try {
            await onUnsubscribe(ctx, topic);
          } catch (err) {
            console.error(
              `[ws] Error in onUnsubscribe hook for topic "${topic}":`,
              err,
            );
          }
        }
      }

      return result;
    };

    // Wrap replace with hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.topics as any).replace = async (
      topicList: Iterable<string>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options?: any,
    ) => {
      // Normalize all desired topics
      const normalized = Array.from(topicList).map(normalize);
      const desiredTopics = new Set(normalized);

      // Authorize all topics being added (those not currently subscribed)
      if (authorizeSubscribe) {
        for (const topic of desiredTopics) {
          if (!topics.has(topic)) {
            const authorized = await authorizeSubscribe(ctx, topic);
            if (!authorized) {
              const details: PubSubAclDetails = {
                op: "subscribe",
                topic,
              };
              throw new PubSubError(
                "ACL_SUBSCRIBE",
                `Not authorized to subscribe to topic "${topic}"`,
                details,
              );
            }
          }
        }
      }

      // Track current state
      const currentTopics = new Set(Array.from(topics));

      // Call original
      const result = await originalReplace(normalized, options);

      // Fire lifecycle hooks for changes (fire-and-forget)
      // Topics added
      if (onSubscribe) {
        for (const topic of desiredTopics) {
          if (!currentTopics.has(topic)) {
            try {
              await onSubscribe(ctx, topic);
            } catch (err) {
              console.error(
                `[ws] Error in onSubscribe hook for topic "${topic}":`,
                err,
              );
            }
          }
        }
      }

      // Topics removed
      if (onUnsubscribe) {
        for (const topic of currentTopics) {
          if (!desiredTopics.has(topic)) {
            try {
              await onUnsubscribe(ctx, topic);
            } catch (err) {
              console.error(
                `[ws] Error in onUnsubscribe hook for topic "${topic}":`,
                err,
              );
            }
          }
        }
      }

      return result;
    };

    // Wrap clear with hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.topics as any).clear = async () => {
      // Track current topics for lifecycle hooks
      const currentTopics = Array.from(topics);

      // Call original
      const result = await originalClear();

      // Fire lifecycle hooks (fire-and-forget)
      if (onUnsubscribe) {
        for (const topic of currentTopics) {
          try {
            await onUnsubscribe(ctx, topic);
          } catch (err) {
            console.error(
              `[ws] Error in onUnsubscribe hook for topic "${topic}":`,
              err,
            );
          }
        }
      }

      return result;
    };

    // Store invalidateAuth on context for apps to call
    if (invalidateAuth) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx as any).invalidatePubSubAuth = () => invalidateAuth(ctx);
    }

    // Continue to next middleware
    return next();
  };
}
