/**
 * Mock platform adapter for testing.
 * Manages in-memory WebSocket connections and coordinates with the router.
 */

import type { PlatformAdapter, ServerWebSocket } from "../ws/platform-adapter";
import type { Middleware, EventHandler, RouteEntry } from "../core/types";
import type { MinimalContext, BaseContextData } from "../context/base-context";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import { MockWebSocket, type ConnectionState } from "./test-websocket";
import { dispatch } from "../engine/dispatch";
import type { OutboundFrame } from "./types";

/**
 * Mock platform adapter that manages in-memory WebSocket connections.
 * Used by the test harness to coordinate message routing.
 */
export class MockPlatformAdapter<TConn extends BaseContextData = unknown>
  implements PlatformAdapter
{
  private connections = new Map<string, ConnectionState<TConn>>();
  private nextClientId = 0;
  private globalMessages: OutboundFrame[] = [];

  /**
   * Get or create a connection.
   */
  getOrCreateConnection(init?: {
    data?: Partial<TConn>;
    headers?: Record<string, string>;
  }): MockWebSocket {
    const clientId = String(this.nextClientId++);
    const ws = new MockWebSocket(clientId);
    const data = init?.data || ({} as TConn);

    this.connections.set(clientId, {
      ws,
      data,
      subscriptions: new Set(),
    });

    return ws;
  }

  /**
   * Get a connection by ID.
   */
  getConnection(clientId: string): ConnectionState<TConn> | undefined {
    return this.connections.get(clientId);
  }

  /**
   * Get all active connections.
   */
  getAllConnections(): Map<string, ConnectionState<TConn>> {
    return new Map(this.connections);
  }

  // PlatformAdapter interface

  getServerWebSocket(clientId: string): ServerWebSocket | undefined {
    return this.connections.get(clientId)?.ws;
  }

  close(clientId: string, code?: number, reason?: string): void {
    const state = this.connections.get(clientId);
    if (state) {
      state.ws.close(code, reason);
    }
  }

  send(clientId: string, data: string | ArrayBuffer): void {
    const state = this.connections.get(clientId);
    if (state) {
      state.ws.send(data);
      // Record globally
      try {
        const text = typeof data === "string" ? data : this.decode(data);
        const frame = JSON.parse(text) as OutboundFrame;
        this.globalMessages.push(frame);
      } catch (err) {
        // Parsing errors are logged by MockWebSocket
      }
    }
  }

  // Test-specific helpers

  /**
   * Send a message to router from a client.
   * This simulates router.websocket.message() being called.
   */
  async receiveMessage(
    clientId: string,
    type: string,
    payload?: unknown,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const state = this.connections.get(clientId);
    if (!state) {
      throw new Error(`Connection not found: ${clientId}`);
    }

    // This will be called by the test harness after wiring up dispatch logic
    // For now, we just store the message for later processing
  }

  /**
   * Get all globally sent messages.
   */
  getAllSentMessages(): readonly OutboundFrame[] {
    return this.globalMessages;
  }

  /**
   * Clear all sent messages.
   */
  clearSentMessages(): void {
    this.globalMessages = [];
  }

  /**
   * Close all connections.
   */
  closeAll(): void {
    for (const [, state] of this.connections) {
      state.ws.close();
    }
    this.connections.clear();
  }

  // Private helpers

  private decode(buffer: ArrayBuffer): string {
    const view = new Uint8Array(buffer);
    const decoder = new TextDecoder();
    return decoder.decode(view);
  }
}
