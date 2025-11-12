/**
 * Platform adapter contract.
 * Concrete implementations: @ws-kit/bun, @ws-kit/cloudflare, etc.
 *
 * Core is platform-agnostic; adapters provide the transport layer.
 */

/**
 * Minimal WebSocket interface (platform-agnostic).
 * Concrete adapters wrap platform-specific WebSocket implementations.
 */
export interface ServerWebSocket {
  /**
   * Send raw data (string or binary).
   */
  send(data: string | ArrayBuffer): void;

  /**
   * Close connection with optional code + reason.
   */
  close(code?: number, reason?: string): void;

  /**
   * Get connection metadata (protocol version, headers, etc.).
   */
  readyState: "CONNECTING" | "OPEN" | "CLOSING" | "CLOSED";

  /**
   * Optional: Initial connection context data set by the adapter.
   * Adapters can pre-populate connection context (e.g., from request headers,
   * auth tokens, persistent state). The router merges this into the connection
   * data store during handleOpen, before lifecycle.onOpen handlers fire.
   *
   * This allows tests and production adapters to seed context uniformly
   * without reaching into internal APIs.
   */
  readonly initialData?: Record<string, unknown>;
}

/**
 * Platform adapter: bridges router ↔ platform transport.
 */
export interface PlatformAdapter {
  /**
   * Get the platform-specific WebSocket wrapper for a client.
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
