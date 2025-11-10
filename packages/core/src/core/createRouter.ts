/**
 * Factory: createRouter(opts?) → Router<TConn>
 *
 * Options:
 * - heartbeat: { intervalMs?, timeoutMs? } → enables heartbeat behavior
 * - limits: { maxPending?, maxPayloadBytes? } → enables rate limiting
 *
 * No capability options here; validators/pubsub/telemetry are plugins.
 */

import type { Router } from "./router";
import type { CreateRouterOptions } from "./types";
import { CoreRouter } from "./router";

/**
 * Create a new router instance.
 *
 * @param opts Optional configuration:
 *   - heartbeat: heartbeat settings (optional)
 *   - limits: message/payload limits (optional)
 * @returns A BaseRouter ready for plugins and handlers
 *
 * Example:
 * ```ts
 * const router = createRouter<{ userId: string }>({
 *   heartbeat: { intervalMs: 30_000, timeoutMs: 5_000 },
 *   limits: { maxPending: 128, maxPayloadBytes: 64 * 1024 },
 * });
 * ```
 */
export function createRouter<TConn = unknown>(
  opts?: CreateRouterOptions,
): Router<TConn> {
  const router = new CoreRouter<TConn>(opts?.limits);

  // Options are stored and enforced in dispatch/adapter layer
  // heartbeat: implemented by adapters (Bun, Cloudflare, etc.)
  // limits: enforced during message processing in dispatchMessage

  return router as any as Router<TConn>;
}
