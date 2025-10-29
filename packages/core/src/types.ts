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
 * See ADR-001 for the conditional payload typing strategy.
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

  /** Server receive timestamp (milliseconds since epoch) */
  receivedAt: number;

  /** Type-safe send function for validated messages */
  send: SendFunction;

  /**
   * Send a type-safe error response to the client.
   *
   * Creates and sends an ERROR message with standard error structure.
   * Use this for errors that should be communicated to the client.
   *
   * @param code - Standard error code (e.g., "AUTH_ERROR", "NOT_FOUND")
   * @param message - Human-readable error description
   * @param details - Optional error context/details
   *
   * @example
   * ```typescript
   * ctx.error("AUTH_ERROR", "Invalid credentials", { hint: "Check your password" });
   * ctx.error("NOT_FOUND", "User not found");
   * ```
   */
  error(code: string, message: string, details?: Record<string, unknown>): void;

  /**
   * Send a response message to the client.
   *
   * Semantic alias for send() with the same signature.
   * Use this for request/response patterns to clarify intent.
   * Functionally equivalent to ctx.send().
   *
   * @example
   * ```typescript
   * router.on(QueryMessage, (ctx) => {
   *   const result = await queryDatabase(ctx.payload);
   *   ctx.reply(QueryResponse, result);  // Clearer than ctx.send()
   * });
   * ```
   */
  reply: SendFunction;

  /**
   * Merge partial data into the connection's custom data object.
   *
   * Safe way to update connection data without replacing it entirely.
   * Calls Object.assign(ctx.ws.data, partial) internally.
   *
   * @param partial - Partial object to merge into ctx.ws.data
   *
   * @example
   * ```typescript
   * router.use((ctx, next) => {
   *   ctx.assignData({ userId: "123", roles: ["admin"] });
   *   return next();
   * });
   * ```
   */
  assignData(partial: Partial<TData>): void;

  /**
   * Subscribe this connection to a pubsub topic/channel.
   *
   * The connection will receive messages published to this topic via router.publish().
   * This is a convenience method that delegates to ctx.ws.subscribe(channel).
   *
   * @param channel - Topic/channel name to subscribe to
   *
   * @example
   * ```typescript
   * router.on(JoinRoom, (ctx) => {
   *   const { roomId } = ctx.payload;
   *   ctx.subscribe(`room:${roomId}`);
   * });
   * ```
   */
  subscribe(channel: string): void;

  /**
   * Unsubscribe this connection from a pubsub topic/channel.
   *
   * The connection will no longer receive messages published to this topic.
   * This is a convenience method that delegates to ctx.ws.unsubscribe(channel).
   *
   * @param channel - Topic/channel name to unsubscribe from
   *
   * @example
   * ```typescript
   * router.onClose((ctx) => {
   *   const roomId = ctx.ws.data?.roomId;
   *   if (roomId) {
   *     ctx.unsubscribe(`room:${roomId}`);
   *   }
   * });
   * ```
   */
  unsubscribe(channel: string): void;

  /** Payload data (conditionally present if schema defines payload) */
  payload?: unknown;

  /** Additional properties may be added by adapters or extensions */
  [key: string]: unknown;
}

/**
 * Options for sending a message.
 */
