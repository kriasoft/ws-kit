// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type {
  BaseContextData,
  EventContext,
  Middleware,
  MinimalContext,
} from "@ws-kit/core";
import type { RateLimiter } from "@ws-kit/rate-limit";
import { keyPerUserOrIpPerType } from "./keys";

// Type aliases for clarity
type IngressContext<T extends BaseContextData = BaseContextData> =
  MinimalContext<T>;
type MessageContext<
  P = unknown,
  T extends BaseContextData = BaseContextData,
> = EventContext<T, P>;
type WebSocketData = BaseContextData;

/**
 * Options for rate limit middleware
 */
export interface RateLimitOptions<TData extends WebSocketData = WebSocketData> {
  /**
   * Rate limiter adapter instance (memory, redis, or durable objects)
   */
  limiter: RateLimiter;

  /**
   * Key function to extract rate limit bucket key from context.
   *
   * @default keyPerUserOrIpPerType — tenant + (user or IP) + type
   *
   * ⚠️ **Note on default**: `keyPerUserOrIpPerType` is designed to use IP for unauthenticated traffic,
   * but IP is not available at middleware layer. It falls back to a shared "anon" bucket.
   * For authenticated-first apps, this is fine. For significant unauthenticated traffic,
   * consider `keyPerUserPerType` or a custom key function.
   *
   * @example
   * // Fair per-user per-message-type isolation (works at middleware layer)
   * key: (ctx) => {
   *   const tenant = ctx.ws.data?.tenantId ?? "public";
   *   const user = ctx.ws.data?.userId ?? "anon";
   *   return `rl:${tenant}:${user}:${ctx.type}`;
   * }
   */
  key?: (ctx: IngressContext<TData>) => string;

  /**
   * Cost function to calculate token cost for this request.
   *
   * Must return a **positive integer**. Non-integers and zero/negative values
   * are rejected with INVALID_ARGUMENT error at runtime.
   *
   * @default () => 1 — each message costs 1 token
   *
   * @example
   * // Expensive compute operations cost more
   * cost: (ctx) => ctx.type === "Compute" ? 10 : 1
   *
   * @example
   * // Differentiate by user tier (with separate limiters per tier)
   * cost: (ctx) => {
   *   const tier = ctx.ws.data?.tier ?? "free";
   *   return { free: 2, basic: 1, pro: 1 }[tier];
   * }
   *
   * ❌ NOT ALLOWED: Non-integer or non-positive
   * cost: (ctx) => ctx.ws.data?.isPremium ? 0.5 : 1  // ERROR
   * cost: (ctx) => -1  // ERROR
   */
  cost?: (ctx: IngressContext<TData>) => number;
}

/**
 * Rate limit middleware using adapter pattern.
 *
 * Applies token bucket rate limiting atomically via the provided adapter.
 *
 * **⚠️ EXECUTION TIMING**: This middleware runs at step 6 of the ingress pipeline
 * (after schema validation and authentication). The proposal recommends step 3
 * (after frame parsing, before validation) for security and efficiency.
 *
 * **Today's benefits**: Per-user fairness, atomic token consumption, adapter portability
 * **Today's limitations**:
 * - Cannot access client IP (only available during adapter processing)
 * - Runs after schema validation (no protection against payload work)
 * - No IP-based rate limiting for unauthenticated traffic
 *
 * **Future improvement**: When rate limiting moves to the router at step 3,
 * it will have access to IP and can prevent wasteful validation of rate-limited requests.
 *
 * When rate limited, returns RESOURCE_EXHAUSTED (if retryable) or FAILED_PRECONDITION
 * (if cost > capacity) error. Error includes computed retryAfterMs backoff hint.
 *
 * @param options - Rate limit configuration
 * @returns Middleware function
 *
 * @example
 * import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
 * import { memoryRateLimiter } from "@ws-kit/memory";
 *
 * const limiter = rateLimit({
 *   limiter: memoryRateLimiter({ capacity: 200, tokensPerSecond: 100 }),
 *   key: keyPerUserPerType,
 *   cost: (ctx) => 1,
 * });
 *
 * router.use(limiter);
 */
export function rateLimit<TData extends WebSocketData = WebSocketData>(
  options: RateLimitOptions<TData>,
): Middleware<TData> {
  const { limiter, key = keyPerUserOrIpPerType, cost: costFn } = options;

  return async (
    ctx: MessageContext<unknown, TData>,
    next: () => void | Promise<void>,
  ) => {
    // Create ingress context for rate limiting
    //
    // EXECUTION TIMING: This middleware runs at step 6 of the ingress pipeline (post-validation).
    // The proposal specifies step 3 (pre-validation) for better security and efficiency.
    //
    // KEY LIMITATION: IP is not available here. It's populated by platform adapters during
    // socket setup (before request processing), not during message handling. Key functions
    // that rely on IP (like keyPerUserOrIpPerType) will always see ip="", so they fall back
    // to userId or "anon".
    //
    // CONSEQUENCE: Rate limiting can provide per-user fairness but not per-IP protection for
    // unauthenticated traffic. This is safe (all anonymous users share "anon" bucket) but
    // not the IP-based isolation described in the proposal.
    const ingressCtx: IngressContext<TData> = {
      type: ctx.type,
      id: ctx.meta.clientId,
      ip: "", // Not available: IP is set during socket setup, not message processing
      ws: { data: ctx.ws.data },
      meta: { receivedAt: ctx.receivedAt },
    };

    // Compute cost
    const cost = costFn?.(ingressCtx) ?? 1;

    // Validate cost is a positive integer
    if (!Number.isInteger(cost) || cost <= 0) {
      ctx.error(
        "INVALID_ARGUMENT",
        "Rate limit cost must be a positive integer",
      );
      return;
    }

    // Compute key
    const rateLimitKey = key(ingressCtx);

    // Atomically consume tokens
    const decision = await limiter.consume(rateLimitKey, cost);

    if (!decision.allowed) {
      // Rate limited: synthesize _limitExceeded error for router's limit handling pipeline
      const error = new Error(
        decision.retryAfterMs === null
          ? "Operation cost exceeds rate limit capacity"
          : "Rate limit exceeded",
      );

      // Attach limit metadata (same contract as payload size limits)
      // Get the real capacity from the adapter's policy (required on all adapters)
      const limit = limiter.getPolicy().capacity; // Always available; no fallback needed

      (error as unknown as Record<string, unknown>)._limitExceeded = {
        type: "rate" as const,
        observed: cost,
        limit, // Real capacity from adapter
        retryAfterMs: decision.retryAfterMs,
      };

      throw error;
    }

    // Rate limit passed, continue middleware chain
    await next();
  };
}

export type { IngressContext } from "@ws-kit/core";
export type {
  Policy,
  RateLimitDecision,
  RateLimiter,
} from "@ws-kit/rate-limit";
export { keyPerUserOrIpPerType, keyPerUserPerType, perUserKey } from "./keys";
