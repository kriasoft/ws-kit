// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Platform-agnostic WebSocket abstraction.
 *
 * Each platform (Bun, Cloudflare DO, Node.js, etc.) provides its own concrete
 * implementation that conforms to this interface. Allows core router logic to
 * remain platform-independent while supporting platform-specific features.
 */
export interface ServerWebSocket<TData = unknown> {
  /** Custom application data attached to this connection */
  data: TData;

  /** Send a text message to the client */
  send(message: string | Uint8Array): void;

  /** Close the connection with optional code and reason */
  close(code?: number, reason?: string): void;

  /** Subscribe to a broadcast channel */
  subscribe(channel: string): void;

  /** Unsubscribe from a broadcast channel */
  unsubscribe(channel: string): void;

  /** Check if connection is still open */
  readyState?: number;
}

/**
 * WebSocket connection data that always includes clientId (UUID v7).
 *
 * INVARIANT: clientId is generated on connection and never changes.
 * Used for logging, tracing, and preventing spoofing.
 */
export type WebSocketData<T = unknown> = {
  /** Unique client identifier (UUID v7) generated on connection */
  clientId: string;
} & T;

/**
 * Metadata associated with a WebSocket message.
 *
 * Server-controlled fields (clientId, receivedAt) are set by the router
 * and cannot be overridden by the client. Additional metadata may be
 * provided by the client or middleware.
 */
export interface MessageMeta {
  /** Unique client identifier (same as ctx.ws.data.clientId) */
  clientId: string;

  /** Server ingress timestamp (when message was received) */
  receivedAt: number;

  /** Optional timestamp from client (consumer-provided, not trusted for server logic) */
  timestamp?: number;

  /** Optional correlation ID for request/response patterns */
  correlationId?: string;

  /** Platform-specific metadata (may be extended by adapters) */
  [key: string]: unknown;
}

/**
 * Context passed to message handlers.
 *
 * Generic parameter TSchema is used for type inference only (for IDE and TypeScript
 * type checking). The actual schema information comes from the router's ValidatorAdapter.
 * See ADR-001 in specs/adrs.md for the conditional payload typing strategy.
 */
export interface MessageContext<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TSchema extends MessageSchemaType = MessageSchemaType,
  TData extends WebSocketData = WebSocketData,
> {
  /** WebSocket connection with custom application data */
  ws: ServerWebSocket<TData>;

  /** Message type (e.g., "PING", "PONG") */
  type: string;

  /** Message metadata including clientId and receivedAt */
  meta: MessageMeta;

  /** Type-safe send function for validated messages */
  send: SendFunction;

  /** Payload data (conditionally present if schema defines payload) */
  payload?: unknown;

  /** Additional properties may be added by adapters or extensions */
  [key: string]: unknown;
}

/**
 * Type-safe send function for sending validated messages to the client.
 *
 * The exact signature depends on the ValidatorAdapter. Generic signature accepts
 * any schema and data; validator-specific adapters provide overloads for better
 * IDE type inference.
 *
 * @param schema - Message schema for validation
 * @param data - Payload data to send
 * @param meta - Optional metadata to include (timestamp, correlationId, etc.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendFunction = (schema: any, data: any, meta?: any) => void;

/**
 * Handler for WebSocket open event.
 *
 * Called when a client successfully connects. Multiple handlers can be registered
 * and are executed sequentially. Async handlers are supported.
 */
export interface OpenHandlerContext<
  TData extends WebSocketData = WebSocketData,
> {
  /** WebSocket connection with custom data */
  ws: ServerWebSocket<TData>;

  /** Type-safe send function for validated messages */
  send: SendFunction;
}

export type OpenHandler<TData extends WebSocketData = WebSocketData> = (
  context: OpenHandlerContext<TData>,
) => void | Promise<void>;

/**
 * Handler for WebSocket close event.
 *
 * Called when a client disconnects. Multiple handlers can be registered and are
 * executed sequentially. Async handlers are supported. This is the primary place
 * to perform cleanup (release locks, remove from rooms, etc.).
 */
export interface CloseHandlerContext<
  TData extends WebSocketData = WebSocketData,
> {
  /** WebSocket connection with custom data */
  ws: ServerWebSocket<TData>;

  /** WebSocket close code (1000 = normal, 1006 = abnormal, etc.) */
  code: number;

  /** Optional close reason string */
  reason?: string;

  /** Type-safe send function for validated messages */
  send: SendFunction;
}

export type CloseHandler<TData extends WebSocketData = WebSocketData> = (
  context: CloseHandlerContext<TData>,
) => void | Promise<void>;

/**
 * Handler for WebSocket messages.
 *
 * Called when a validated message of the registered type arrives. The generic
 * TSchema parameter enables type-safe access to ctx.payload.
 *
 * @param context - Message context with ws, type, meta, payload, send
 */
export type MessageHandler<
  TSchema extends MessageSchemaType = MessageSchemaType,
  TData extends WebSocketData = WebSocketData,
> = (context: MessageContext<TSchema, TData>) => void | Promise<void>;

/**
 * Handler for authentication events.
 *
 * Called on the first message before dispatching to the message handler.
 * Use this to validate the client and potentially store auth data in ctx.ws.data.
 *
 * @param context - Message context (includes the first message)
 * @returns true if authenticated, false to reject and close connection
 */
export type AuthHandler<TData extends WebSocketData = WebSocketData> = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: MessageContext<any, TData>,
) => boolean | Promise<boolean>;

