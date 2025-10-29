/**
 * @ws-kit/serve - Multi-runtime serve options
 *
 * Options that work across all runtimes (Bun, Cloudflare, Deno, etc.)
 */

/**
 * Options for the multi-runtime serve() function.
 *
 * These options work across all runtimes (Bun, Cloudflare, Deno, etc.).
 *
 * @template TData - Connection data type from router
 */
export interface ServeOptions<TData = any> {
  /**
   * Port to listen on.
   *
   * Used in Bun and Deno. Ignored in Cloudflare Durable Objects.
   *
   * @default 3000
   */
  port?: number;

  /**
   * Explicit runtime selection.
   *
   * **Recommended for production:** Pass explicit runtime value.
   * **Optional in development:** Omit or use "auto" for convenience (auto-detect).
   *
   * In production (NODE_ENV === "production"):
   * - Omitting or passing "auto" throws error (auto-detection disabled)
   * - Must explicitly pass "bun" | "cloudflare-do" | "deno"
   *
   * In development:
   * - Omitting or passing "auto" uses runtime detection
   * - Capability-based probing: Bun.serve, Deno.version, WebSocketPair
   * - Throws if detection is ambiguous or no runtime found
   *
   * @example
   * ```typescript
   * // Production: explicit (recommended)
   * serve(router, { runtime: "bun", port: 3000 });
   *
   * // Or use platform entrypoint (zero detection)
   * import { serve } from "@ws-kit/serve/bun";
   * serve(router, { port: 3000 });
   *
   * // Development: auto-detect convenience
   * serve(router, { port: 3000 });
   *
   * // Or environment variable
   * // Code: serve(router, { port: 3000 });
   * // Run: WSKIT_RUNTIME=bun node app.js
   * ```
   */
  runtime?: "bun" | "cloudflare-do" | "deno" | "auto";

  /**
   * Authentication hook that runs before connection upgrade.
   *
   * Return an object to initialize connection data, or undefined/null to reject connection.
   *
   * @param req - HTTP request object
   * @returns Partial connection data, or undefined to reject
   */
  authenticate?: (req: Request) => TData | null | undefined;

  /**
   * Called when an unhandled error occurs in a handler or middleware.
   *
   * Hook should not throw; errors are logged and swallowed.
   *
   * @param error - The error that occurred
   * @param ctx - Optional context (message type, user ID, etc.)
   */
  onError?: (error: Error, ctx?: { type?: string; userId?: string }) => void;

  /**
   * Called when router.publish() is invoked (before actual send).
   *
   * Hook should not throw; errors are logged and swallowed.
   *
   * @param message - The message being broadcast
   * @param scope - The broadcast scope/topic
   */
  onBroadcast?: (message: any, scope: string) => void;

  /**
   * Called during WebSocket upgrade (before authentication).
   *
   * Hook should not throw; errors abort the upgrade with 500.
   *
   * @param req - HTTP request object
   */
  onUpgrade?: (req: Request) => void;

  /**
   * Called after connection is established and authenticated.
   *
   * Hook should not throw; errors are logged.
   *
   * @param ctx - Context with connection info
   */
  onOpen?: (ctx: { ws: { data: TData } }) => void;

  /**
   * Called when connection closes (after cleanup).
   *
   * Hook should not throw; errors are logged.
   *
   * @param ctx - Context with connection info
   */
  onClose?: (ctx: { ws: { data: TData } }) => void;
}
