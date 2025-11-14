// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/middleware — Request/response logging middleware (placeholder)
 *
 * **Status**: Placeholder for future logging middleware.
 *
 * Will provide hooks for:
 * - Structured message logging
 * - Performance metrics and timing
 * - Error and exception logging
 * - Custom log levels and filtering
 *
 * @example (planned)
 * ```typescript
 * import { useLogging } from "@ws-kit/middleware";
 *
 * const router = createRouter()
 *   .use(useLogging({
 *     level: "debug",
 *     format: "json",
 *     onMessage: (entry) => { ... },
 *   }));
 * ```
 */

import type { ConnectionData, Middleware } from "@ws-kit/core";

/**
 * Logging hooks (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export interface UseLoggingOptions<
  TData extends ConnectionData = ConnectionData,
> {
  /**
   * Log level (debug, info, warn, error).
   */
  level?: "debug" | "info" | "warn" | "error";

  /**
   * Log format (text, json).
   */
  format?: "text" | "json";

  /**
   * Hook called for each log entry.
   */
  onMessage?: (entry: any) => void;
}

/**
 * Logging middleware (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export function useLogging<TData extends ConnectionData = ConnectionData>(
  options?: UseLoggingOptions<TData>,
): Middleware<TData> {
  return async (ctx, next) => {
    // Placeholder: just continue to next middleware
    await next();
  };
}
