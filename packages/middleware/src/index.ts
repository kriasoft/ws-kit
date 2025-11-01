// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

export { rateLimit } from "./rate-limit";
export type { RateLimitOptions } from "./rate-limit";

export { keyPerUserOrIpPerType, keyPerUserPerType, perUserKey } from "./keys";

// Re-export core types for convenience
export type {
  IngressContext,
  Policy,
  RateLimitDecision,
  RateLimiter,
} from "@ws-kit/core";
