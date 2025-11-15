/**
 * Platform adapter contract.
 * Concrete implementations: @ws-kit/bun, @ws-kit/cloudflare, etc.
 *
 * Core is platform-agnostic; adapters provide the transport layer.
 */

/**
 * Public WebSocket interface for user code (opaque transport).
 * Only exposes send, close, and readyState. All connection state lives in ctx.data.
 *
 * ⚠️ User code MUST treat this as opaque transport.
 * Do not attempt to access any fields beyond send(), close(), and readyState.
 */
export interface ServerWebSocket {
  /**
   * Send raw data (string or binary).
   * Only adapters and routers should call this; user code goes through ctx.send().
   */
  send(data: string | ArrayBuffer): void;

  /**
   * Close connection with optional code + reason.
   * Only adapters and routers should call this; user code goes through ctx.close().
   */
  close(code?: number, reason?: string): void;

  /**
   * Connection state (CONNECTING | OPEN | CLOSING | CLOSED).
   * Reflects the underlying platform socket's readiness state.
   */
  readyState: "CONNECTING" | "OPEN" | "CLOSING" | "CLOSED";
}

/**
 * Internal WebSocket interface for adapters and router internals.
 * Extends ServerWebSocket with adapter-only initialData field for seeding connection context.
 *
 * Only adapters and test utilities should use this. User code receives ServerWebSocket only.
 */
export interface AdapterWebSocket extends ServerWebSocket {
  /**
   * Optional: Initial connection context data set by the adapter.
   * Adapters can pre-populate connection context (e.g., from request headers,
   * auth tokens, persistent state). The router merges this into the connection
   * data store during handleOpen, before lifecycle.onOpen handlers fire.
   *
   * Mutable during the brief window before router.websocket.open(ws).
   * After that, adapter-only—use ctx.data for all user code.
   */
  initialData?: Record<string, unknown>;
}

/**
 * Platform adapter: bridges router ↔ platform transport.
 */
export interface PlatformAdapter {
  /**
   * Get the platform-specific WebSocket wrapper for a client.
   * Returns the public ServerWebSocket interface (opaque transport).
   */
  getServerWebSocket(clientId: string): ServerWebSocket | undefined;

  /**
   * Called when router wants to close a connection.
   */
  close(clientId: string, code?: number, reason?: string): void;

  /**
   * Called when router sends data to a client.
   * (Should be a no-op if already sent; adapter tracks state)
   */
  send(clientId: string, data: string | ArrayBuffer): void;

  /**
   * Optional: get connection info (headers, IP, etc.).
   */
  getConnectionInfo?(clientId: string): Record<string, unknown>;
}
