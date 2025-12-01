/**
 * Telemetry hook fan-out (internal).
 * withTelemetry plugin subscribes to router.onError() and internal events.
 * No separate onTelemetry() entry point; all wiring is internal.
 */

import type { Observer } from "../capabilities/telemetry/contracts.js";

export class TelemetryBridge {
  private observers: Observer[] = [];

  subscribe(observer: Observer): void {
    this.observers.push(observer);
  }

  async notifyMessage(meta: {
    type: string;
    size: number;
    ts: number;
  }): Promise<void> {
    for (const observer of this.observers) {
      try {
        observer.onMessage?.(meta);
      } catch (err) {
        // Telemetry should never break the caller path
        console.error("[ws-kit] telemetry onMessage failed", err);
      }
    }
  }

  async notifyError(
    err: unknown,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    for (const observer of this.observers) {
      try {
        observer.onError?.(err, meta);
      } catch (handlerErr) {
        console.error("[ws-kit] telemetry onError failed", handlerErr);
      }
    }
  }

  async notifyPublish(meta: { topic: string; type: string }): Promise<void> {
    for (const observer of this.observers) {
      try {
        observer.onPublish?.(meta);
      } catch (err) {
        console.error("[ws-kit] telemetry onPublish failed", err);
      }
    }
  }
}
