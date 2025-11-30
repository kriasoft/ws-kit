/**
 * Heartbeat loop: ping-pong to detect stale connections.
 * Enabled via createRouter({ heartbeat: { intervalMs, timeoutMs } }).
 *
 * Behavior:
 * - Send ping every intervalMs
 * - Expect pong within timeoutMs
 * - Close connection if timeout
 * - No new API surface (transparent behavior)
 */

import type { ServerWebSocket } from "../ws/platform-adapter";

export interface HeartbeatConfig {
  intervalMs?: number; // Default: 30_000
  timeoutMs?: number; // Default: 5_000
}

/**
 * Per-connection heartbeat state.
 */
export interface HeartbeatState {
  lastPingAt: number;
  lastPongAt: number;
  isPending: boolean;
}

/**
 * Heartbeat manager (internal).
 */
export class HeartbeatManager {
  constructor(private config: HeartbeatConfig) {}

  createState(): HeartbeatState {
    // Placeholder
    return { lastPingAt: 0, lastPongAt: 0, isPending: false };
  }

  async tick(
    clientId: string,
    ws: ServerWebSocket,
    state: HeartbeatState,
  ): Promise<void> {
    // Placeholder: send ping, check for timeout
    void clientId;
    void ws;
    void state;
  }

  handlePong(state: HeartbeatState): void {
    // Placeholder
    void state;
  }
}
