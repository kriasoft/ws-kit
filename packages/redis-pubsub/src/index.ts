/**
 * @ws-kit/redis-pubsub - Redis PubSub adapter for cross-process broadcasting
 *
 * Provides a Redis-based PubSub adapter for WS-Kit, enabling:
 * - Cross-process broadcasting across multiple server instances
 * - Automatic connection management with exponential backoff
 * - Strict message serialization (JSON/text contracts)
 * - Channel namespace support for multi-tenancy
 * - Pattern subscriptions with Redis PSUBSCRIBE
 *
 * ## Semantics
 *
 * - **Delivery**: At-least-once (messages may be redelivered on reconnect)
 * - **Ordering**: Per-channel FIFO; unordered across reconnects
 * - **Publish while disconnected**: Fails immediately (no buffering)
 * - **Serialization**: Strict JSON/text; no auto-detection
 * - **Lifecycle**: If you pass `client`, you own cleanup; RedisPubSub owns created clients
 *
 * ## Example
 *
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { createBunAdapter } from "@ws-kit/bun";
 * import { createRedisPubSub } from "@ws-kit/redis-pubsub";
 *
 * const router = createRouter({
 *   platform: createBunAdapter(),
 *   pubsub: createRedisPubSub({ url: "redis://localhost:6379" }),
 * });
 * ```
 */

export { RedisPubSub, createRedisPubSub } from "./pubsub.js";
export type {
  RedisPubSubOptions,
  MessageHandler,
  Unsubscribe,
  EventHandler,
  Subscription,
  PublishResult,
  PubSubStatus,
  PubSubEvent,
  Events,
  PublishOpts,
  SubscribeOpts,
  OnceOpts,
  PonceOpts,
  RetryPolicy,
} from "./types.js";

export {
  PubSubError,
  PublishError,
  SubscribeError,
  SerializationError,
  DeserializationError,
  DisconnectedError,
  ConfigurationError,
  MaxSubscriptionsExceededError,
} from "./errors.js";
export type { PubSubErrorCode } from "./errors.js";
