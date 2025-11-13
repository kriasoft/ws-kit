// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

// Re-export rate limiting middleware from @ws-kit/rate-limit for backward compatibility
export { rateLimit } from "@ws-kit/rate-limit";
export type { RateLimitOptions } from "@ws-kit/rate-limit";

export {
  keyPerUserOrIpPerType,
  keyPerUserPerType,
  perUserKey,
  type RateLimitContext,
} from "@ws-kit/rate-limit";

// Re-export rate limit types for convenience
export type {
  Policy,
  RateLimitDecision,
  RateLimiter,
} from "@ws-kit/rate-limit";
