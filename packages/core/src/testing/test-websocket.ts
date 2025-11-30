// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Mock WebSocket implementation for testing.
 * Captures all messages sent and tracks connection state.
 */

import type { ConnectionData } from "../context/base-context";
import type { AdapterWebSocket } from "../ws/platform-adapter";
import type { OutgoingFrame } from "./types";

/**
 * In-memory AdapterWebSocket that records all sent messages.
 */
export class TestWebSocket implements AdapterWebSocket {
  readonly clientId: string;
  readyState: "CONNECTING" | "OPEN" | "CLOSING" | "CLOSED" = "OPEN";
  initialData?: Record<string, unknown>;
  private sentMessages: OutgoingFrame[] = [];
  private sentRaw: (string | ArrayBuffer)[] = [];

  constructor(clientId: string, initialData?: Record<string, unknown>) {
    this.clientId = clientId;
    if (initialData !== undefined) {
      this.initialData = initialData;
    }
  }

  /**
   * Send message (records to sentMessages).
   */
  send(data: string | ArrayBuffer): void {
    if (this.readyState !== "OPEN") {
      throw new Error(
        `Cannot send on closed connection (state: ${this.readyState})`,
      );
    }

    // Always capture raw payload for postmortem inspection
    this.sentRaw.push(data);

    try {
      const text = typeof data === "string" ? data : this.decode(data);
      const frame = JSON.parse(text) as OutgoingFrame;
      this.sentMessages.push(frame);
    } catch (err) {
      // If parsing fails, raw message is preserved above; swallow parse error
      console.error(`[TestWebSocket] Failed to parse sent message:`, err);
    }
  }

  /**
   * Close connection.
   */
  close(code?: number, reason?: string): void {
    void code;
    void reason;
    this.readyState = "CLOSED";
  }

  /**
   * Get all messages sent to this connection.
   */
  getSentMessages(): readonly OutgoingFrame[] {
    return this.sentMessages;
  }

  /**
   * Get all raw sent messages (for debugging malformed/binary frames).
   */
  getSentMessagesRaw(): readonly (string | ArrayBuffer)[] {
    return this.sentRaw;
  }

  /**
   * Clear sent messages (for testing).
   */
  clearSentMessages(): void {
    this.sentMessages = [];
    this.sentRaw = [];
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
export interface ConnectionState<
  TContext extends ConnectionData = ConnectionData,
> {
  ws: TestWebSocket;
  data: TContext;
  headers?: Record<string, string>;
  subscriptions: Set<string>;
}
