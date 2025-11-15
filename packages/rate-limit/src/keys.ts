// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ConnectionData, MinimalContext } from "@ws-kit/core";

// Type aliases for clarity
type IngressContext<T extends ConnectionData = ConnectionData> =
  MinimalContext<T>;
type WebSocketData = ConnectionData;

/**
 * Common rate limiting context fields (suggested app data structure).
 *
 * Most apps will have some variant of these fields. Use this as a guide when
 * defining your app's WebSocket data type or writing custom key functions.
 */
export interface RateLimitContext extends Record<string, unknown> {
  tenantId?: string;
  organizationId?: string;
  userId?: string;
  accountId?: string;
}

/**
 * Key function for per-user-per-type rate limiting (fairness default).
 *
 * Creates a rate limit bucket for each (tenant, user, type) tuple.
 * This ensures one message type cannot starve others and prevents users from
 * abusing expensive operations at the cost of cheap ones.
 *
 * **When to use**: Most applications. Fairness is worth the cost of extra buckets.
 * A typical app with 5-30 message types and 10k users = ~150k buckets, acceptable.
 *
 * **Key format**: `rl:${tenant}:${user}:${type}`
 *
 * **Note**: This is an example key function assuming `tenantId` and `userId` fields.
 * If your app uses different field names (e.g., `organizationId`, `accountId`),
 * create your own key function:
 *
 * @example
 * // For apps that use organizationId instead of tenantId:
 * function customKey(ctx: IngressContext<AppData>): string {
 *   const org = ctx.data.organizationId ?? "public";
 *   const user = ctx.data.userId ?? "anon";
 *   return `rl:${org}:${user}:${ctx.type}`;
 * }
 *
 * router.use(rateLimit({ limiter, key: customKey }));
 */
export function keyPerUserPerType<
  TData extends WebSocketData & RateLimitContext = WebSocketData &
    RateLimitContext,
>(ctx: IngressContext<TData>): string {
  const tenant = ctx.data.tenantId ?? "public";
  const user = ctx.data.userId ?? "anon";
  return `rl:${tenant}:${user}:${ctx.type}`;
}

/**
 * Key function for per-user rate limiting (lighter footprint).
 *
 * Creates a rate limit bucket for each (tenant, user) tuple.
 * All message types share the same budget. Use cost() to weight operations.
 *
 * **When to use**: High-type-count apps (100+ distinct message types) or memory-constrained deployments.
 * Each user has a single bucket regardless of message type.
 *
 * **Trade-off**: One bursty operation type can starve others. Mitigate by using cost()
 * to weight expensive operations or running separate limiters with different policies.
 *
 * **Key format**: `rl:${tenant}:${user}`
 *
 * **Note**: This is an example key function assuming `tenantId` and `userId` fields.
 * Create your own key function if your app uses different field names.
 */
export function perUserKey<
  TData extends WebSocketData & RateLimitContext = WebSocketData &
    RateLimitContext,
>(ctx: IngressContext<TData>): string {
  const tenant = ctx.data.tenantId ?? "public";
  const user = ctx.data.userId ?? "anon";
  return `rl:${tenant}:${user}`;
}

/**
 * Key function for per-user-per-type with intended IP fallback (future router integration).
 *
 * **⚠️ CURRENT LIMITATION**: This middleware runs at step 6 (post-validation).
 * IP is not available, so this function **always falls back to "anon"** for unauthenticated users.
 * All anonymous traffic shares the same "anon" bucket, which is safe but defeats the IP-based isolation
 * that this function is designed to provide.
 *
 * **Why**: The proposal describes rate limiting at step 3 (pre-validation) where IP is available.
 * That requires router-level integration, not middleware. Until then, this function provides
 * per-user fairness but no IP-based protection for unauthenticated traffic.
 *
 * **What this actually does today**:
 * - Creates one rate limit bucket per (tenant, user, type) for authenticated users ✅
 * - Shares a single "anon" bucket for all unauthenticated users (not per-IP) ⚠️
 *
 * **When to use**: If you primarily authenticate users. For apps with significant unauthenticated traffic,
 * consider authentication or a custom key function that limits based on other identifiers (connection ID, session).
 *
 * **Key format**: `rl:${tenant}:${userId|anon}:${type}` (IP fallback not available at middleware layer)
 *
 * **Note**: This is an example key function assuming `tenantId` and `userId` fields.
 * Create your own key function if your app uses different field names.
 *
 * @future When rate limiting moves to the router at step 3, this function will receive ctx.ip and
 * can provide true IP-based fallback: `rl:${tenant}:${userId|ip|anon}:${type}`
 */
export function keyPerUserOrIpPerType<
  TData extends WebSocketData & RateLimitContext = WebSocketData &
    RateLimitContext,
>(ctx: IngressContext<TData>): string {
  const tenant = ctx.data.tenantId ?? "public";
  // NOTE: ctx.ip is always "" at middleware layer (post-validation)
  // This falls back to "anon", so all unauthenticated traffic shares one bucket
  const identifier = ctx.data.userId ?? ctx.ip ?? "anon";
  return `rl:${tenant}:${identifier}:${ctx.type}`;
}
