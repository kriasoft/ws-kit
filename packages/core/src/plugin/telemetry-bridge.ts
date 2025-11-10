/**
 * Telemetry hook fan-out (internal).
 * withTelemetry plugin subscribes to router.onError() and internal events.
 * No separate onTelemetry() entry point; all wiring is internal.
 */

import type { Observer } from "../capabilities/telemetry/contracts";

export class TelemetryBridge {
  private observers: Observer[] = [];

  subscribe(observer: Observer): void {
    this.observers.push(observer);
  }

  async notifyMessage(meta: { type: string; size: number; ts: number }): Promise<void> {
    // Placeholder: call all observer.onMessage handlers
  }

  async notifyError(err: unknown, meta?: Record<string, unknown>): Promise<void> {
    // Placeholder: call all observer.onError handlers
  }

  async notifyPublish(meta: { topic: string; type: string }): Promise<void> {
    // Placeholder: call all observer.onPublish handlers
  }
}
