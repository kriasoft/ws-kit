// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/pubsub — In-memory pub/sub plugin for WS-Kit
 *
 * Provides a lightweight, local pub/sub implementation with optional
 * policy enforcement via middleware (topic normalization, authorization).
 *
 * ## Quick Start
 *
 * ```ts
 * import { createRouter } from "@ws-kit/zod";
 * import { withPubSub, usePubSub } from "@ws-kit/pubsub";
 * import { memoryPubSub } from "@ws-kit/memory";
 *
 * const router = createRouter()
 *   .plugin(withPubSub({ adapter: memoryPubSub() }))
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
 *
 * router.on(Message, (ctx) => {
 *   await ctx.topics.subscribe("room:123");
 *   ctx.publish("room:123", NotifySchema, { text: "Hello" });
 * });
 * ```
 */

// Plugin
export { withPubSub } from "./plugin";

// Middleware
export { usePubSub, type UsePubSubOptions } from "./middleware";

// Types
export type {
  PublishEnvelope,
  PublishOptions,
  PublishResult,
  PubSubAdapter,
  PubSubPolicyHooks,
  TopicMutateOptions,
  Topics,
  VerifyResult,
} from "./types";

export { isSubscribed } from "./core/topics";
export type { TopicValidator } from "./core/topics";
