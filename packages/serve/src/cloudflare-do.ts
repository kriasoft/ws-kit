/**
 * @ws-kit/serve/cloudflare-do - Cloudflare Durable Objects entrypoint
 *
 * Zero-runtime-detection serve function for Cloudflare Durable Objects.
 *
 * @example
 * ```typescript
 * import { serve } from "@ws-kit/serve/cloudflare-do";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 * // ... register handlers ...
 *
 * export default {
 *   fetch(req) {
 *     return serve(router, { authenticate: ... });
 *   },
 * };
 * ```
 */

import type { Router } from "@ws-kit/core";
import type { ServeOptions } from "./types.js";

export type { ServeOptions } from "./types.js";

/**
 * ⚠️ LIMITATION: serve() for Cloudflare Durable Objects is NOT RECOMMENDED
 *
 * Cloudflare Durable Objects has a different execution model than Bun.
 * DO objects are instantiated per request, not as persistent servers.
 * The serve() function cannot directly start a server.
 *
 * **RECOMMENDED**: Use the direct handler instead:
 *
 * ```typescript
 * import { createDurableObjectHandler } from "@ws-kit/cloudflare-do";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 * // ... register handlers ...
 *
 * const handler = createDurableObjectHandler(router, {
 *   authenticate: (req) => ({ userId: "..." })
 * });
 *
 * export default {
 *   fetch(req: Request) {
 *     return handler.fetch(req);
 *   },
 * };
 * ```
 *
 * @param router - The WebSocket router to serve
 * @param options - Cloudflare-specific options (ignored; use createDurableObjectHandler directly)
 * @returns Promise that never resolves
 *
 * @throws Error if called (since it cannot actually serve)
 *
 * @deprecated Use `createDurableObjectHandler()` directly instead
 */
export async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> = {},
): Promise<void> {
  throw new Error(
    "serve() for Cloudflare Durable Objects is not supported.\n\n" +
      "Instead, use createDurableObjectHandler() directly:\n\n" +
      "import { createDurableObjectHandler } from '@ws-kit/cloudflare-do';\n\n" +
      "const handler = createDurableObjectHandler(router, {\n" +
      "  authenticate(req) { /* ... */ }\n" +
      "});\n\n" +
      "export default {\n" +
      "  fetch(req: Request) {\n" +
      "    return handler.fetch(req);\n" +
      "  },\n" +
      "};",
  );
}
