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

export { memoryPubSub, type MemoryPubSubAdapter } from "./pubsub.js";
export { memoryRateLimiter } from "./limiter.js";
export type { Clock, MemoryRateLimiterOptions } from "./limiter.js";
export type { PubSubAdapter };
