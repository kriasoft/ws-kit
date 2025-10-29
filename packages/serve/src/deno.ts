/**
 * @ws-kit/serve/deno - Deno platform entrypoint
 *
 * ⚠️ NOT IMPLEMENTED - Deno adapter is not yet available
 *
 * WS-Kit currently supports:
 * - Bun (@ws-kit/serve/bun)
 * - Cloudflare Durable Objects (@ws-kit/serve/cloudflare-do)
 *
 * Deno support is planned. Please file an issue at:
 * https://github.com/kriasoft/ws-kit/issues if you need Deno support.
 */

// Block users from accidentally importing this module
export const __NOT_IMPLEMENTED__: never = (() => {
  throw new Error(
    "Deno integration is not yet implemented.\n\n" +
      "WS-Kit currently supports:\n" +
      "  - Bun: import { serve } from '@ws-kit/serve/bun'\n" +
      "  - Cloudflare Durable Objects: import { createDurableObjectHandler } from '@ws-kit/cloudflare-do'\n\n" +
      "If you need Deno support, please file an issue:\n" +
      "https://github.com/kriasoft/ws-kit/issues",
  );
})();

import type { Router } from "@ws-kit/core";
import type { ServeOptions } from "./types.js";

export type { ServeOptions } from "./types.js";

/**
 * @deprecated Deno integration is not yet implemented
 * @throws Error - Always throws, use Bun or Cloudflare instead
 */
export async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> = {},
): Promise<void> {
  throw new Error(
    "Deno integration is not yet implemented.\n\n" +
      "WS-Kit currently supports:\n" +
      "  - Bun: import { serve } from '@ws-kit/serve/bun'\n" +
      "  - Cloudflare Durable Objects: import { createDurableObjectHandler } from '@ws-kit/cloudflare-do'\n\n" +
      "If you need Deno support, please file an issue:\n" +
      "https://github.com/kriasoft/ws-kit/issues",
  );
}
