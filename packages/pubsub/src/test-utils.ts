/**
 * Test utilities for Pub/Sub: TestPubSub wrapper for capturing published messages.
 *
 * Useful for testing applications using pub/sub functionality.
 *
 * @internal
 */

import type {
  PubSubAdapter,
  PublishEnvelope,
  PublishOptions,
  PublishResult,
} from "@ws-kit/core/pubsub";

/**
 * Published message frame captured for testing.
 */
export interface PublishedFrame {
  topic: string;
  payload: unknown;
  type?: string;
  meta: Record<string, unknown> | undefined;
}

/**
 * Wraps a PubSubAdapter to capture all published messages.
 * Useful for assertions about what was broadcast.
 *
 * @example
 * ```ts
 * import { memoryPubSub } from "@ws-kit/memory";
 *
 * const adapter = memoryPubSub();
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
  async publish(
    envelope: PublishEnvelope,
    opts?: PublishOptions,
  ): Promise<PublishResult> {
    // Record the message
    this.publishedMessages.push({
      topic: envelope.topic,
      payload: envelope.payload,
      type: envelope.type,
      meta: envelope.meta,
    });

    // Delegate to wrapped adapter
    return this.wrapped.publish(envelope, opts);
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
   * Get local subscribers (delegated).
   */
  getLocalSubscribers(topic: string): AsyncIterable<string> {
    return this.wrapped.getLocalSubscribers(topic);
  }

  /**
   * List topics (delegated).
   */
  async listTopics(): Promise<readonly string[]> {
    return this.wrapped.listTopics?.() ?? [];
  }

  /**
   * Check if topic exists (delegated).
   */
  async hasTopic(topic: string): Promise<boolean> {
    return this.wrapped.hasTopic?.(topic) ?? false;
  }

  /**
   * Register remote published handler (delegated).
   */
  onRemotePublished(
    handler: (envelope: PublishEnvelope) => void | Promise<void>,
  ): () => void {
    return this.wrapped.onRemotePublished?.(handler) ?? (() => {});
  }

  /**
   * Close (delegated).
   */
  async close(): Promise<void> {
    return this.wrapped.close?.();
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
