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
  maxPending?: number; // Default: unbounded
  maxPayloadBytes?: number; // Default: unbounded
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
    const { maxPending, maxPayloadBytes } = this.config;

    if (maxPending !== undefined && state.pending >= maxPending) {
      return false;
    }

    if (maxPayloadBytes !== undefined) {
      const size = estimatePayloadSize(payload);
      if (size > maxPayloadBytes) {
        return false;
      }
    }

    return true;
  }

  recordPending(state: LimitState): void {
    state.pending++;
  }

  releasePending(state: LimitState): void {
    state.pending--;
  }
}

function estimatePayloadSize(payload: unknown): number {
  if (typeof payload === "string") {
    return Buffer.byteLength(payload);
  }

  if (payload instanceof ArrayBuffer) {
    return payload.byteLength;
  }

  if (ArrayBuffer.isView(payload)) {
    return payload.byteLength;
  }

  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    // Fallback to zero if serialization fails; caller can decide how to handle
    return 0;
  }
}
