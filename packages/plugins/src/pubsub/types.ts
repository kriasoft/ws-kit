// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Types for the withPubSub() plugin.
 *
 * Provides topic-based pub/sub messaging with pluggable adapters.
 */

import type {
  PubSubAdapter,
  PubSubDriver,
  PublishCapability,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core";

/**
 * Configuration for the withPubSub() plugin.
 */
export interface WithPubSubOptions {
  /**
   * The pub/sub adapter implementation.
   * Adapters can be memory-based (for dev), Redis-backed (for distributed),
   * or custom implementations.
   */
  adapter: PubSubDriver;

  /**
   * Optional observer for testing and instrumentation.
   * Receives events for publish and subscribe operations.
   */
  observer?: PubSubObserver;

  /**
   * Optional limits for subscriptions.
   */
  limits?: {
    /**
     * Maximum number of topics a single connection can subscribe to.
     * Default: 1000
     */
    maxTopicsPerConn?: number;
  };

  /**
   * Optional topic validation and normalization.
   */
  topic?: {
    /**
     * Normalize topic names (e.g., convert to lowercase).
     * Called before all topic operations.
     */
    normalize?: (topic: string) => string;

    /**
     * Validate topic names.
     * Throw an error to reject invalid topics.
     */
    validate?: (topic: string) => void;
  };
}

/**
 * Observer interface for pub/sub events (testing, instrumentation).
 */
export interface PubSubObserver {
  /**
   * Called after a message is published to a topic.
   */
  onPublish?(record: {
    topic: string;
    type?: string;
    payload?: any;
    meta?: Record<string, unknown>;
    timestamp: number;
  }): void | Promise<void>;

  /**
   * Called after a client subscribes to a topic.
   */
  onSubscribe?(info: {
    clientId: string;
    topic: string;
    timestamp: number;
  }): void | Promise<void>;

  /**
   * Called after a client unsubscribes from a topic.
   */
  onUnsubscribe?(info: {
    clientId: string;
    topic: string;
    timestamp: number;
  }): void | Promise<void>;
}

/**
 * Pub/Sub plugin capability interface.
 *
 * Provides context methods for pub/sub messaging.
 * Added to context when withPubSub() plugin is applied.
 */
export interface WithPubSubCapability {
  /**
   * Marker for capability-gating in type system.
   * @internal
   */
  readonly pubsub: true;
}
