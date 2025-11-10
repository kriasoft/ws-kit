/**
 * Pub/Sub adapter contract (core-level).
 * Implementations: in-memory, Redis, Kafka, etc.
 *
 * Core provides only the interface; adapters implement publish/subscribe.
 */

import type { MessageDescriptor } from "../../protocol/message-descriptor";

export interface PubSubMessage {
  topic: string;
  schema: MessageDescriptor;
  payload: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Pub/Sub adapter: manages topic subscriptions and publishing.
 */
export interface PubSubAdapter {
  /**
   * Publish message to topic (1-to-many broadcast).
   */
  publish(msg: PubSubMessage): Promise<void>;

  /**
   * Subscribe connection to topic.
   */
  subscribe(clientId: string, topic: string): Promise<void>;

  /**
   * Unsubscribe connection from topic.
   */
  unsubscribe(clientId: string, topic: string): Promise<void>;

  /**
   * List all active topics (process-local or distributed, depending on adapter).
   */
  listTopics(): readonly string[];

  /**
   * Check if topic has any subscribers.
   */
  hasTopic(topic: string): boolean;
}
