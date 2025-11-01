// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { WsKitError } from "./error.js";

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

  /** Optional timeout in milliseconds (for RPC requests) */
  timeoutMs?: number;

  /** Optional idempotency key (for safe retries on reconnect) */
  idempotencyKey?: string;

  /** Platform-specific metadata (may be extended by adapters) */
  [key: string]: unknown;
}

/**
 * Context passed to fire-and-forget message handlers (via router.on()).
 *
 * Event handlers don't produce a guaranteed response, so they have access to:
 * - `ctx.send()` for one-off side-effect messages (fire-and-forget)
 * - `ctx.publish()` for pub/sub broadcasts
 * - `ctx.subscribe()` / `ctx.unsubscribe()` for topic management
 *
 * RPC-specific methods (reply, progress, onCancel, deadline) are NOT available.
 * For request/response patterns, use router.rpc() instead.
 *
 * Generic parameter TSchema is used for type inference only (for IDE and TypeScript
 * type checking). The actual schema information comes from the router's ValidatorAdapter.
 */
export interface EventMessageContext<
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

  /** Type-safe send function for validated messages (fire-and-forget) */
  send: SendFunction;

  /**
   * Send a type-safe error response to the client.
   *
   * Creates and sends an ERROR message with unified error structure.
   * Supports deterministic client backoff via retryable + retryAfterMs hints.
   *
   * @param code - Standard error code (one of 13 gRPC-aligned codes per ERROR_CODE_META)
   * @param message - Optional human-readable error description
   * @param details - Optional error context/details (structured data safe for clients)
   * @param options - Optional retry semantics: retryable (boolean) and retryAfterMs (ms hint)
   *
   * @example
   * // Non-retryable error
   * ctx.error("NOT_FOUND", "User not found", { userId: "123" });
   *
   * // Transient error with backoff hint
   * ctx.error("RESOURCE_EXHAUSTED", "Buffer full", undefined, {
   *   retryable: true,
   *   retryAfterMs: 100
   * });
   */
  error(
    code: string,
    message?: string,
    details?: Record<string, unknown>,
    options?: {
      retryable?: boolean;
      retryAfterMs?: number;
    },
  ): void;

  /**
   * Merge partial data into the connection's custom data object.
   *
   * Safe way to update connection data without replacing it entirely.
   * Calls Object.assign(ctx.ws.data, partial) internally.
   *
   * @param partial - Partial object to merge into ctx.ws.data
   */
  assignData(partial: Partial<TData>): void;

  /**
   * Subscribe this connection to a pubsub topic/channel.
   *
   * The connection will receive messages published to this topic via router.publish().
   *
   * @param channel - Topic/channel name to subscribe to
   */
  subscribe(channel: string): void;

  /**
   * Unsubscribe this connection from a pubsub topic/channel.
   *
   * The connection will no longer receive messages published to this topic.
   *
   * @param channel - Topic/channel name to unsubscribe from
   */
  unsubscribe(channel: string): void;

  /**
   * Publish a typed message to a channel/topic (convenience method).
   *
   * Validates the payload against the schema and broadcasts to all subscribers.
   * This is a bound passthrough to router.publish() optimized for use within handlers.
   *
   * @param channel - Topic/channel name to publish to
   * @param schema - Message schema (validated before broadcast)
   * @param payload - Message payload (must match schema)
   * @param options - Publish options (excludeSelf, partitionKey, meta)
   * @returns Promise resolving to PublishResult with delivery information and capability
   */
  publish(
    channel: string,
    schema: MessageSchemaType,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<PublishResult>;

  /**
   * Milliseconds remaining until the deadline (returns Infinity for events).
   *
   * @returns Infinity for event messages (no deadline)
   */
  timeRemaining(): number;

  /**
   * Flag indicating this is an event (not an RPC).
   *
   * Set to false for fire-and-forget messages.
   */
  isRpc: false;

  /** Payload data (conditionally present if schema defines payload) */
  payload?: unknown;

  /** Additional properties may be added by adapters or extensions */
  [key: string]: unknown;
}

/**
 * Context passed to request/response message handlers (via router.rpc()).
 *
 * RPC handlers produce a guaranteed, one-shot response with correlation tracking,
 * deadline awareness, and optional progress streaming. All RPC-specific methods are
 * guaranteed to be present.
 *
 * Generic parameter TSchema is used for type inference only (for IDE and TypeScript
 * type checking). The actual schema information comes from the router's ValidatorAdapter.
 */
