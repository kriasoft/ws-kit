// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/middleware — OpenTelemetry integration middleware (placeholder)
 *
 * **Status**: Placeholder for future telemetry middleware.
 *
 * Will provide hooks for:
 * - Distributed tracing (spans, trace context propagation)
 * - OpenTelemetry instrumentation
 * - Metrics export to monitoring systems
 * - Custom baggage and attributes
 *
 * @example (planned)
 * ```typescript
 * import { useTelemetry } from "@ws-kit/middleware";
 *
 * const router = createRouter()
 *   .use(useTelemetry({
 *     tracer: opentelemetry.trace.getTracer("ws-kit"),
 *     exportMetrics: true,
 *   }));
 * ```
 */

import type { ConnectionData, Middleware } from "@ws-kit/core";

/**
 * Telemetry and observability hooks (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export interface UseTelemetryOptions<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Custom tracer instance (e.g., from @opentelemetry/api).
   */
  tracer?: any;

  /**
   * Export metrics to external system.
   */
  exportMetrics?: boolean;

  /**
   * Custom span processor.
   */
  spanProcessor?: any;
}

/**
 * Telemetry middleware (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export function useTelemetry<TContext extends ConnectionData = ConnectionData>(
  options?: UseTelemetryOptions<TContext>,
): Middleware<TContext> {
  return async (ctx, next) => {
    // Placeholder: just continue to next middleware
    await next();
  };
}
