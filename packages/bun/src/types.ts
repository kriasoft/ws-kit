// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ConnectionData, WebSocketData } from "@ws-kit/core";
import type { ServerWebSocket as BunServerWebSocket } from "bun";

/**
 * Error event passed to onError hook.
 *
 * Per ADR-035: Sync-only hook for logging/telemetry. Flat shape for easy
 * destructuring and future extensibility without breaking existing code.
 * Optional fields allow context availability across all phases.
 */
export interface BunErrorEvent {
  /** Phase where error occurred: discriminator for logging/routing */
  type: "upgrade" | "open" | "message" | "close";
  /** Client ID: undefined only during upgrade (pre-connection) */
  clientId?: string;
  /** Original HTTP request: only for upgrade phase errors */
  req?: Request;
  /** Connection data: sanitized user/auth info from ws.data */
  data?: Record<string, unknown>;
}

/**
 * Options for WebSocket upgrade rejection.
 *
 * Per ADR-035: Customizes HTTP response when authenticate returns undefined.
 * Enables flexible rejection semantics (e.g., 401 vs 403) without breaking auth API.
 */
export interface AuthRejection {
  /** HTTP status code (default: 401). Use 403 for permission, 401 for auth. */
  status?: number;
  /** Response message body (default: "Unauthorized") */
  message?: string;
}

/**
 * Connection context passed to onOpen/onClose lifecycle hooks.
 *
 * Per ADR-035: Hooks are primarily for observability and platform-specific
 * lifecycle operations. They are sync-only to prevent promise-handling issues.
 *
 * **Design note**: Exposes both `data` and `ws` so types match runtime behavior
 * (adapters are mechanical bridges; Bun-specific hooks can expose Bun types).
 * User handlers (router.on, router.rpc) keep opaque ctx.ws per ADR-033.
 *
 * **Intended use**:
 * - `data`: Logging, telemetry, access to connection metadata (primary)
 * - `ws`: Advanced/rare—platform-specific operations only (escape hatch)
 *
 * **Anti-pattern**: Don't put business logic in hooks. Use router handlers
 * or plugins instead. Hooks are for observability and setup/teardown only.
 */
export interface BunConnectionContext<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Connection metadata; **primary field** for logging and telemetry.
   * Same data available on ctx.data in router handlers.
   */
  data: BunConnectionData<TContext>;

  /**
   * Full Bun ServerWebSocket; **advanced field** for rare platform-specific needs.
   * E.g., check ws.readyState. Not available in router handlers (see ADR-033).
   */
  ws: BunServerWebSocket<BunConnectionData<TContext>>;
}

/**
 * Options for creating a Bun WebSocket handler.
 *
 * Per ADR-035, adapters are mechanical bridges. Behavioral concerns
 * (context propagation, observability) belong in plugins, not here.
 */
export interface BunHandlerOptions<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Custom authentication function.
   *
   * Called once per upgrade request in fetch() before server.upgrade().
   * Per ADR-035: Auth is a gatekeeper, not a side effect.
   *
   * - Returns `undefined` → reject with configured status (default 401)
   * - Returns object → merge into connection data and upgrade
   *
   * Rationale: Checked before upgrade to gate connections securely.
   * Called once to avoid double validation and promise chaining.
   */
  authenticate?: (
    req: Request,
  ) => Promise<TContext | undefined> | TContext | undefined;

  /**
   * HTTP response when authentication fails.
   *
   * Default: `{ status: 401, message: "Unauthorized" }`
   *
   * Only used if `authenticate` is present and returns `undefined`.
   */
  authRejection?: AuthRejection;

  /** Custom header for returning client ID in upgrade response */
  clientIdHeader?: string;

  /**
   * Called when an unhandled error occurs in a handler or lifecycle phase.
   *
   * Per ADR-035: Sync-only to prevent promise-handling issues. Use for logging/telemetry.
   * For async cleanup/recovery, build plugins (more robust, composable).
   *
   * Fires in: fetch() catch, websocket.open/message/close catch blocks.
   * Rationale: Consistent observability across all phases without async complexity.
   * Sync ensures no unresolved promises or error suppression.
   */
  onError?: (error: Error, evt: BunErrorEvent) => void;

  /** Called during WebSocket upgrade (before authentication) */
  onUpgrade?: (req: Request) => void;

  /**
   * Called after connection is established and authenticated.
   *
   * **Sync-only hook** (per ADR-035). Use for observability.
   *
   * @example
   * // Basic: logging/telemetry (recommended)
   * onOpen: ({ data }) => {
   *   console.log(`Client connected: ${data.clientId}`);
   *   metrics.increment('connections');
   * },
   *
   * @example
   * // Advanced: platform-specific operations (rare)
   * onOpen: ({ ws, data }) => {
   *   // Caution: Platform-specific; may not port to other adapters.
   *   // Only if absolutely needed for Bun-specific behavior
   *   if (ws.readyState === 'OPEN') {
   *     console.log('Connection ready');
   *   }
   * },
   */
  onOpen?: (ctx: BunConnectionContext<TContext>) => void;

  /**
   * Called when connection closes (after router cleanup).
   *
   * **Sync-only hook** (per ADR-035). Use for observability.
   *
   * @example
   * // Basic: logging/telemetry (recommended)
   * onClose: ({ data }) => {
   *   console.log(`Client disconnected: ${data.clientId}`);
   *   metrics.decrement('connections');
   * },
   */
  onClose?: (ctx: BunConnectionContext<TContext>) => void;
}

/**
 * Bun-specific WebSocket connection data.
 *
 * Extends core WebSocketData with Bun-specific properties.
 */
export type BunConnectionData<
  TContext extends ConnectionData = ConnectionData,
> = WebSocketData<TContext> & {
  /** Connection timestamp (when upgrade was accepted) */
  connectedAt: number;
};

/**
 * Return type of createBunHandler factory.
 *
 * A pair of handlers (fetch and websocket) for use with Bun.serve().
 */
export interface BunServerHandlers<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Fetch handler for HTTP upgrade requests.
   *
   * Returns undefined after a successful server.upgrade (Bun has sent 101 response).
   * Returns a Response on upgrade failure or server errors.
   * This follows Bun's semantics: don't return a Response after a successful upgrade.
   */
  fetch: (
    req: Request,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server: import("bun").Server<any>,
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ) => Response | void | Promise<Response | void>;

  /** WebSocket handler for Bun.serve */
  websocket: import("bun").WebSocketHandler<BunConnectionData<TContext>>;
}