export interface RpcMessageContext<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TSchema extends MessageSchemaType = MessageSchemaType,
  TData extends WebSocketData = WebSocketData,
> {
  /** WebSocket connection with custom application data */
  ws: ServerWebSocket<TData>;

  /** Message type (e.g., "GET_USER", "QUERY_DB") */
  type: string;

  /** Message metadata including clientId, receivedAt, and correlationId */
  meta: MessageMeta;

  /** Server receive timestamp (milliseconds since epoch) */
  receivedAt: number;

  /** Type-safe send function for validated messages (side effects during RPC) */
  send: SendFunction;

  /**
   * Send a type-safe error response to the client (RPC error).
   *
   * Creates and sends an RPC_ERROR message with unified error structure.
   * One-shot guarded: first error wins, subsequent calls are suppressed.
   * Supports deterministic client backoff via retryable + retryAfterMs hints.
   *
   * @param code - Standard error code (one of 13 gRPC-aligned codes per ERROR_CODE_META)
   * @param message - Optional human-readable error description
   * @param details - Optional error context/details (structured data safe for clients)
   * @param options - Optional retry semantics: retryable (boolean) and retryAfterMs (ms hint)
   *
   * @example
   * // Send non-retryable error
   * ctx.error("INVALID_ARGUMENT", "Invalid user ID", { field: "userId" });
   *
   * // Send transient error with backoff
   * ctx.error("RESOURCE_EXHAUSTED", "Rate limited", undefined, {
   *   retryable: true,
   *   retryAfterMs: 100
   * });
   */
  error(
    code: string,
    message?: string,
    details?: Record<string, unknown>,
    options?: {
      retryable?: boolean;
      retryAfterMs?: number;
    },
  ): void;

  /**
   * Merge partial data into the connection's custom data object.
   *
   * Safe way to update connection data without replacing it entirely.
   *
   * @param partial - Partial object to merge into ctx.ws.data
   */
  assignData(partial: Partial<TData>): void;

  /**
   * Subscribe this connection to a pubsub topic/channel.
   *
   * The connection will receive messages published to this topic via router.publish().
   *
   * @param channel - Topic/channel name to subscribe to
   */
  subscribe(channel: string): void;

  /**
   * Unsubscribe this connection from a pubsub topic/channel.
   *
   * The connection will no longer receive messages published to this topic.
   *
   * @param channel - Topic/channel name to unsubscribe from
   */
  unsubscribe(channel: string): void;

  /**
   * Publish a typed message to a channel/topic (convenience method).
   *
   * Validates the payload against the schema and broadcasts to all subscribers.
   * This is a bound passthrough to router.publish() optimized for use within handlers.
   *
   * @param channel - Topic/channel name to publish to
   * @param schema - Message schema (validated before broadcast)
   * @param payload - Message payload (must match schema)
   * @param options - Publish options (excludeSelf, partitionKey, meta)
   * @returns Promise resolving to PublishResult with delivery information and capability
   */
  publish(
    channel: string,
    schema: MessageSchemaType,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<PublishResult>;

  /**
   * Register a callback to be invoked when this RPC is cancelled.
   *
   * Called when:
   * - Client sends RPC_ABORT (due to AbortSignal)
   * - Client disconnects during an RPC
   *
   * Useful for cleanup (cancel DB queries, stop timers, release resources).
   * Multiple callbacks can be registered; all are invoked in registration order.
   *
   * @param cb - Callback invoked on cancellation
   * @returns Function to unregister this callback
   */
  onCancel(cb: () => void): () => void;

  /**
   * Standard AbortSignal that fires when this RPC is cancelled or the client disconnects.
   *
   * Provides seamless integration with APIs that accept AbortSignal:
   * - fetch() requests
   * - Database drivers with timeout support
   * - Async operations that respect cancellation
   */
  abortSignal: AbortSignal;

  /**
   * Send a progress update for an RPC request (non-terminal).
   *
   * Sends a unicast message with the same correlation ID as the RPC.
   * Safe no-op if backpressured (skipped silently if buffer is full).
   *
   * Use this for streaming results or long-running operations:
   * - Progress updates (e.g., "50% complete")
   * - Partial results before the final reply
   * - Status messages during processing
   *
   * Terminal reply must be sent via `ctx.reply()`.
   * Progress messages are optional; client may not wait for them.
   *
   * @param data - Optional progress data (if undefined, sends lightweight ping)
   */
  progress(data?: unknown): void;

  /**
   * Send a terminal reply for an RPC request (type-safe, one-shot).
   *
   * Automatically enforces that the response matches the bound response schema.
   * One-shot guarded: multiple calls are suppressed (logged in dev mode).
   *
   * @param responseSchema - The response message schema
   * @param data - Response data (must match the response schema)
   * @param options - Optional metadata and send options
   */
  reply(
    responseSchema: MessageSchemaType,
    data: unknown,
    options?: Record<string, unknown>,
  ): void;

  /**
   * Server-derived deadline for this RPC request (milliseconds since epoch).
   *
   * Computed as `receivedAt + (meta.timeoutMs ?? router.defaultTimeoutMs)`.
   * Allows handlers to check remaining time without knowing client timeout.
   */
  deadline: number;

  /**
   * Milliseconds remaining until the deadline (never negative).
   *
   * Calculated as `Math.max(0, deadline - Date.now())`.
   *
   * @returns Milliseconds remaining (0 means deadline passed)
   */
  timeRemaining(): number;

  /**
   * Flag indicating this is an RPC (request/response) message.
   *
   * Always true for RPC handlers. Useful in middleware to apply RPC-specific logic.
   */
  isRpc: true;

  /** Payload data (conditionally present if schema defines payload) */
  payload?: unknown;

  /** Additional properties may be added by adapters or extensions */
  [key: string]: unknown;
}

/**
 * Union type for message contexts (used in middleware and type-agnostic code).
 *
 * Use EventMessageContext or RpcMessageContext for specific handler types.
 */
export type MessageContext<
  TSchema extends MessageSchemaType = MessageSchemaType,
  TData extends WebSocketData = WebSocketData,
> = EventMessageContext<TSchema, TData> | RpcMessageContext<TSchema, TData>;

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
 * Options for publishing a message to a channel/topic.
 *
 * Allows fine-tuning publish behavior and future routing capabilities.
 *
 * **Design note** (ADR-019): These options are reserved for extensibility without breaking
 * API changes. Current implementations use only `meta`; `excludeSelf` and `partitionKey`
 * are placeholders for future distributed pubsub and sharding features.
 */
export interface PublishOptions {
  /**
   * Exclude the sender from receiving the published message (default: false).
   *
   * When false (default), the sender is included in the subscriber list.
   * When true, the sender will not receive their own published message.
   *
   * **Default: false** to avoid surprises — sender usually wants to know the state changed.
   * This aligns with the principle of least surprise in pub/sub systems.
   *
   * **Implementation**: When called from within a handler context (with clientId),
   * excludeSelf filters out that specific sender. Server-initiated calls (no clientId)
   * ignore this option as there is no sender to exclude.
   */
  excludeSelf?: boolean;

  /**
   * Partition key for future sharding/fanout routing (optional).
   *
   * Allows steering message routing for distributed PubSub implementations.
   * In adapters that don't support partitioning, this is accepted but ignored.
   *
   * **Use case**: In Kafka, Redis Cluster, or custom sharded pubsub backends,
   * this can direct messages to specific partitions for scaling and consistency.
   *
   * @example "user:123" for per-user partitioning in multi-shard setup
   * @example "room:456" for room-affinity in horizontally scaled systems
   */
  partitionKey?: string;

  /**
   * Additional metadata to include in the published message.
   *
   * Merged into the message meta alongside auto-injected fields (timestamp).
   * Use this to include application-specific metadata that doesn't belong in the payload.
   *
   * @example { origin: "admin", reason: "bulk-sync" }
   * @example { correlationId: "req-123", source: "cron" }
   */
  meta?: Record<string, unknown>;
}

/**
 * Result of publishing a message to a channel/topic.
 *
 * Provides honest semantics about what was delivered, since subscriber counts
 * can vary widely across implementations (exact for in-process, estimates for
 * distributed, unknown for some adapters).
 *
 * **Capabilities**:
 * - `ok: true; capability: "exact"` — Exact recipient count (e.g., MemoryPubSub)
 * - `ok: true; capability: "estimate"` — Best-effort estimate (e.g., Redis)
 * - `ok: true; capability: "unknown"` — Delivery not tracked (e.g., some adapters)
 * - `ok: false` — Delivery failed due to validation, ACL, or adapter error
 *
 * **Backward Compatibility**: The legacy `Promise<number>` return type is still supported
 * via method overloading. New code should use the `PublishResult` return type for accurate
 * semantics and error handling.
 */
export type PublishResult =
  | {
      ok: true;
      /** "exact": MemoryPubSub or other adapters with precise subscription tracking */
      capability: "exact" | "estimate" | "unknown";
      /** Matched subscriber count (undefined if capability is "unknown") */
      matched?: number;
    }
  | {
      ok: false;
      /** Reason for failure: validation error, ACL denial, or adapter error */
      reason: "validation" | "acl" | "adapter_error";
      /** Optional error details for debugging */
      error?: unknown;
    };

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
 * Handler for fire-and-forget message events (registered via router.on()).
 *
 * Called when a validated fire-and-forget message arrives.
 * The generic TSchema parameter enables type-safe access to ctx.payload.
 *
 * Event handlers do NOT have access to RPC methods (reply, progress, onCancel, deadline).
 * Use ctx.send() for side-effect messages or ctx.publish() for pub/sub broadcasts.
 *
 * @param context - Event message context (no RPC methods)
 */
export type EventHandler<
  TSchema extends MessageSchemaType = MessageSchemaType,
  TData extends WebSocketData = WebSocketData,
> = (context: EventMessageContext<TSchema, TData>) => void | Promise<void>;

/**
 * Handler for request/response RPC messages (registered via router.rpc()).
 *
 * Called when a validated RPC request arrives.
 * The generic TSchema parameter enables type-safe access to ctx.payload.
 *
 * RPC handlers MUST call ctx.reply() or ctx.error() to send a terminal response.
 * Optional: call ctx.progress() for streaming updates before terminal reply.
 *
 * @param context - RPC message context (has reply, progress, onCancel, deadline)
 */
export type RpcHandler<
  TSchema extends MessageSchemaType = MessageSchemaType,
  TData extends WebSocketData = WebSocketData,
> = (context: RpcMessageContext<TSchema, TData>) => void | Promise<void>;

/**
 * Generic handler type (union of event and RPC handlers).
 *
 * Used internally when dispatching messages. For specific handler types,
 * use EventHandler or RpcHandler.
 */
export type MessageHandler<
  TSchema extends MessageSchemaType = MessageSchemaType,
  TData extends WebSocketData = WebSocketData,
> = EventHandler<TSchema, TData> | RpcHandler<TSchema, TData>;

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
 * handler execution, etc.). Errors are standardized as WsKitError objects with
 * code, message, details, and originalError (for internal debugging).
 *
 * This enables structured error logging and integration with observability tools
 * like ELK, Sentry, and similar platforms.
 *
 * Errors are logged but don't close the connection automatically.
 *
 * @param error - WsKitError with standardized structure
 * @param context - Message context including type, ws, meta, and payload
 * @returns Return false (or falsy) to suppress automatic error response. If any error
 *          handler returns false, the router will not send an INTERNAL response
 *          to the client (assuming autoSendErrorOnThrow is enabled).
 */
