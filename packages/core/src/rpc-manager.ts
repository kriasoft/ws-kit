// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Internal RPC state for a single request.
 */
interface RpcRequestState {
  cancelled: boolean;
  terminalSent: boolean;
  onCancelCallbacks: Array<() => void>;
  createdAt: number;
  lastActivityAt: number;
}

/**
 * Internal RPC state manager.
 *
 * Encapsulates RPC lifecycle management (request tracking, cancellation,
 * idle cleanup, inflight rate limiting). Keeps router focused on message
 * routing and validation.
 *
 * @internal
 */
export class RpcManager {
  // Per-socket RPC state: Map<clientId -> Map<correlationId -> RpcRequestState>>
  private readonly statesByClient = new Map<
    string,
    Map<string, RpcRequestState>
  >();

  // Inflight RPC counter per socket (for rate limiting)
  private readonly inflightByClient = new Map<string, number>();

  // Idle cleanup interval handle
  private idleCleanupHandle?: ReturnType<typeof setInterval>;

  // Configuration
  private readonly maxInflightPerSocket: number;
  private readonly idleTimeoutMs: number;

  constructor(
    options: {
      maxInflightRpcsPerSocket?: number;
      rpcIdleTimeoutMs?: number;
    } = {},
  ) {
    this.maxInflightPerSocket = options.maxInflightRpcsPerSocket ?? 1000;
    this.idleTimeoutMs = options.rpcIdleTimeoutMs ?? 40_000;
  }

  /**
   * Called when an RPC request starts (before dispatch to handler).
   * Reserves an inflight slot and tracks the request.
   *
   * @returns true if inflight limit allows, false if limit exceeded
   */
  onRequest(clientId: string, correlationId: string): boolean {
    // Check inflight limit
    const current = this.inflightByClient.get(clientId) ?? 0;
    if (current >= this.maxInflightPerSocket) {
      return false; // Limit exceeded
    }

    // Increment inflight counter
    this.inflightByClient.set(clientId, current + 1);

    // Get or create state
    this.getOrCreateState(clientId, correlationId);

    return true;
  }

  /**
   * Called when progress is sent to update activity timestamp.
   * This prevents idle cleanup from removing active RPCs.
   */
  onProgress(clientId: string, correlationId: string): void {
    const state = this.getOrCreateState(clientId, correlationId);
    state.lastActivityAt = Date.now();
  }

  /**
   * Called when a terminal message (reply or error) is sent.
   * Marks request as terminated (one-shot guard) and schedules cleanup.
   *
   * @returns true if terminal was accepted, false if already terminal
   */
  onTerminal(clientId: string, correlationId: string): boolean {
    const state = this.getOrCreateState(clientId, correlationId);

    if (state.terminalSent) {
      console.warn(
        `[ws] Multiple terminal sends for RPC ${correlationId} (suppressed)`,
      );
      return false; // Already terminal, suppress
    }

    state.terminalSent = true;

    // Prune immediately to free memory
    this.prune(clientId, correlationId);

    return true;
  }

