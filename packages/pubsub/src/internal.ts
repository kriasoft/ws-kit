// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Internal exports for adapter implementations and tests.
 *
 * This file is not part of the public API.
 * Only use these exports if you are implementing a custom PubSubAdapter
 * or writing tests for the pubsub package.
 *
 * @internal
 */

export type {
  BrokerConsumer,
  PublishEnvelope,
  PublishOptions,
  PubSubAdapter,
  PubSubDriver,
} from "@ws-kit/core/pubsub";

export type {
  MessageDescriptor,
  Middleware,
  MinimalContext,
  ServerWebSocket,
} from "@ws-kit/core";

export type {
  PublishResult,
  PubSubObserver,
  TopicMutateOptions,
  Topics,
  WithPubSubOptions,
} from "./types.js";

// Composition utilities for adapter authors
export { combineBrokers, withBroker } from "./compose.js";
export type { BrokerStartMode } from "./compose.js";

// Core pub/sub primitives (internal implementation details)
export {
  createTopics,
  createTopicValidator,
  OptimisticTopics,
} from "./core/topics.js";
// Backward compatibility alias (deprecated, use OptimisticTopics instead)
export type { TopicValidator } from "./core/topics.js";

export { AbortError, PubSubError } from "./core/error.js";
export type { PubSubAclDetails, PubSubErrorCode } from "./core/error.js";

export {
  DEFAULT_TOPIC_MAX_LENGTH,
  DEFAULT_TOPIC_PATTERN,
} from "./core/constants.js";

// Test utilities
export { TestPubSub } from "./test-utils.js";
export type { PublishRecord } from "./test-utils.js";

/**
 * Symbol for accessing internal adapter state in tests.
 * @internal
 */
export const ADAPTER_INTERNALS = Symbol("@ws-kit/pubsub/adapter-internals");
