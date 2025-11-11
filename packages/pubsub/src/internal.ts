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
  PubSubAdapter,
  PubSubMessage,
  MessageDescriptor,
  MinimalContext,
  Middleware,
  ServerWebSocket,
} from "@ws-kit/core";

export type {
  Topics,
  TopicMutateOptions,
  PublishOptions,
  PublishResult,
} from "./types";

// Core pub/sub primitives (internal implementation details)
export { TopicsImpl, createTopicValidator } from "./core/topics";
export type { TopicValidator } from "./core/topics";

export { PubSubError, AbortError } from "./core/error";
export type { PubSubErrorCode, PubSubAclDetails } from "./core/error";

export { DEFAULT_TOPIC_PATTERN, MAX_TOPIC_LENGTH } from "./core/constants";

/**
 * Symbol for accessing internal adapter state in tests.
 * @internal
 */
export const ADAPTER_INTERNALS = Symbol("@ws-kit/pubsub/adapter-internals");