/**
 * Handler for error events.
 *
 * Called when an error occurs during message processing (parse, validation,
 * handler execution, etc.). Errors are logged but don't close the connection
 * automatically.
 *
 * @param error - The error that occurred
 * @param context - Message context (may be partial if error occurred early)
 */
export type ErrorHandler<TData extends WebSocketData = WebSocketData> = (
  error: Error,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: MessageContext<any, TData>,
) => void;

/**
 * Router lifecycle hooks.
 *
 * Each hook can be registered multiple times. Hooks are executed in registration order.
 */
export interface RouterHooks<TData extends WebSocketData = WebSocketData> {
  /** Called when a client connects */
  onOpen?: OpenHandler<TData>;

  /** Called when a client disconnects */
  onClose?: CloseHandler<TData>;

  /** Called before dispatching first message (authentication check) */
  onAuth?: AuthHandler<TData>;

  /** Called when an error occurs during message processing */
  onError?: ErrorHandler<TData>;
}

/**
 * Configuration for connection heartbeat (ping/pong).
 *
 * The router can automatically send periodic ping frames to detect stale
 * connections. If the client doesn't respond with pong within the timeout,
 * the connection is closed.
 */
export interface HeartbeatConfig {
  /** Interval in milliseconds between sending ping frames (default: 30000) */
  intervalMs?: number;

  /** Timeout in milliseconds to wait for pong response (default: 5000) */
  timeoutMs?: number;
}

/**
 * Message payload size constraints.
 */
export interface LimitsConfig {
  /** Maximum message payload size in bytes (default: 1,000,000) */
  maxPayloadBytes?: number;
}

/**
 * Router configuration options.
 *
 * Specifies the ValidatorAdapter (for schema validation), PlatformAdapter
 * (for platform-specific features), PubSub implementation (for broadcasting),
 * lifecycle hooks, heartbeat settings, and payload limits.
 */
export interface WebSocketRouterOptions<
  V extends ValidatorAdapter = ValidatorAdapter,
  TData extends WebSocketData = WebSocketData,
> {
  /** Validator adapter for schema validation (e.g., Zod, Valibot) */
  validator?: V;

  /** Platform adapter for platform-specific features */
  platform?: PlatformAdapter;

  /** PubSub implementation for broadcasting (default: MemoryPubSub) */
  pubsub?: PubSub;

  /** Lifecycle hooks (open, close, auth, error) */
  hooks?: RouterHooks<TData>;

  /** Connection heartbeat configuration */
  heartbeat?: HeartbeatConfig;

  /** Message payload constraints */
  limits?: LimitsConfig;
}

/**
 * Placeholder for validator-specific schema types.
 *
 * Validator adapters (Zod, Valibot) define their own schema types that
 * conform to this interface. This allows the core router to remain
 * validator-agnostic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageSchemaType = any;

/**
 * Entry for a registered message handler.
 *
 * Stores the schema and handler for a specific message type.
 */
export interface MessageHandlerEntry<
  TData extends WebSocketData = WebSocketData,
> {
  schema: MessageSchemaType;
  handler: MessageHandler<MessageSchemaType, TData>;
}

/**
 * Adapter interface for pluggable validation libraries.
 *
 * Implementations bridge Zod/Valibot specifics with generic router logic.
 * Each adapter knows how to extract message type, validate payloads, and
 * provide type inference information.
 */
export interface ValidatorAdapter {
  /** Extract message type from a schema */
  getMessageType(schema: MessageSchemaType): string;

  /** Safely parse data against a schema */
  safeParse(
    schema: MessageSchemaType,
    data: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { success: boolean; data?: any; error?: any };

  /** Infer TypeScript type from schema (type-only, used by IDE) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  infer<T extends MessageSchemaType>(schema: T): any;
}

/**
 * Platform-specific adapter interface.
 *
 * Provides platform-specific implementations of core features like
 * PubSub (broadcasting). Each platform (Bun, Cloudflare DO, Node.js, etc.)
 * provides its own adapter implementation.
 */
export interface PlatformAdapter {
  /** Platform-specific PubSub implementation for broadcasting */
  pubsub?: PubSub;

  /** Optional: Wrap a platform-specific WebSocket to conform to ServerWebSocket interface */
  getServerWebSocket?(ws: unknown): ServerWebSocket;

  /** Optional: Platform-specific initialization */
  init?(): Promise<void>;

  /** Optional: Platform-specific cleanup */
  destroy?(): Promise<void>;
}

/**
 * Pub/Sub interface for broadcasting messages to subscribed channels.
 *
 * Implementations may be in-memory, Redis-based, or platform-native
 * (e.g., Bun's server.publish, Cloudflare DO's BroadcastChannel).
 */
export interface PubSub {
  /**
   * Publish a message to a channel.
   *
   * Subscribers to this channel will receive the message.
   *
   * @param channel - Channel name
   * @param message - Message data (typically JSON-serializable)
   */
  publish(channel: string, message: unknown): Promise<void>;

  /**
   * Subscribe to a channel.
   *
   * @param channel - Channel name
   * @param handler - Called when a message is published to this channel
   */
  subscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void;

  /**
   * Unsubscribe from a channel.
   *
   * @param channel - Channel name
   * @param handler - Handler to remove
   */
  unsubscribe(
    channel: string,
    handler: (message: unknown) => void | Promise<void>,
  ): void;
}
