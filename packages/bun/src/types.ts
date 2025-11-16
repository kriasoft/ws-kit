// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ServerWebSocket as BunServerWebSocket } from "bun";
import type { WebSocketData } from "@ws-kit/core";

/**
 * Options for WebSocket upgrade in Bun.
 *
 * Passed to the fetch handler to configure how the connection is upgraded.
 */
export interface UpgradeOptions<TData = unknown> {
  /** Bun server instance (required for upgrade) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: import("bun").Server<any>;

  /** Custom application data attached to the connection */
  data?: TData;

  /** HTTP headers to include in the upgrade response */
  headers?: Record<string, string> | Headers;

  /** Authentication function called during upgrade */
  authenticate?: (req: Request) => Promise<TData> | TData;

  /** Context passed to auth/handlers (e.g., database connections, env vars) */
  context?: unknown;
}

/**
 * Error context passed to onError hook.
 *
 * Per ADR-035: Sync-only hook for logging/telemetry. Flat shape for easy
 * destructuring and future extensibility without breaking existing code.
 * Optional fields allow context availability across all phases.
 */
export interface ErrorContext {
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
 * Context passed to onOpen/onClose lifecycle hooks.
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
export interface BunOpenCloseContext<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Connection metadata; **primary field** for logging and telemetry.
   * Same data available on ctx.data in router handlers.
   */
  data: BunWebSocketData<TData>;

  /**
   * Full Bun ServerWebSocket; **advanced field** for rare platform-specific needs.
   * E.g., check ws.readyState. Not available in router handlers (see ADR-033).
   */
  ws: BunServerWebSocket<BunWebSocketData<TData>>;
}

/**
 * Options for creating a Bun WebSocket handler.
 *
 * Per ADR-035, adapters are mechanical bridges. Behavioral concerns
 * (context propagation, observability) belong in plugins, not here.
 */
export interface BunHandlerOptions<
  TData extends Record<string, unknown> = Record<string, unknown>,
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
  ) => Promise<TData | undefined> | TData | undefined;

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
  onError?: (error: Error, ctx: ErrorContext) => void;

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
  onOpen?: (ctx: BunOpenCloseContext<TData>) => void;

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
  onClose?: (ctx: BunOpenCloseContext<TData>) => void;
}

/**
 * Bun-specific WebSocket connection data.
 *
 * Extends core WebSocketData with Bun-specific properties.
 */
export type BunWebSocketData<
  T extends Record<string, unknown> = Record<string, unknown>,
> = WebSocketData<T> & {
  /** Connection timestamp (when upgrade was accepted) */
  connectedAt: number;
};

/**
 * Type alias for Bun's ServerWebSocket for convenience.
 *
 * This is a local type in @ws-kit/bun only and should not be imported elsewhere.
 * The core ServerWebSocket interface is intentionally non-generic to stay platform-agnostic.
 * Per-connection state lives in ctx.data (via module augmentation of ConnectionData).
 *
 * This type is useful for Bun-specific application code that needs typed access to
 * the platform-specific ws.data, but the router only uses plain ServerWebSocket.
 */
export type BunWebSocket<TData = unknown> = BunServerWebSocket<TData>;

/**
 * Return type of createBunHandler factory.
 */
export interface BunHandler<
  TData extends Record<string, unknown> = Record<string, unknown>,
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
  websocket: import("bun").WebSocketHandler<BunWebSocketData<TData>>;
}
