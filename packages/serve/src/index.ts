/**
 * @ws-kit/serve - Multi-runtime serve() function
 *
 * Provides a single serve() function that works transparently across
 * Bun, Cloudflare Durable Objects, Deno, and other platforms.
 *
 * Usage:
 * ```typescript
 * import { serve } from "@ws-kit/serve";
 * import { createRouter } from "@ws-kit/zod";
 *
 * const router = createRouter();
 * // ... register handlers ...
 *
 * // Option 1: Explicit runtime (recommended for production)
 * serve(router, { runtime: "bun", port: 3000 });
 *
 * // Option 2: Platform entrypoint (zero detection)
 * import { serve } from "@ws-kit/serve/bun";
 * serve(router, { port: 3000 });
 *
 * // Option 3: Auto-detect in development (convenience)
 * serve(router, { port: 3000 });
 * ```
 */

import type { Router } from "@ws-kit/core";
import type { ServeOptions } from "./types.js";

export type { ServeOptions } from "./types.js";

/**
 * Serve a router with automatic or explicit runtime selection.
 *
 * @param router - The WebSocket router to serve
 * @param options - Configuration options
 * @returns Promise that resolves when server is running
 *
 * @throws Error if:
 * - In production without explicit runtime
 * - Runtime detection is ambiguous
 * - No runtime is detected in development
 */
export async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> = {},
): Promise<void> {
  const mode = process.env.NODE_ENV ?? "development";
  const envRuntime = process.env.WSKIT_RUNTIME as any;

  // Resolution order: explicit option → env var → auto (dev) or error (prod)
  let target = options.runtime ?? envRuntime;

  if (!target || target === "auto") {
    if (mode === "production") {
      throw new Error(
        "Auto-detection disabled in production. " +
          'Set options: serve(router, { runtime: "bun" | "cloudflare-do" | "deno" }) ' +
          "or WSKIT_RUNTIME environment variable. " +
          "Alternatively, use platform entrypoints: " +
          'import { serve } from "@ws-kit/serve/bun"',
      );
    }
    // Development: detect runtime
    target = detectRuntimeOrFail();
  }

  // Delegate to platform-specific implementation
  switch (target) {
    case "bun": {
      const { serve: bunServe } = await import("./bun.js");
      return bunServe(router, options);
    }
    case "cloudflare-do": {
      const { serve: cfServe } = await import("./cloudflare-do.js");
      return cfServe(router, options);
    }
    case "deno": {
      const { serve: denoServe } = await import("./deno.js");
      return denoServe(router, options);
    }
    default:
      throw new Error(`Unknown runtime: ${target}`);
  }
}

/**
 * Detect runtime via capability checks (not brand names).
 *
 * Throws if detection is ambiguous or no runtime found.
 *
 * Capability-based probing:
 * - Bun: typeof Bun?.serve === "function"
 * - Deno: typeof Deno?.version?.deno === "string"
 * - Cloudflare DO: typeof WebSocketPair === "function" && !process
 */
function detectRuntimeOrFail(): "bun" | "cloudflare-do" | "deno" {
  const matches: ("bun" | "cloudflare-do" | "deno")[] = [];

  // Capability-based probing (not brand names)
  if (typeof (globalThis as any).Bun?.serve === "function") {
    matches.push("bun");
  }
  if (typeof (globalThis as any).Deno?.version?.deno === "string") {
    matches.push("deno");
  }
  const isCF =
    typeof (globalThis as any).WebSocketPair === "function" &&
    !(globalThis as any).process;
  if (isCF) {
    matches.push("cloudflare-do");
  }

  if (matches.length === 1) return matches[0];

  if (matches.length === 0) {
    throw new Error(
      "No runtime detected. " +
        'Set runtime explicitly: serve(router, { runtime: "bun" | "cloudflare-do" | "deno" }) ' +
        "or use platform entrypoints: " +
        'import { serve } from "@ws-kit/serve/bun"',
    );
  }

  throw new Error(
    `Ambiguous environment: detected ${matches.join(" & ")}. ` +
      "Auto-detection cannot determine which runtime to use. " +
      'Set runtime explicitly: serve(router, { runtime: "bun" | "cloudflare-do" | "deno" })',
  );
}