export type ErrorHandler<TData extends WebSocketData = WebSocketData> =
  | ((error: WsKitError) => boolean | undefined)
  | ((
      error: WsKitError,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: MessageContext<any, TData>,
    ) => boolean | undefined);

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
 *     ctx.send(ErrorSchema, { code: "UNAUTHENTICATED", message: "Not authenticated" });
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
 * Handler for limit exceeded events.
 *
 * Called when a connection exceeds a configured limit (e.g., message size).
 * Multiple handlers can be registered and are executed sequentially.
 * Exceptions in handlers are logged but don't interrupt other handlers.
 *
 * Useful for:
 * - Metrics/monitoring (increment counters, emit alerts)
 * - Custom logging with structured context
 * - Rate limiting decisions
 * - Resource cleanup
 *
 * @param info - Structured limit exceeded information
 * @returns void or Promise<void>
 */
export type LimitExceededHandler<TData extends WebSocketData = WebSocketData> =
  (info: LimitExceededInfo<TData>) => void | Promise<void>;

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

  /** Called when a connection exceeds a configured limit (payload size, rate, etc.) */
  onLimitExceeded?: LimitExceededHandler<TData>;
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
 * Type discriminator for limit violations.
 *
 * Used to identify which limit was exceeded, allowing extensibility for future limit types.
 */
