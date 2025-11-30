// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Memory adapter implementations for rate limiting and pub/sub.
 *
 * Exports:
 * - `memoryPubSub()` — in-memory pub/sub adapter (subscription registry, no distributed ingress)
 * - `memoryRateLimiter()` — in-memory rate limiter (token bucket algorithm)
 *
 * **Composition Utilities** (for adapter authors):
 * - See `@ws-kit/pubsub/internal` for `withBroker()` and `combineBrokers()`
 */

import type { PubSubAdapter } from "@ws-kit/core/pubsub";
import type {
  RateLimitDecision,
  RateLimiter,
  RateLimitPolicy,
} from "@ws-kit/rate-limit";

export { memoryRateLimiter } from "./limiter.js";
export type { Clock, MemoryRateLimiterOptions } from "./limiter.js";
export {
  memoryPubSub,
  type MemoryPubSubAdapter,
  type ReplaceResult,
} from "./pubsub.js";
export type { PubSubAdapter, RateLimitDecision, RateLimiter, RateLimitPolicy };
