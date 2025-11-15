// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Mock platform adapter for testing.
 * Manages in-memory WebSocket connections and coordinates with the router.
 */

import type { ConnectionData } from "../context/base-context";
import type { RouterImpl } from "../internal";
import type {
  AdapterWebSocket,
  PlatformAdapter,
  ServerWebSocket,
} from "../ws/platform-adapter";
import { TestWebSocket, type ConnectionState } from "./test-websocket";
import type { OutgoingFrame } from "./types";

/**
 * In-memory platform adapter that manages in-memory WebSocket connections.
 * Used by the test harness to coordinate message routing.
 *
 * Integrates with router's websocket bridge to exercise the same code paths
 * as production adapters (Bun, Cloudflare, etc.).
 */
export class InMemoryPlatformAdapter<
  TContext extends ConnectionData = ConnectionData,
> implements PlatformAdapter
{
  private connections = new Map<string, ConnectionState<TContext>>();
  private nextClientId = 0;
  private globalMessages: OutgoingFrame[] = [];
  private router: RouterImpl<TContext>;

  constructor(router: RouterImpl<TContext>) {
    this.router = router;
  }

  /**
   * Get or create a connection.
   */
  getOrCreateConnection(init?: {
    data?: Partial<TContext>;
    headers?: Record<string, string>;
  }): TestWebSocket {
    const clientId = String(this.nextClientId++);
    const ws = new TestWebSocket(clientId, init?.data);
    const data = (init?.data || {}) as TContext;

    const connectionState: ConnectionState<TContext> = {
      ws,
      data,
      subscriptions: new Set(),
    };
    if (init?.headers !== undefined) {
      connectionState.headers = init.headers;
    }

    this.connections.set(clientId, connectionState);

    return ws;
  }

  /**
   * Get a connection by ID.
   */
  getConnection(clientId: string): ConnectionState<TContext> | undefined {
    return this.connections.get(clientId);
  }

  /**
   * Get all active connections.
   */
  getAllConnections(): Map<string, ConnectionState<TContext>> {
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
        const frame = JSON.parse(text) as OutgoingFrame;
        this.globalMessages.push(frame);
      } catch (err) {
        // Parsing errors are logged by TestWebSocket
      }
    }
  }

  getConnectionInfo(clientId: string): Record<string, unknown> {
    const st = this.connections.get(clientId);
    if (!st) return {};
    return st.headers ? { headers: { ...st.headers } } : {};
  }

  // Test-specific helpers

  /**
   * Send a message to router from a client.
   * Routes through router.websocket.message() to exercise the same bridge
   * as production adapters (Bun, Cloudflare, etc.).
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

    // Build the message frame and route through the websocket bridge.
    // This ensures tests exercise the same entry point as real adapters.
    const frame = JSON.stringify({ type, payload, meta });
    await this.router.websocket.message(state.ws, frame);
  }

  /**
   * Get all globally sent messages.
   */
  getAllSentMessages(): readonly OutgoingFrame[] {
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
