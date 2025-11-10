/**
 * Limits manager: enforces maxPending and maxPayloadBytes constraints.
 * Fast path for in-flight message tracking.
 */

/**
 * Limits configuration.
 */
export interface LimitsConfig {
  maxPending?: number;
  maxPayloadBytes?: number;
}

/**
 * In-flight message tracker and enforcer.
 * Increments counter on message start; decrements on completion.
 * Throws if maxPending limit is exceeded.
 */
export class LimitsManager {
  private inFlight = 0;

  constructor(readonly config: LimitsConfig = {}) {}

  /**
   * Begin tracking a new in-flight message.
   * Throws if maxPending would be exceeded.
   * Returns a release function to call when message completes.
   */
  begin(): () => void {
    const maxPending = this.config.maxPending;
    if (maxPending !== undefined && this.inFlight >= maxPending) {
      throw new Error(
        `Too many pending messages (${this.inFlight}/${maxPending})`,
      );
    }

    this.inFlight++;

    return () => {
      this.inFlight--;
    };
  }

  /**
   * Get current in-flight message count.
   */
  currentInFlight(): number {
    return this.inFlight;
  }

  /**
   * Check if payload size exceeds limit.
   * Returns true if size is acceptable, false otherwise.
   */
  checkPayloadSize(size: number): boolean {
    const maxPayloadBytes = this.config.maxPayloadBytes;
    if (maxPayloadBytes !== undefined && size > maxPayloadBytes) {
      return false;
    }
    return true;
  }
}
