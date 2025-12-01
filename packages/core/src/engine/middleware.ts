// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Middleware pipeline runner.
 *
 * Order: global (in registration order) → per-route (in registration order) → handler
 * next() is async; exceptions bubble to onError.
 */

import type {
  ConnectionData,
  MinimalContext,
} from "../context/base-context.js";
import type { Middleware } from "../core/types.js";

/**
 * Compose multiple middleware into a single pipeline.
 *
 * Creates a function that chains middleware in order, with each middleware
 * receiving a `next()` function to continue to the next middleware.
 *
 * @param middlewares Array of middleware to chain
 * @returns A function that executes the pipeline
 *
 * Example:
 * ```ts
 * const pipeline = composePipeline([
 *   async (ctx, next) => {
 *     console.log("before 1");
 *     await next();
 *     console.log("after 1");
 *   },
 *   async (ctx, next) => {
 *     console.log("before 2");
 *     await next();
 *     console.log("after 2");
 *   },
 * ]);
 *
 * // Logs: "before 1", "before 2", "after 2", "after 1"
 * await pipeline(async () => console.log("handler"));
 * ```
 */
export function composePipeline<
  TContext extends ConnectionData = ConnectionData,
>(
  middlewares: Middleware<TContext>[],
): (ctx: MinimalContext<TContext>, next: () => Promise<void>) => Promise<void> {
  return async (ctx: MinimalContext<TContext>, next: () => Promise<void>) => {
    let index = -1;

    async function dispatch(i: number): Promise<void> {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      const mw = middlewares[i];
      if (!mw) {
        // All middleware done, call handler
        return next();
      }

      // Call current middleware with dispatch for next one
      await mw(ctx, () => dispatch(i + 1));
    }

    await dispatch(0);
  };
}
