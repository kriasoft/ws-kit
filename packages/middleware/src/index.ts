// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/middleware — Middleware and policy enforcement for WS-Kit routers
 *
 * Provides composable middleware for:
 * - Authentication and authorization (useAuth)
 * - Request/response logging (useLogging)
 * - Metrics collection (useMetrics)
 * - OpenTelemetry integration (useTelemetry)
 * - Rate limiting (from @ws-kit/rate-limit, also re-exported here for convenience)
 *
 * All middleware can be composed via `.use(middleware)` and run in order.
 *
 * @example
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { rateLimit } from "@ws-kit/rate-limit";
 * import {
 *   useAuth,
 *   useLogging,
 *   useMetrics,
 * } from "@ws-kit/middleware";
 * import { memoryRateLimiter } from "@ws-kit/memory";
 *
 * const router = createRouter()
 *   .use(useAuth({ verify: async (token) => ... }))
 *   .use(useLogging({ level: "info" }))
 *   .use(useMetrics({ sampleRate: 0.1 }))
 *   .use(rateLimit({
 *     limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 }),
 *   }));
 * ```
 */

// === Rate Limiting (from @ws-kit/rate-limit) ===
// Re-export for backward compatibility and convenience

export { rateLimit } from "@ws-kit/rate-limit";
export type { RateLimitOptions } from "@ws-kit/rate-limit";

export {
  keyPerUserOrIpPerType,
  keyPerUserPerType,
  perUserKey,
  type RateLimitContext,
} from "@ws-kit/rate-limit";

export type {
  Policy,
  RateLimitDecision,
  RateLimiter,
} from "@ws-kit/rate-limit";

// === Authentication & Authorization ===

export { useAuth } from "./auth";
export type { UseAuthOptions } from "./auth";

// === Request/Response Logging ===

export { useLogging } from "./logging";
export type { UseLoggingOptions } from "./logging";

// === Metrics Collection ===

export { useMetrics } from "./metrics";
export type { UseMetricsOptions } from "./metrics";

// === OpenTelemetry Integration ===

export { useTelemetry } from "./telemetry";
export type { UseTelemetryOptions } from "./telemetry";