export type LimitType = "payload" | "rate" | "connections" | "backpressure";

/**
 * Information about a limit being exceeded.
 *
 * Passed to the onLimitExceeded hook to enable monitoring, metrics, and custom handling.
 */
export interface LimitExceededInfo<
  TData extends WebSocketData = WebSocketData,
> {
  /** Type of limit exceeded (payload, rate, connections, etc.) */
  type: LimitType;

  /** Observed value (bytes for payload, requests/sec for rate, count for connections) */
  observed: number;

  /** Configured limit value */
  limit: number;

  /** WebSocket connection */
  ws: ServerWebSocket<TData>;

  /** Unique client identifier */
  clientId: string;

  /** Optional: milliseconds to suggest client waits before retry */
  retryAfterMs?: number;
}

/**
 * Message payload size constraints and limit violation behavior.
 */
export interface LimitsConfig {
  /** Maximum message payload size in bytes (default: 1,000,000) */
  maxPayloadBytes?: number;

  /**
   * How to respond when a limit is exceeded (default: "send").
   *
   * - "send": Send RESOURCE_EXHAUSTED error frame, keep connection open
   * - "close": Close connection with WebSocket code (default 1009), no error frame
   * - "custom": Do nothing else (app will handle in onLimitExceeded hook)
   */
  onExceeded?: "send" | "close" | "custom";