  /**
   * Called when an abort message is received from the client.
   * Cancels all registered callbacks without sending a response.
   */
  onAbort(clientId: string, correlationId: string): void {
    const state = this.getOrCreateState(clientId, correlationId);

    if (state.cancelled) {
      return; // Already cancelled
    }

    state.cancelled = true;

    // Fire all cancel callbacks
    for (const callback of state.onCancelCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error("[ws] Error in onCancel callback:", error);
      }
    }
  }

  /**
   * Called when a socket disconnects.
   * Cancels all in-flight RPCs and clears socket state.
   */
  onDisconnect(clientId: string): void {
    const stateMap = this.statesByClient.get(clientId);
    if (!stateMap) {
      return;
    }

    // Fire cancel callbacks for all in-flight RPCs
    for (const [correlationId, state] of stateMap) {
      if (!state.cancelled) {
        console.debug(
          `[ws] Cancelling in-flight RPC ${correlationId} due to disconnect`,
        );
        state.cancelled = true;
        for (const callback of state.onCancelCallbacks) {
          try {
            callback();
          } catch (error) {
            console.error(
              "[ws] Error in onCancel callback during disconnect:",
              error,
            );
          }
        }
      }
    }

    // Clear all state for this socket
    this.statesByClient.delete(clientId);
    this.inflightByClient.delete(clientId);
  }

  /**
   * Check if an RPC has been terminated (reply or error already sent).
   */
  isTerminal(clientId: string, correlationId: string): boolean {
    const stateMap = this.statesByClient.get(clientId);
    if (!stateMap) {
      return false;
    }
    const state = stateMap.get(correlationId);
    return state?.terminalSent ?? false;
  }

  /**
   * Register a callback to be called when RPC is cancelled.
   *
   * @returns Unregister function to remove the callback
   */
  onCancel(
    clientId: string,
    correlationId: string,
    callback: () => void,
  ): () => void {
    const state = this.getOrCreateState(clientId, correlationId);
    state.onCancelCallbacks.push(callback);

    // Return unregister function
    return () => {
      const idx = state.onCancelCallbacks.indexOf(callback);
      if (idx !== -1) {
        state.onCancelCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Start the idle cleanup timer.
   * Removes RPC states that have not had activity for idleTimeoutMs.
   */
  start(): void {
    if (this.idleCleanupHandle) {
      clearInterval(this.idleCleanupHandle);
    }

    // Run cleanup every 5 seconds
    this.idleCleanupHandle = setInterval(() => {
      this.cleanupIdle();
    }, 5000);
  }

  /**
   * Stop the idle cleanup timer (e.g., when router shuts down).
   */
  stop(): void {
    if (this.idleCleanupHandle) {
      clearInterval(this.idleCleanupHandle);
      this.idleCleanupHandle = undefined;
    }
  }

  /**
   * Clean up RPCs that have been idle for idleTimeoutMs.
   * @internal
   */
  private cleanupIdle(): void {
    const now = Date.now();
    for (const [clientId, stateMap] of this.statesByClient) {
      for (const [correlationId, state] of stateMap) {
        if (now - state.lastActivityAt > this.idleTimeoutMs) {
          console.warn(
            `[ws] Cleaning up idle RPC ${correlationId} (no activity for ${this.idleTimeoutMs}ms)`,
          );

          // Fire cancel callbacks if not already cancelled
          if (!state.cancelled) {
            state.cancelled = true;
            for (const callback of state.onCancelCallbacks) {
              try {
                callback();
              } catch (error) {
                console.error(
                  "[ws] Error in onCancel callback during idle cleanup:",
                  error,
                );
              }
            }
          }

          // Then prune the state
          this.prune(clientId, correlationId);
        }
      }
    }
  }

  /**
   * Get or create RPC state for a correlation ID.
   * @internal
   */
  private getOrCreateState(
    clientId: string,
    correlationId: string,
  ): RpcRequestState {
    let stateMap = this.statesByClient.get(clientId);
    if (!stateMap) {
      stateMap = new Map();
      this.statesByClient.set(clientId, stateMap);
    }

    if (!stateMap.has(correlationId)) {
      stateMap.set(correlationId, {
        cancelled: false,
        terminalSent: false,
        onCancelCallbacks: [],
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    }

    const state = stateMap.get(correlationId)!;
    state.lastActivityAt = Date.now(); // Update activity on access
    return state;
  }

  /**
   * Remove RPC state (cleanup after terminal or timeout).
   * @internal
   */
  private prune(clientId: string, correlationId: string): void {
    const stateMap = this.statesByClient.get(clientId);
    if (!stateMap) {
      return;
    }

    const wasDeleted = stateMap.delete(correlationId);
    if (wasDeleted) {
      // Decrement inflight counter
      const current = this.inflightByClient.get(clientId) ?? 0;
      if (current > 0) {
        this.inflightByClient.set(clientId, current - 1);
      }
      console.debug(`[ws] Pruned RPC state for ${correlationId}`);
    }

    // Clean up empty state maps
    if (stateMap.size === 0) {
      this.statesByClient.delete(clientId);
    }
  }
}
