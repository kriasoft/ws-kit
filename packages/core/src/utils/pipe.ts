/**
 * Middleware composition: compose global + per-route middleware into single chain.
 * Order: global (in reg order) → per-route (in reg order) → handler.
 */

import type { Middleware } from "../core/types";

export function pipeMiddleware<TConn>(
  middlewares: Middleware<TConn>[],
): (next: () => Promise<void>) => Promise<void> {
  let index = 0;

  return async function executeNext() {
    if (index >= middlewares.length) return;
    const middleware = middlewares[index++];
    return middleware({} as any, executeNext);
  };
}
