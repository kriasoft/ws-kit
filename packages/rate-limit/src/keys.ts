// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ConnectionData, MinimalContext } from "@ws-kit/core";

/**
 * Common identity fields for rate limit key construction.
 *
 * Most apps will have some variant of these fields. Use this as a guide when
 * defining your app's connection data type or writing custom key functions.
 */
export interface RateLimitIdentity extends Record<string, unknown> {
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
 * **Warning**: Falls back to `"anon"` when `userId` is missing — all unauthenticated
 * connections share one bucket, so one bad actor can exhaust quota for everyone.
 * For public endpoints, use a custom key with `ctx.clientId`, IP, or session token.
 *
 * **Note**: Example key function assuming `tenantId` and `userId` fields.
 * Create your own if your app uses different field names:
 *
 * @example
 * // For apps that use organizationId instead of tenantId:
 * function customKey(ctx: MinimalContext<AppData>): string {
 *   const org = ctx.data.organizationId ?? "public";
 *   const user = ctx.data.userId ?? "anon";
 *   return `rl:${org}:${user}:${ctx.type}`;
 * }
 *
 * router.use(rateLimit({ limiter, key: customKey }));
 */
export function keyPerUserPerType<
  TContext extends ConnectionData & RateLimitIdentity = ConnectionData &
    RateLimitIdentity,
>(ctx: MinimalContext<TContext>): string {
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
 * **Warning**: Falls back to `"anon"` when `userId` is missing — all unauthenticated
 * connections share one bucket, so one bad actor can exhaust quota for everyone.
 * For public endpoints, use a custom key with `ctx.clientId`, IP, or session token.
 *
 * **Note**: Example key function assuming `tenantId` and `userId` fields.
 * Create your own if your app uses different field names.
 */
export function keyPerUser<
  TContext extends ConnectionData & RateLimitIdentity = ConnectionData &
    RateLimitIdentity,
>(ctx: MinimalContext<TContext>): string {
  const tenant = ctx.data.tenantId ?? "public";
  const user = ctx.data.userId ?? "anon";
  return `rl:${tenant}:${user}`;
}