  /**
   * WebSocket close code when onExceeded === "close" (default: 1009).
   *
   * Standard WebSocket codes:
   * - 1009: Message Too Big (RFC 6455)
   * - 1008: Policy Violation
   * - 1011: Server Error
   */
  closeCode?: number;
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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
   * Socket buffer limit in bytes before backpressure (default: 1000000).
   *
   * When socket buffer exceeds this threshold during RPC replies,
   * the router sends an RPC_ERROR with code "RESOURCE_EXHAUSTED" instead of buffering unbounded.
   * Helps prevent memory exhaustion under high throughput.
   *
   * Set to Infinity to disable backpressure checks.
   */
  socketBufferLimitBytes?: number;

  /**
   * Default timeout in milliseconds for RPC requests (default: 30000).
   *
   * Used as default `meta.timeoutMs` if client doesn't specify one.
   * Affects `ctx.deadline` calculation on server side.
   */
  rpcTimeoutMs?: number;

  /**
   * Drop progress messages when buffer is full (default: true).
   *
   * When enabled, progress updates are silently skipped if the socket
   * buffer exceeds socketBufferLimitBytes. This prevents backpressure
   * from blocking terminal RPC responses on long-running operations.
   *
   * Terminal RPC responses (reply) are NEVER dropped regardless of this setting.
   * Set to false to queue progress messages even under backpressure.
   */
  dropProgressOnBackpressure?: boolean;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: any; // LoggerAdapter - use 'any' to avoid circular dependency

  /**
   * Maximum in-flight (non-terminal) RPC requests per socket (default: 1000).
   *
   * When a socket exceeds this limit, new RPC requests are rejected with
   * RPC_ERROR code "RESOURCE_EXHAUSTED". Helps prevent resource exhaustion from
   * misbehaving clients sending unbounded concurrent RPC requests.
   */
  maxInflightRpcsPerSocket?: number;

  /**
   * Timeout for orphaned/idle RPC cleanup in milliseconds (default: rpcTimeoutMs + 10000).
   *
   * RPC state that hasn't had activity (request or cancel) for this duration
   * is automatically cleaned up to prevent memory leaks. Useful for handling
   * client disconnects that don't fire close handler or network partitions.
   */
  rpcIdleTimeoutMs?: number;

  /**
   * Automatically send INTERNAL response when handler throws uncaught exception (default: true).
   *
   * When enabled, the router catches exceptions from handlers/middleware and sends
   * an INTERNAL response to the client. For RPC requests, this prevents
   * the client from timing out. For regular messages, it provides feedback
   * that something went wrong.
   *
   * Set to false to disable automatic error responses (error handlers still called).
   */
  autoSendErrorOnThrow?: boolean;

  /**
   * Include actual error message in INTERNAL responses (default: false).
   *
   * When true, the actual error message is sent to clients (sanitized, no stack trace).
   * When false, a generic "Internal server error" message is used instead.
   *
   * Recommended: false in production (security), true in development (debugging).
   */
  exposeErrorDetails?: boolean;

  /**
   * Warn if RPC handler completes without calling reply or error (default: true, dev-mode only).
   *
   * When enabled (default), the router logs a warning if an RPC handler finishes
   * execution without sending a terminal response (via ctx.reply() or ctx.error()).
   * This helps catch common bugs where developers forget to reply, causing client timeouts.
   *
   * Warning is only emitted in development mode (NODE_ENV !== "production").
   * For legitimate async patterns that spawn background work, set to false or ignore warnings.
   *
   * Example: setTimeout(reply) will trigger the warning since reply() happens after handler completes.
   * Workaround: Disable this warning for async patterns that intentionally defer responses.
   */
  warnIncompleteRpc?: boolean;
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

