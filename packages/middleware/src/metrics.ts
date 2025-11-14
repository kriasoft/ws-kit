// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/middleware — Metrics collection middleware (placeholder)
 *
 * **Status**: Placeholder for future metrics middleware.
 *
 * Will provide hooks for:
 * - Message throughput and latency metrics
 * - Error rate tracking
 * - Connection lifecycle metrics
 * - Custom metric collection and aggregation
 *
 * @example (planned)
 * ```typescript
 * import { useMetrics } from "@ws-kit/middleware";
 *
 * const router = createRouter()
 *   .use(useMetrics({
 *     onMetric: (metric) => console.log(metric),
 *     sampleRate: 0.1,
 *   }));
 * ```
 */

import type { ConnectionData, Middleware } from "@ws-kit/core";

/**
 * Metrics hooks (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export interface UseMetricsOptions<
  TData extends ConnectionData = ConnectionData,
> {
  /**
   * Hook called for each metric.
   */
  onMetric?: (metric: any) => void;

  /**
   * Sample rate (0.0 to 1.0) for which metrics to record.
   */
  sampleRate?: number;
}

/**
 * Metrics middleware (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export function useMetrics<TData extends ConnectionData = ConnectionData>(
  options?: UseMetricsOptions<TData>,
): Middleware<TData> {
  return async (ctx, next) => {
    // Placeholder: just continue to next middleware
    await next();
  };
}
