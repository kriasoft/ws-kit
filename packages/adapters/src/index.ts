// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

// Re-export adapters from subpackages
export { memoryRateLimiter } from "./memory/index.js";
export type { Clock, MemoryRateLimiterOptions } from "./memory/index.js";

export { redisRateLimiter } from "./redis/index.js";
export type { RedisClient, RedisRateLimiterOptions } from "./redis/index.js";

export {
  durableObjectRateLimiter,
  RateLimiterDO,
} from "./cloudflare-do/index.js";
export type {
  DurableObjectNamespace,
  DurableObjectId,
  DurableObjectStub,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectRateLimiterOptions,
} from "./cloudflare-do/index.js";