  /** Optional: Get buffered bytes for a WebSocket (for backpressure checks) */
  getBufferedBytes?(ws: ServerWebSocket): number;

  /** Optional: Platform-specific initialization */
  init?(): Promise<void>;

  /** Optional: Platform-specific cleanup */
  destroy?(): Promise<void>;
}

/**
 * Options for publishing a message via PubSub.
 *
 * Allows adapters to customize publication behavior without breaking the interface.
 * Adapters that don't support specific options simply ignore them.
 */
export interface PubSubPublishOptions {
  /** Partition key for distributed routing (adapter-specific behavior) */
  partitionKey?: string;

  /** Exclude a specific subscriber handler from receiving this message */
  excludeSubscriber?: (message: unknown) => void | Promise<void>;
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
   * Subscribers to this channel will receive the message, except for the
   * excluded handler (if specified in options).
   *
   * @param channel - Channel name
   * @param message - Message data (typically JSON-serializable)
   * @param options - Optional: partitionKey for routing, excludeSubscriber to filter
   */
  publish(
    channel: string,
    message: unknown,
    options?: PubSubPublishOptions,
  ): Promise<void>;

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

/**
 * RPC abort control message (internal protocol).
 *
 * Sent by client when AbortSignal is triggered or socket closes.
 * Informs server to cancel the RPC and trigger onCancel callbacks.
 * Not exposed to users; handled internally by the router.
 */
export interface RpcAbortWire {
  type: "RPC_ABORT";
  meta: {
    correlationId: string;
  };
}

/**
 * Discriminated union for error envelope dispatch (internal).
 *
 * Distinguishes between RPC errors (must have correlationId) and one-way errors.
 * Using a discriminated union prevents accidental creation of RPC_ERROR without correlationId
 * at the type system level, eliminating a class of runtime bugs.
 *
 * - `rpc`: Error response to an RPC request (correlationId required for client correlation)
 * - `oneway`: Fire-and-forget error (no correlation needed, clientId is optional)
 */
export type ErrorKind =
  | { kind: "rpc"; correlationId: string }
  | { kind: "oneway"; clientId?: string };

/**
 * Non-RPC error wire format (sent to client for fire-and-forget errors).
 *
 * Unified envelope structure shared with RPC_ERROR (without correlationId).
 * Ref: docs/specs/error-handling.md (Authoritative Error Code Table)
 */
export interface ErrorWire {
  type: "ERROR";
  meta: {
    timestamp: number; // Always present (server-generated)
  };
  payload: {
    code:
      | "UNAUTHENTICATED"
      | "PERMISSION_DENIED"
      | "INVALID_ARGUMENT"
      | "FAILED_PRECONDITION"
      | "NOT_FOUND"
      | "ALREADY_EXISTS"
      | "ABORTED"
      | "DEADLINE_EXCEEDED"
      | "RESOURCE_EXHAUSTED"
      | "UNAVAILABLE"
      | "UNIMPLEMENTED"
      | "INTERNAL"
      | "CANCELLED"
      | `APP_${string}`;
    message?: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}

/**
 * RPC error wire format (sent to client on RPC failure).
 *
 * Unified envelope structure (same as ERROR, with correlationId in meta).
 * Enables consistent client parsing: both ERROR and RPC_ERROR have { type, meta, payload }.
 * One-shot guarded: server ensures only one error or reply per RPC.
 *
 * Ref: docs/specs/error-handling.md (Authoritative Error Code Table)
 * Ref: docs/specs/router.md (RPC Wire Format)
 */
export interface RpcErrorWire {
  type: "RPC_ERROR";
  meta: {
    timestamp: number; // Always present (server-generated)
    correlationId: string; // Required: maps to request for client correlation
  };
  payload: {
    code:
      | "UNAUTHENTICATED"
      | "PERMISSION_DENIED"
      | "INVALID_ARGUMENT"
      | "FAILED_PRECONDITION"
      | "NOT_FOUND"
      | "ALREADY_EXISTS"
      | "ABORTED"
      | "DEADLINE_EXCEEDED"
      | "RESOURCE_EXHAUSTED"
      | "UNAVAILABLE"
      | "UNIMPLEMENTED"
      | "INTERNAL"
      | "CANCELLED"
      | `APP_${string}`;
    message?: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}
