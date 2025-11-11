/**
 * Test utilities for Pub/Sub: TestPubSub wrapper for capturing published messages.
 *
 * Useful for testing applications using pub/sub functionality.
 *
 * @internal
 */

import type { PubSubAdapter, PubSubMessage } from "@ws-kit/core";

/**
 * Published message frame captured for testing.
 */
export interface PublishedFrame {
  topic: string;
  schema: any;
  payload: unknown;
  meta: Record<string, unknown> | undefined;
}

/**
 * Wraps a PubSubAdapter to capture all published messages.
 * Useful for assertions about what was broadcast.
 *
 * @example
 * ```ts
 * const adapter = createMemoryAdapter();
 * const testAdapter = new TestPubSub(adapter);
 *
 * await testAdapter.publish({ topic: "chat", schema: ChatMessage, payload: { text: "hello" } });
 *
 * const published = testAdapter.getPublishedMessages();
 * expect(published).toHaveLength(1);
 * expect(published[0].topic).toBe("chat");
 * ```
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
