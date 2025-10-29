/**
 * @ws-kit/serve/test - Test helpers
 *
 * Utilities for testing routers without runtime detection overhead.
 * Useful in Jest, Vitest, and other test environments where
 * auto-detection is unreliable or unnecessary.
 *
 * @example
 * ```typescript
 * import { createTestServer } from "@ws-kit/serve/test";
 * import { createRouter } from "@ws-kit/zod";
 *
 * it("handles messages", async () => {
 *   const router = createRouter();
 *   router.on(TestSchema, (ctx) => {
 *     ctx.send(ResponseSchema, { ... });
 *   });
 *
 *   const server = await createTestServer(router, {
 *     runtime: "bun",
 *     port: 3001,
 *   });
 *   // ... test your handlers ...
 * });
 * ```
 */

import type { Router } from "@ws-kit/core";
import type { ServeOptions } from "./types.js";

export type { ServeOptions } from "./types.js";

/**
 * Create a test server with explicit runtime specification.
 *
 * Use this in test environments where auto-detection is unreliable or unwanted:
 * - JSDOM or other test polyfills
 * - Multiple test workers running in parallel
 * - Unit tests of adapter behavior
 * - CI/CD environments with unusual globals
 *
 * Unlike the main `serve()`, this REQUIRES an explicit `runtime` option
 * to prevent accidental misconfiguration during testing.
 *
 * @param router - The WebSocket router to test
 * @param options - Configuration with REQUIRED explicit runtime
 * @returns Promise that resolves when server is running
 *
 * @example
 * ```typescript
 * import { createTestServer } from "@ws-kit/serve/test";
 * import { createRouter } from "@ws-kit/zod";
 *
 * it("handles JOIN_ROOM messages", async () => {
 *   const router = createRouter<{ roomId?: string }>();
 *   router.on(JoinRoom, (ctx) => {
 *     ctx.assignData({ roomId: ctx.payload.roomId });
 *   });
 *
 *   const server = await createTestServer(router, {
 *     runtime: "bun", // Required - no auto-detection
 *     port: 3001,
 *     authenticate: () => ({ userId: "test-user" })
 *   });
 *   // ... write your test assertions ...
 * });
 * ```
 *
 * @throws Error if runtime is not explicitly specified
 */
export function createTestServer<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> & { runtime: "bun" | "cloudflare-do" | "deno" },
): Promise<void> {
  // Import serve and call with explicit runtime (bypasses detection)
  return serve(router, options);
}

/**
 * Re-export main serve function for test utilities
 *
 * @internal
 */
async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData>,
): Promise<void> {
  const { serve: mainServe } = await import("./index.js");
  return mainServe(router, options);
}

// Re-export ServeOptions for test usage
export type { ServeOptions };
