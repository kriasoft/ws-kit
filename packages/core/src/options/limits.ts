/**
 * Rate limiting: enforce maxPending and maxPayloadBytes.
 * Enabled via createRouter({ limits: { maxPending, maxPayloadBytes } }).
 *
 * Behavior:
 * - Reject incoming messages if queue is full (maxPending)
 * - Reject messages larger than maxPayloadBytes
 * - No new API surface (transparent behavior)
 */

export interface LimitsConfig {
  maxPending?: number;       // Default: unbounded
  maxPayloadBytes?: number;  // Default: unbounded
}

/**
 * Per-connection limit state.
 */
export interface LimitState {
  pending: number;
}

/**
 * Limits manager (internal).
 */
export class LimitsManager {
  constructor(private config: LimitsConfig) {}

  createState(): LimitState {
    return { pending: 0 };
  }

  checkIncoming(payload: unknown, state: LimitState): boolean {
    // Placeholder: check size + pending count
    return true;
  }

  recordPending(state: LimitState): void {
    state.pending++;
  }

  releasePending(state: LimitState): void {
    state.pending--;
  }
}
