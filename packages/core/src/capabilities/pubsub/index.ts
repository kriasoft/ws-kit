// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Pub/Sub adapter interface and supporting types.
 * Entry point for @ws-kit/core/pubsub sub-path export.
 *
 * Public: PubSubAdapter (unified interface for all adapters)
 * Internal/Optional: PubSubDriver, BrokerConsumer (for advanced composition)
 */

export type {
  BrokerConsumer,
  PubSubAdapter,
  PubSubDriver,
  PublishCapability,
  PublishEnvelope,
  PublishError,
  PublishOptions,
  PublishResult,
  StopFn,
} from "./adapter";

export {
  PUBLISH_ERROR_RETRYABLE,
  ensurePublishSuccess,
  isPublishSuccess,
  wasDeliveredLocally,
} from "./adapter";

export { isPublishError } from "../../core/types";
