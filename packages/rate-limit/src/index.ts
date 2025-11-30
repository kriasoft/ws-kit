// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/rate-limit — Rate limiting middleware for WS-Kit
 *
 * Provides token bucket rate limiting via middleware enforcement.
 * Works with any adapter (memory, redis, durable objects) implementing RateLimiter.
 *
 * @example
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
 * import { memoryRateLimiter } from "@ws-kit/memory";
 *
 * const router = createRouter()
 *   .use(rateLimit({
 *     limiter: memoryRateLimiter({ capacity: 100, tokensPerSecond: 50 }),
 *     key: keyPerUserPerType,
 *   }));
 * ```
 */

// Middleware
export { rateLimit } from "./middleware";
export type { RateLimitOptions } from "./middleware";

// Types
export type { Policy, RateLimitDecision, RateLimiter } from "./types";

// Key functions
export {
  type IngressContext,
  keyPerUserOrIpPerType,
  keyPerUserPerType,
  perUserKey,
  type RateLimitContext,
} from "./keys";
