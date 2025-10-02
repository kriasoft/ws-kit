// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Message queue management for offline buffering.
 * See @client.md#queue-behavior.
 */

export type QueuePolicy = "drop-oldest" | "drop-newest" | "off";

export class MessageQueue {
  private queue: string[] = [];
  private overflowCallbacks = new Set<
    (
      error: Error,
      context: {
        type: "overflow";
        details?: unknown;
      },
    ) => void
  >();

  constructor(
    private policy: QueuePolicy,
    private maxSize: number,
  ) {}

  setOverflowCallback(
    cb:
      | ((
          error: Error,
          context: {
            type: "overflow";
            details?: unknown;
          },
        ) => void)
      | null,
  ): void {
    if (cb) {
      this.overflowCallbacks.add(cb);
    }
  }

  removeOverflowCallback(
    cb: (
      error: Error,
      context: {
        type: "overflow";
        details?: unknown;
      },
    ) => void,
  ): void {
    this.overflowCallbacks.delete(cb);
  }

  /**
   * Enqueue a pre-serialized message.
   * Returns true if enqueued/sent, false if dropped.
   */
  enqueue(message: string): boolean {
    if (this.policy === "off") {
      return false; // Drop immediately
    }

    if (this.queue.length >= this.maxSize) {
      if (this.policy === "drop-newest") {
        console.warn(
          `[Client] Queue overflow (${this.maxSize}), dropping newest message`,
        );
        for (const cb of Array.from(this.overflowCallbacks)) {
          try {
            cb(new Error(`Queue overflow: dropping newest message`), {
              type: "overflow",
              details: { policy: "drop-newest", maxSize: this.maxSize },
            });
          } catch (error) {
            console.error("[Client] Overflow callback error:", error);
          }
        }
        return false; // Drop new message
      } else if (this.policy === "drop-oldest") {
        console.warn(
          `[Client] Queue overflow (${this.maxSize}), dropping oldest message`,
        );
        for (const cb of Array.from(this.overflowCallbacks)) {
          try {
            cb(new Error(`Queue overflow: dropping oldest message`), {
              type: "overflow",
              details: { policy: "drop-oldest", maxSize: this.maxSize },
            });
          } catch (error) {
            console.error("[Client] Overflow callback error:", error);
          }
        }
        this.queue.shift(); // Evict oldest
      }
    }

    this.queue.push(message);
    return true;
  }

  /**
   * Flush all queued messages to WebSocket.
   * Returns number of messages sent.
   */
  flush(ws: WebSocket): number {
    let sent = 0;
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message !== undefined) {
        ws.send(message);
        sent++;
      }
    }
    return sent;
  }

  /**
   * Clear queue without sending.
   */
  clear(): void {
    this.queue = [];
  }

  get size(): number {
    return this.queue.length;
  }
}
