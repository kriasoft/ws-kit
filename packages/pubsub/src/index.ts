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
 * import { createRouter } from "@ws-kit/core";
 * import { withPubSub, createMemoryAdapter, usePubSub } from "@ws-kit/pubsub";
 *
 * const router = createRouter()
 *   .plugin(withPubSub(createMemoryAdapter()))
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

// Adapters
// The in-memory pub/sub adapter is also available via @ws-kit/adapters/memory as memoryPubSub()
export { createMemoryAdapter } from "./adapters/memory";

// Middleware
export { usePubSub, type UsePubSubOptions } from "./middleware";

// Types
export type {
  PubSubAdapter,
  PubSubMessage,
  MinimalContext,
  Topics,
  TopicMutateOptions,
  PublishOptions,
  PublishResult,
  PubSubPolicyHooks,
} from "./types";
