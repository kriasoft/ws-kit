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
// Re-export for convenience

export { rateLimit } from "@ws-kit/rate-limit";
export type { RateLimitOptions } from "@ws-kit/rate-limit";

export {
  keyPerUser,
  keyPerUserPerType,
  type RateLimitIdentity,
} from "@ws-kit/rate-limit";

export type {
  RateLimitDecision,
  RateLimiter,
  RateLimitPolicy,
} from "@ws-kit/rate-limit";

// === Authentication & Authorization ===

export { useAuth } from "./auth.js";
export type { UseAuthOptions } from "./auth.js";

// === Request/Response Logging ===

export { useLogging } from "./logging.js";
export type { UseLoggingOptions } from "./logging.js";

// === Metrics Collection ===

export { useMetrics } from "./metrics.js";
export type { UseMetricsOptions } from "./metrics.js";

// === OpenTelemetry Integration ===

export { useTelemetry } from "./telemetry.js";
export type { UseTelemetryOptions } from "./telemetry.js";
