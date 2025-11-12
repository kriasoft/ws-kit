/**
 * Telemetry hooks: observation points without behavior change.
 * Used by monitoring, logging, metrics collection.
 *
 * Hooks are optional; no telemetry is added unless withTelemetry() plugin.
 */

export interface TelemetryHooks {
  onMessage?(meta: { type: string; size: number; ts: number }): void;
  onError?(err: unknown, meta?: Record<string, unknown>): void;
  onPublish?(meta: { topic: string; type: string }): void;
}

/**
 * Observer: single subscribed telemetry consumer.
 */
export interface Observer {
  onMessage?(meta: { type: string; size: number; ts: number }): void;
  onError?(err: unknown, meta?: Record<string, unknown>): void;
  onPublish?(meta: { topic: string; type: string }): void;
}