export interface SendOptions {
  /** Optional metadata to include (timestamp, correlationId, etc.) */
  [key: string]: unknown;
  /** Skip validation of the message payload (default: false). Use only in tests. */
  validate?: boolean;
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
 * @param options - Optional metadata and send options (validate, timestamp, correlationId, etc.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendFunction = (schema: any, data: any, options?: any) => void;

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
 * Middleware function that executes before message handlers.
 *
 * Middleware receives the message context and a `next()` function to proceed
 * to the next middleware or handler. Middleware can:
 * - Call `next()` to proceed to the next middleware/handler
 * - Return early to skip the handler (useful for auth checks, rate limiting, etc.)
 * - Modify `ctx.ws.data` to store data for downstream handlers
 * - Throw errors which are caught and passed to error handlers
 *
 * Middleware executes in registration order. All global middleware execute before
 * per-route middleware.
 *
 * @param context - Message context (generic payload type since middleware doesn't know specific schema)
 * @param next - Function to proceed to next middleware or handler. Returns the result of the handler.
 * @returns Void or Promise<void>. Return value is for logging/instrumentation purposes only.
 *
 * @example Authentication middleware
 * ```typescript
 * const requireAuth = (ctx, next) => {
 *   if (!ctx.ws.data?.userId) {
 *     ctx.send(ErrorSchema, { code: "AUTH_ERROR", message: "Not authenticated" });
 *     return; // Skip handler
 *   }
 *   return next(); // Proceed to handler
 * };
 *
 * router.use(requireAuth);
 * ```
 *
 * @example Logging middleware with async support
 * ```typescript
 * const logTiming = async (ctx, next) => {
 *   const start = performance.now();
 *   await next(); // Wait for handler to complete
 *   const duration = performance.now() - start;
 *   console.log(`[${ctx.type}] completed in ${duration}ms`);
 * };
 *
 * router.use(logTiming);
 * ```
 */
export type Middleware<TData extends WebSocketData = WebSocketData> = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: MessageContext<any, TData>,
  next: () => void | Promise<void>,
) => void | Promise<void>;

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

  /**
   * Optional callback when a connection is detected as stale.
   *
   * Called when a connection fails to respond to heartbeat (times out).
   * The connection is automatically closed after this callback.
   *
   * Useful for:
   * - Logging/metrics
   * - Cleanup of associated resources
   * - Notifying other parts of system
   *
   * @param clientId - Unique connection identifier
   * @param ws - The WebSocket connection
   *
   * @example
   * ```typescript
   * const router = createRouter({
   *   heartbeat: {
   *     intervalMs: 30000,
   *     timeoutMs: 5000,
   *     onStaleConnection: (clientId, ws) => {
   *       console.log(`Closing stale connection: ${clientId}`);
   *       // Clean up resources, update metrics, etc.
   *     },
   *   },
   * });
   * ```
   */
  onStaleConnection?: (clientId: string, ws: ServerWebSocket) => void;
}

/**
 * Message payload size constraints.
 */
export interface LimitsConfig {
  /** Maximum message payload size in bytes (default: 1,000,000) */
  maxPayloadBytes?: number;
}

/**
 * Default connection data type for ambient module declaration.
 *
 * Applications can declare their default connection data type once using
 * TypeScript's declaration merging, then omit the TData generic everywhere:
 *
 * @example
 * ```typescript
 * // types/app-data.d.ts
 * declare module "@ws-kit/core" {
 *   interface AppDataDefault {
 *     userId?: string;
 *     roles?: string[];
 *     tenant?: string;
 *   }
 * }
 *
 * // Now in any module (no generic needed):
 * import { createRouter } from "@ws-kit/zod";
 * const router = createRouter(); // Automatically uses AppDataDefault
 *
 * router.on(LoginSchema, (ctx) => {
 *   // ctx.ws.data is properly typed with userId, roles, tenant
 * });
 * ```
 *
 * This avoids repeating the TData generic at every router instantiation.
 * Keep this interface empty in the library; users extend it in their own code.
 */
export interface AppDataDefault {}

/**
 * Router configuration options.
 *
 * Specifies the ValidatorAdapter (for schema validation), PlatformAdapter
 * (for platform-specific features), PubSub implementation (for broadcasting),
 * lifecycle hooks, heartbeat settings, payload limits, and logging.
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

  /**
   * Logger adapter for structured logging (optional).
   *
   * If not provided, router will use default console logging.
   * Allows integration with Winston, Pino, structured logging services, etc.
   *
   * @example
   * ```typescript
   * import { createRouter, createLogger } from "@ws-kit/zod";
   *
   * const logger = createLogger({
   *   minLevel: "info",
   *   log: (level, context, message, data) => {
   *     // Send to logging service
   *   },
   * });
   *
   * const router = createRouter({ logger });
   * ```
   */
  logger?: any; // LoggerAdapter - use 'any' to avoid circular dependency
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
 * Public route entry for router composition.
 *
 * Represents a single message route with its handlers and middleware.
 * Used by the routes() accessor to provide clean router composition without private access.
 */
export interface RouteEntry<TData extends WebSocketData = WebSocketData> {
  messageType: string;
  handler: MessageHandlerEntry<TData>;
  middleware: Middleware<TData>[];
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
