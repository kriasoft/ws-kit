// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * @ws-kit/middleware — Authentication and authorization middleware (placeholder)
 *
 * **Status**: Placeholder for future authentication middleware.
 *
 * Will provide hooks for:
 * - Per-message authentication verification
 * - Role-based and attribute-based access control (RBAC/ABAC)
 * - Token validation and refresh
 *
 * @example (planned)
 * ```typescript
 * import { useAuth } from "@ws-kit/middleware";
 *
 * const router = createRouter()
 *   .use(useAuth({
 *     verify: async (token) => { ... },
 *     onUnauthorized: (ctx) => { ... },
 *   }));
 * ```
 */

import type { ConnectionData, Middleware } from "@ws-kit/core";

/**
 * Authentication and authorization hooks (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export interface UseAuthOptions<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Verify token and return user data or undefined if invalid.
   */
  verify?: (token: string, ctx: any) => Promise<Partial<TContext> | undefined>;

  /**
   * Hook called when authentication fails.
   */
  onUnauthorized?: (ctx: any) => void | Promise<void>;
}

/**
 * Authentication middleware (placeholder).
 *
 * @internal This is a placeholder. Full implementation coming soon.
 */
export function useAuth<TContext extends ConnectionData = ConnectionData>(
  options?: UseAuthOptions<TContext>,
): Middleware<TContext> {
  return async (ctx, next) => {
    // Placeholder: just continue to next middleware
    await next();
  };
}
