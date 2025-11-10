/**
 * Mock WebSocket implementation for testing.
 * Captures all messages sent and tracks connection state.
 */

import type { ServerWebSocket } from "../ws/platform-adapter";
import type { OutboundFrame } from "./types";

/**
 * In-memory ServerWebSocket that records all sent messages.
 */
export class MockWebSocket implements ServerWebSocket {
  readonly clientId: string;
  readyState: "CONNECTING" | "OPEN" | "CLOSING" | "CLOSED" = "OPEN";
  private sentMessages: OutboundFrame[] = [];

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  /**
   * Send message (records to sentMessages).
   */
  send(data: string | ArrayBuffer): void {
    if (this.readyState !== "OPEN") {
      throw new Error(`Cannot send on closed connection (state: ${this.readyState})`);
    }

    try {
      const text = typeof data === "string" ? data : this.decode(data);
      const frame = JSON.parse(text) as OutboundFrame;
      this.sentMessages.push(frame);
    } catch (err) {
      // If parsing fails, store raw message for debugging
      console.error(`[MockWebSocket] Failed to parse sent message:`, err);
    }
  }

  /**
   * Close connection.
   */
  close(code?: number, reason?: string): void {
    this.readyState = "CLOSED";
  }

  /**
   * Get all messages sent to this connection.
   */
  getSentMessages(): readonly OutboundFrame[] {
    return this.sentMessages;
  }

  /**
   * Clear sent messages (for testing).
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  // Private helpers

  private decode(buffer: ArrayBuffer): string {
    const view = new Uint8Array(buffer);
    const decoder = new TextDecoder();
    return decoder.decode(view);
  }
}

/**
 * Connection state for test adapter.
 */
export interface ConnectionState<TConn = unknown> {
  ws: MockWebSocket;
  data: TConn;
  subscriptions: Set<string>;
}
