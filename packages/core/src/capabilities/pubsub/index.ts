// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Pub/Sub driver and broker consumer contracts and types.
 * Entry point for @ws-kit/core/pubsub sub-path export.
 */

export type {
  BrokerConsumer,
  PubSubDriver,
  PublishCapability,
  PublishEnvelope,
  PublishError,
  PublishOptions,
  PublishResult,
} from "./adapter";

export {
  PUBLISH_ERROR_RETRYABLE,
  ensurePublishSuccess,
  isPublishError,
  isPublishSuccess,
  wasDeliveredLocally,
} from "./adapter";
