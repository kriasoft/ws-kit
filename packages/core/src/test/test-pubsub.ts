/**
 * Test PubSub wrapper: intercepts publish calls for assertions.
 * Delegates actual behavior to wrapped adapter.
 */

import type { PubSubAdapter, PubSubMessage } from "../capabilities/pubsub/contracts";
import type { PublishedFrame } from "./types";

/**
 * Wraps a PubSubAdapter to capture all published messages.
 * Useful for assertions about what was broadcast.
 */
export class TestPubSub implements PubSubAdapter {
  private publishedMessages: PublishedFrame[] = [];

  constructor(private wrapped: PubSubAdapter) {}

  /**
   * Publish a message and record it.
   */
  async publish(msg: PubSubMessage): Promise<void> {
    // Record the message
    this.publishedMessages.push({
      topic: msg.topic,
      schema: msg.schema,
      payload: msg.payload,
      meta: msg.meta,
    });

    // Delegate to wrapped adapter
    await this.wrapped.publish(msg);
  }

  /**
   * Subscribe (delegated).
   */
  async subscribe(clientId: string, topic: string): Promise<void> {
    return this.wrapped.subscribe(clientId, topic);
  }

  /**
   * Unsubscribe (delegated).
   */
  async unsubscribe(clientId: string, topic: string): Promise<void> {
    return this.wrapped.unsubscribe(clientId, topic);
  }

  /**
   * List topics (delegated).
   */
  listTopics(): readonly string[] {
    return this.wrapped.listTopics();
  }

  /**
   * Check if topic exists (delegated).
   */
  hasTopic(topic: string): boolean {
    return this.wrapped.hasTopic(topic);
  }

  // Test-specific helpers

  /**
   * Get all published messages.
   */
  getPublishedMessages(): readonly PublishedFrame[] {
    return this.publishedMessages;
  }

  /**
   * Clear published messages.
   */
  clearPublished(): void {
    this.publishedMessages = [];
  }
}
