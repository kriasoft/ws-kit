// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ConnectionData, Middleware, MinimalContext } from "@ws-kit/core";
import type { RateLimiter } from "./types.js";
import { keyPerUserPerType } from "./keys.js";

/**
 * Rate limit middleware options.
 */
export interface RateLimitOptions<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Rate limiter adapter instance (memory, redis, or durable objects)
   */
  limiter: RateLimiter;

  /**
   * Key function to extract rate limit bucket key from context.
   *
   * @default keyPerUserPerType — tenant + user + type
   *
   * @example
   * // Custom key function
   * key: (ctx) => {
   *   const tenant = ctx.data?.tenantId ?? "public";
   *   const user = ctx.data?.userId ?? "anon";
   *   return `rl:${tenant}:${user}:${ctx.type}`;
   * }
   */
  key?: (ctx: MinimalContext<TContext>) => string;

  /**
   * Cost function to calculate token cost for this request.
   *
   * Must return a **non-negative integer**. Negative or non-integer values
   * are rejected with INVALID_ARGUMENT error at runtime.
   *
   * Return `0` to bypass rate limiting for specific messages (e.g., heartbeats).
   *
   * @default () => 1 — each message costs 1 token
   *
   * @example
   * // Expensive operations cost more; heartbeats are free
   * cost: (ctx) => {
   *   if (ctx.type === "HEARTBEAT") return 0;
   *   if (ctx.type === "SEARCH") return 10;
   *   return 1;
   * }
   */
  cost?: (ctx: MinimalContext<TContext>) => number;
}

/**
 * Rate limit middleware using adapter pattern.
 *
 * Applies token bucket rate limiting atomically via the provided adapter.
 * When rate limited, sends RESOURCE_EXHAUSTED error with retryAfterMs backoff hint.
 * When cost exceeds capacity, sends FAILED_PRECONDITION (non-retryable).
 *
 * **Note**: This middleware runs post-validation. For transport-level protection,
 * use platform-specific rate limiting (e.g., Cloudflare rate limiting rules).
 *
 * @param options - Rate limit options
 * @returns Middleware function
 *
 * @example
 * import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
 * import { memoryRateLimiter } from "@ws-kit/memory";
 *
 * const middleware = rateLimit({
 *   limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
 *   key: keyPerUserPerType,
 *   cost: (ctx) => 1,
 * });
 *
 * router.use(middleware);
 */
export function rateLimit<TContext extends ConnectionData = ConnectionData>(
  options: RateLimitOptions<TContext>,
): Middleware<TContext> {
  const { limiter, key = keyPerUserPerType, cost: costFn } = options;

  return async (ctx: MinimalContext<TContext>, next: () => Promise<void>) => {
    const cost = costFn?.(ctx) ?? 1;

    if (!Number.isInteger(cost) || cost < 0) {
      ctx.error(
        "INVALID_ARGUMENT",
        "Rate limit cost must be a non-negative integer",
      );
      return;
    }

    // Zero cost bypasses rate limiting (e.g., heartbeats, acks)
    if (cost === 0) {
      await next();
      return;
    }

    const rateLimitKey = key(ctx);

    // Atomically consume tokens
    const decision = await limiter.consume(rateLimitKey, cost);

    if (!decision.allowed) {
      const capacity = limiter.getPolicy().capacity;

      // Cost exceeds capacity: impossible under policy (non-retryable)
      if (decision.retryAfterMs === null) {
        ctx.error("FAILED_PRECONDITION", "Operation cost exceeds capacity", {
          cost,
          capacity,
        });
        return;
      }

      // Rate limited: retryable with backoff hint
      ctx.error(
        "RESOURCE_EXHAUSTED",
        "Rate limit exceeded",
        { cost, capacity, remaining: decision.remaining },
        { retryAfterMs: decision.retryAfterMs },
      );
      return;
    }

    // Rate limit passed, continue middleware chain
    await next();
  };
}
