// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { ErrorCode, WsKitError } from "./error.js";

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
 * - `ctx.topics` for topic subscriptions and management
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
   * Overloaded to provide autocomplete and type narrowing for the 13 standard
   * gRPC-aligned error codes, while still allowing custom domain-specific codes.
   *
   * @param code - Standard error code (one of 13 gRPC-aligned codes per ERROR_CODE_META)
   *               or custom domain-specific code
   * @param message - Optional human-readable error description
   * @param details - Optional error context/details (structured data safe for clients)
   * @param options - Optional retry semantics: retryable (boolean) and retryAfterMs (ms hint or null)
   *
   * @example
   * // Standard code (autocomplete available)
   * ctx.error("NOT_FOUND", "User not found", { userId: "123" });
   *
   * // Custom code (literal type preserved)
   * ctx.error("INVALID_ROOM_NAME", "Room name must be 3-50 chars");
   *
   * // Transient error with backoff hint
   * ctx.error("RESOURCE_EXHAUSTED", "Buffer full", undefined, {
   *   retryable: true,
   *   retryAfterMs: 100
   * });
   */
  error(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    options?: {
      retryable?: boolean;
      retryAfterMs?: number | null;
    },
  ): void;

  error<C extends string>(
    code: C,
    message?: string,
    details?: Record<string, unknown>,
    options?: {
      retryable?: boolean;
      retryAfterMs?: number | null;
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
   * Type-safe accessor for connection data fields.
   *
   * Provides convenient access to connection data properties with proper type inference.
   * Equivalent to `ctx.ws.data[key]` but with better IDE support and type checking.
   *
   * @param key - Property name to access from connection data
   * @returns The value of the property, or undefined if not set
   *
   * @example
   * ```typescript
   * type AppData = { userId?: string; role?: string };
   * const router = createRouter<AppData>();
   *
   * router.on(MessageSchema, (ctx) => {
   *   const userId = ctx.getData("userId");      // Type: string | undefined
   *   const role = ctx.getData("role");          // Type: string | undefined
   * });
   * ```
   */
  getData<K extends keyof TData>(key: K): TData[K];

  /**
   * Topic subscriptions and operations.
   *
   * Provides access to current subscriptions (as ReadonlySet<string>) and
   * methods to manage them (subscribe, unsubscribe, subscribeMany, etc.).
   *
   * @example
   * ```typescript
   * // Check if subscribed
   * if (ctx.topics.has("room:123")) { ... }
   *
   * // Iterate over subscriptions
   * for (const topic of ctx.topics) { ... }
   * for (const topics of [...ctx.topics]) { ... }
   *
   * // Subscribe/unsubscribe
   * await ctx.topics.subscribe("room:123");
   * await ctx.topics.unsubscribe("room:123");
   *
   * // Batch operations
   * await ctx.topics.subscribeMany(["room:1", "room:2", "room:3"]);
   * ```
   */
  topics: Topics;

  /**
   * Publish a typed message to a topic (convenience method).
   *
   * Validates the payload against the schema and broadcasts to all subscribers.
   * This is a bound passthrough to router.publish() optimized for use within handlers.
   *
   * @param topic - Topic name to publish to
   * @param schema - Message schema (validated before broadcast)
   * @param payload - Message payload (must match schema)
   * @param options - Publish options (excludeSelf, partitionKey, meta)
   * @returns Promise resolving to PublishResult with delivery information and capability
   */
  publish(
    topic: string,
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
   * Overloaded to provide autocomplete and type narrowing for the 13 standard
   * gRPC-aligned error codes, while still allowing custom domain-specific codes.
   *
   * @param code - Standard error code (one of 13 gRPC-aligned codes per ERROR_CODE_META)
   *               or custom domain-specific code
   * @param message - Optional human-readable error description
   * @param details - Optional error context/details (structured data safe for clients)
   * @param options - Optional retry semantics: retryable (boolean) and retryAfterMs (ms hint or null)
   *
   * @example
   * // Standard code (autocomplete available)
   * ctx.error("INVALID_ARGUMENT", "Invalid user ID", { field: "userId" });
   *
   * // Custom code (literal type preserved)
   * ctx.error("INVALID_ROOM_ID", "Room does not exist");
   *
   * // Send transient error with backoff
   * ctx.error("RESOURCE_EXHAUSTED", "Rate limited", undefined, {
   *   retryable: true,
   *   retryAfterMs: 100
   * });
   */
  error(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    options?: {
      retryable?: boolean;
      retryAfterMs?: number | null;
    },
  ): void;

  error<C extends string>(
    code: C,
    message?: string,
    details?: Record<string, unknown>,
    options?: {
      retryable?: boolean;
      retryAfterMs?: number | null;
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
   * Type-safe accessor for connection data fields.
   *
   * Provides convenient access to connection data properties with proper type inference.
   * Equivalent to `ctx.ws.data[key]` but with better IDE support and type checking.
   *
   * @param key - Property name to access from connection data
   * @returns The value of the property, or undefined if not set
   *
   * @example
   * ```typescript
   * type AppData = { userId?: string; role?: string };
   * const router = createRouter<AppData>();
   *
   * router.rpc(RpcSchema, (ctx) => {
   *   const userId = ctx.getData("userId");      // Type: string | undefined
   *   const role = ctx.getData("role");          // Type: string | undefined
   * });
   * ```
   */
  getData<K extends keyof TData>(key: K): TData[K];

  /**
   * Topic subscriptions and operations.
   *
   * Provides access to current subscriptions (as ReadonlySet<string>) and
   * methods to manage them (subscribe, unsubscribe, subscribeMany, etc.).
   */
  topics: Topics;

  /**
   * Publish a typed message to a topic (convenience method).
   *
   * Validates the payload against the schema and broadcasts to all subscribers.
   * This is a bound passthrough to router.publish() optimized for use within handlers.
   *
   * @param topic - Topic name to publish to
   * @param schema - Message schema (validated before broadcast)
   * @param payload - Message payload (must match schema)
   * @param options - Publish options (excludeSelf, partitionKey, meta)
   * @returns Promise resolving to PublishResult with delivery information and capability
   */
  publish(
    topic: string,
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
 * Common message context methods available to both event and RPC handlers.
 *
 * These methods are extracted as a shared interface to avoid duplication
 * across validator adapters (Zod, Valibot, etc.).
 *
 * @internal Used by validator adapters; applications use EventMessageContext or RpcMessageContext
 */
export interface MessageContextMethods<
  TData extends WebSocketData = WebSocketData,
> {
  /**
   * Type-safe accessor for connection data fields.
   *
   * Provides convenient access to connection data properties with proper type inference.
   * Equivalent to `ctx.ws.data[key]` but with better IDE support and type checking.
   *
   * @param key - Property name to access from connection data
   * @returns The value of the property, or undefined if not set
   *
   * @example
   * ```typescript
   * type AppData = { userId?: string; role?: string };
   * const router = createRouter<AppData>();
   *
   * router.on(MessageSchema, (ctx) => {
   *   const userId = ctx.getData("userId");      // Type: string | undefined
   *   const role = ctx.getData("role");          // Type: string | undefined
   * });
   * ```
   */
  getData<K extends keyof TData>(key: K): TData[K];

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
   * Topic subscriptions and operations.
   *
   * Provides access to current subscriptions (as ReadonlySet<string>) and
   * methods to manage them (subscribe, unsubscribe, subscribeMany, etc.).
   */
  topics: Topics;

  /**
   * Publish a typed message to a topic (convenience method).
   *
   * Validates the payload against the schema and broadcasts to all subscribers.
   * This is a bound passthrough to router.publish() optimized for use within handlers.
   *
   * @param topic - Topic name to publish to
   * @param schema - Message schema (validated before broadcast)
   * @param payload - Message payload (must match schema)
   * @param options - Publish options (excludeSelf, partitionKey, meta)
   * @returns Promise resolving to PublishResult with delivery information and capability
   */
  publish(
    topic: string,
    schema: MessageSchemaType,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<PublishResult>;
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
 * API changes. Currently, only `meta` is fully implemented; `excludeSelf` and `partitionKey`
 * are reserved for future distributed pubsub and sharding features.
 */
export interface PublishOptions {
  /**
   * Exclude the sender from receiving the published message (default: false).
   *
   * **Status**: Future feature. Currently unsupported; returns:
   * `{ok: false, error: "UNSUPPORTED", details: { feature: "excludeSelf" }}`
   *
   * **Planned behavior**: When true, the sender will not receive their own published message.
   * When called from within a handler context, this will filter out that specific sender.
   * Server-initiated calls (no clientId context) will not use this option.
   *
   * **Current workarounds**:
   * - Dedicated per-connection topic (e.g., "room:123" vs "room:123:self") so sender doesn't subscribe
   * - Check `meta.clientId` in subscriber handlers and skip self-originated messages
   * - Use separate handler registration for broadcast vs. self-only messages
   *
   * **Why not yet supported**: Different pubsub backends (MemoryPubSub, Redis, Kafka, DO)
   * have different capabilities for filtering at publish time.
   */
  excludeSelf?: boolean;

  /**
   * Partition key for future sharding/fanout routing (optional, advisory).
   *
   * **Advisory**: Adapters may ignore this hint. It does not guarantee partitioning behavior.
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
 * Capability hint for how well matched subscriber count is known.
 *
 * **Semantics:**
 * - `"exact"` — Exact subscriber count (e.g., MemoryPubSub, Bun native)
 * - `"estimate"` — Lower-bound estimate (e.g., Node/uWS polyfill)
 * - `"unknown"` — Subscriber count not tracked (e.g., Redis multi-process)
 */
export type PublishCapability = "exact" | "estimate" | "unknown";

/**
 * Error codes for publish() failures.
 *
 * UPPERCASE canonical codes for pattern matching and exhaustive switches.
 * Enables reliable error classification and retry logic across all adapters.
 */
export type PublishError =
  | "VALIDATION" // Schema validation failed (local)
  | "ACL" // authorizePublish hook denied
  | "STATE" // Illegal in current router/connection state
  | "BACKPRESSURE" // Adapter's send queue full
  | "PAYLOAD_TOO_LARGE" // Exceeds adapter limit
  | "UNSUPPORTED" // Option/feature not supported (e.g., excludeSelf)
  | "ADAPTER_ERROR" // Unexpected adapter failure
  | "CONNECTION_CLOSED"; // Connection/router disposed

/**
 * Retryability mapping for publish errors.
 *
 * Each error code has a canonical retryability flag. Applications can use this
 * to decide retry strategy without manual mapping.
 *
 * @internal Reference for router implementation
 */
export const PUBLISH_ERROR_RETRYABLE: Record<PublishError, boolean> = {
  VALIDATION: false, // Won't succeed on retry
  ACL: false, // Authorization won't change
  STATE: false, // Router/adapter not ready
  BACKPRESSURE: true, // Queue might clear
  PAYLOAD_TOO_LARGE: false, // Size won't change
  UNSUPPORTED: false, // Feature won't appear
  ADAPTER_ERROR: true, // Infrastructure might recover
  CONNECTION_CLOSED: true, // Retryable after reconnection
};

/**
 * Result of publishing a message to a channel/topic.
 *
 * Provides honest semantics about what was delivered, since subscriber counts
 * can vary widely across implementations (exact for in-process, estimates for
 * distributed, unknown for some adapters).
 *
 * **publish() never throws for runtime conditions**. All expected failures return
 * `{ok: false}` with an error code. This allows predictable, result-based error handling.
 *
 * **Success semantics**:
 * - `ok: true; capability: "exact"` — Exact recipient count (e.g., MemoryPubSub)
 * - `ok: true; capability: "estimate"` — Lower-bound estimate (e.g., Node/uWS)
 * - `ok: true; capability: "unknown"` — Subscriber count not tracked (matched omitted)
 *
 * **Failure semantics**:
 * - `ok: false` — Delivery failed; use `error` code and `retryable` flag to decide next action
 * - `retryable: true` — Safe to retry after backoff (e.g., BACKPRESSURE, ADAPTER_ERROR)
 * - `retryable: false` — Retrying won't help (e.g., VALIDATION, ACL, STATE)
 * - `details`: Structured context from the adapter (limits, features, diagnostics)
 * - `cause`: Underlying exception for debugging and error chaining
 */
export type PublishResult =
  | {
      ok: true;
      /** Indicates reliability of matched count: "exact" / "estimate" / "unknown" */
      capability: PublishCapability;
      /** Matched subscriber count. Semantics depend on capability. undefined if "unknown". */
      matched?: number;
    }
  | {
      ok: false;
      /** Canonical error code (UPPERCASE) for pattern matching and switches */
      error: PublishError;
      /** Whether safe to retry after backoff (true for transient, false for permanent) */
      retryable: boolean;
      /** Name of the adapter that rejected (e.g., "redis", "inmemory") */
      adapter?: string;
      /** Structured context from adapter (limits, features, diagnostics) */
      details?: Record<string, unknown>;
      /** Underlying error cause, following Error.cause conventions */
      cause?: unknown;
    };

/**
 * Topic subscription state and operations.
 *
 * Implements ReadonlySet<string> for .has(topic), .size, iteration (for...of, spread).
 * Extends with async subscription management methods.
 *
 * **Idempotency**: calling subscribe/unsubscribe multiple times for the same topic is a no-op.
 * Errors (validation, authorization, connection, limits) always throw, even on duplicate calls.
 *
 * **Batch atomicity**: `subscribeMany()` and `unsubscribeMany()` either succeed entirely or fail
 * entirely—no partial state changes.
 *
 * **Error semantics**: All operations throw `PubSubError` on failure (see spec § 7).
 *
 * See [docs/specs/pubsub.md § 3 & § 6](../../docs/specs/pubsub.md#3-public-api-surface)
 * for complete semantics and examples.
 */
export interface Topics extends ReadonlySet<string> {
  /**
   * Subscribe to a topic.
   *
   * Idempotent: subscribing twice to the same topic is a no-op (no error).
   *
   * **Throws** on validation, authorization, connection, or adapter failure.
   *
   * @param topic - Topic name to subscribe to
   * @throws {PubSubError} with code: INVALID_TOPIC, UNAUTHORIZED_SUBSCRIBE, TOPIC_LIMIT_EXCEEDED,
   *                       CONNECTION_CLOSED, or ADAPTER_ERROR
   *
   * @example
   * ```typescript
   * try {
   *   await ctx.topics.subscribe("room:123");
   * } catch (err) {
   *   if (err instanceof PubSubError) {
   *     switch (err.code) {
   *       case "UNAUTHORIZED_SUBSCRIBE":
   *         ctx.error("PERMISSION_DENIED", "You cannot access this room");
   *         break;
   *       // ... handle other codes
   *     }
   *   }
   * }
   * ```
   */
  subscribe(topic: string): Promise<void>;

  /**
   * Remove the current connection from a topic's membership.
   *
   * **Best-effort semantics** (soft no-op for benign cases):
   * - Early membership check: if not subscribed, returns successfully (no-op, no hooks).
   * - If subscribed, validates topic format, then mutates, then calls adapter.
   *
   * **Throws on:**
   * - Validation error (topic format invalid, when subscribed)
   * - Adapter failure
   *
   * **Does NOT throw on:**
   * - Not subscribed (soft no-op)
   * - Connection closed (membership irrelevant)
   * - Invalid topic when not subscribed
   *
   * **Idempotent**: calling unsubscribe twice for the same topic is a no-op (no error).
   * Hooks do not fire on no-ops.
   *
   * @param topic - Topic name to unsubscribe from
   * @throws {PubSubError} with code: INVALID_TOPIC (if subscribed and format invalid) or ADAPTER_ERROR
   *
   * @example
   * ```typescript
   * // Safe cleanup (no error even if not subscribed)
   * await ctx.topics.unsubscribe("room:123");
   *
   * // Safe in error paths
   * try {
   *   // ... handler code
   * } finally {
   *   await ctx.topics.unsubscribe("room:123"); // Won't throw
   * }
   * ```
   */
  unsubscribe(topic: string): Promise<void>;

  /**
   * Subscribe to multiple topics in one atomic operation.
   *
   * **Deduplication**: Input topics are deduplicated (treating duplicates as a single topic).
   * - Input: `["room:1", "room:1", "room:2"]` → internally processed as `{"room:1", "room:2"}`
   * - Counts reflect unique topics only
   *
   * **Atomicity**: All succeed or all fail; no partial state changes.
   * - If any topic fails validation, authorization, or quota, entire operation fails and rolls back
   *
   * **Throws** if any topic fails validation, authorization, or hits quota.
   *
   * @param topics - Iterable of topic names to subscribe to (duplicates are coalesced)
   * @returns Promise with counts:
   *   - `added`: number of newly subscribed unique topics (not already subscribed)
   *   - `total`: total unique subscriptions after operation
   *
   * @example
   * ```typescript
   * // Subscribe to 2 unique topics (input has duplicate "room:1")
   * const result = await ctx.topics.subscribeMany(["room:1", "room:1", "room:2"]);
   * // If neither subscribed before: { added: 2, total: 2 }
   * ```
   *
   * @throws {PubSubError} if any topic fails (same codes as subscribe)
   */
  subscribeMany(
    topics: Iterable<string>,
  ): Promise<{ added: number; total: number }>;

  /**
   * Unsubscribe from multiple topics atomically.
   *
   * **Deduplication**: Input topics are deduplicated (treating duplicates as a single topic).
   * - Input: `["room:1", "room:1", "room:2"]` → internally processed as `{"room:1", "room:2"}`
   * - Counts reflect unique topics only
   *
   * **Atomicity**: All succeed or all fail; no partial state changes.
   * - If any subscribed topic fails validation or adapter error, entire operation fails and rolls back
   *
   * **Best-effort semantics** (same as `unsubscribe()`):
   * - Topics not subscribed are skipped (soft no-op, no validation)
   * - For subscribed topics, validates, then mutates, then calls adapter
   * - Non-subscribed topics don't affect counts or raise errors
   *
   * @param topics - Iterable of topic names to unsubscribe from (duplicates are coalesced)
   * @returns Promise with counts:
   *   - `removed`: number of unique topics that were subscribed and now removed
   *   - `total`: remaining subscriptions after operation
   *
   * @example
   * ```typescript
   * // Unsubscribe from 2 unique topics (input has duplicate "room:1")
   * const result = await ctx.topics.unsubscribeMany(["room:1", "room:1", "room:2", "room:3"]);
   * // If room:1 and room:2 subscribed, room:3 not: { removed: 2, total: remaining }
   * // room:1 duplicate doesn't cause double-count
   * ```
   *
   * @throws {PubSubError} if any subscribed topic fails validation or adapter error occurs
   */
  unsubscribeMany(
    topics: Iterable<string>,
  ): Promise<{ removed: number; total: number }>;

  /**
   * Remove all current subscriptions.
   *
   * @returns Promise with count of removed subscriptions
   */
  clear(): Promise<{ removed: number }>;
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
 * @returns
 *   - `true` — authenticated, connection is allowed
 *   - `false` — authentication failed, close with "PERMISSION_DENIED" (legacy default)
 *   - `"UNAUTHENTICATED"` — authentication failed, close with "UNAUTHENTICATED" reason
 *   - `"PERMISSION_DENIED"` — authentication failed, close with "PERMISSION_DENIED" reason
 *   - Promise variant of any of the above
 */
export type AuthHandler<TData extends WebSocketData = WebSocketData> = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: MessageContext<any, TData>,
) =>
  | boolean
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | Promise<boolean | "UNAUTHENTICATED" | "PERMISSION_DENIED">;

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
 * Decision result from a rate limiter consume operation.
 *
 * When allowed=true, the operation proceeded.
 * When allowed=false, the operation was blocked; retryAfterMs indicates when to retry (or null if impossible).
 */
export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      remaining: number;
      retryAfterMs: number | null; // null means cost > capacity (impossible under policy)
    };

/**
 * Rate limiter policy configuration.
 *
 * Defines the token bucket parameters: capacity (max tokens) and refill rate.
 * Optional prefix isolates multiple policies sharing the same backend connection.
 */
export interface Policy {
  /** Bucket capacity (positive integer). Maximum tokens available. */
  capacity: number;

  /** Refill rate in tokens per second (positive number).
   * Token bucket uses integer arithmetic:
   * - At each consume(), elapsed seconds × tokensPerSecond tokens are added (floored)
   * - Supports rates ≥ 1 token/sec natively
   * - For sub-1 rates (e.g., 0.1 tok/sec), scale both values: tokensPerSecond: 1, capacity: 10 (represents 0.1×100)
   */
  tokensPerSecond: number;

  /** Optional prefix for key namespacing. Adapters prepend this to all rate limit keys to isolate multiple policies. */
  prefix?: string;
}

/**
 * Rate limiter interface (adapter contract).
 *
 * Each adapter owns the clock and implements atomicity appropriate to its backend:
 * - Memory: per-key FIFO mutex lock
 * - Redis: Lua script with TIME inside (atomic single operation)
 * - Durable Objects: single-threaded per shard with consistent clock
 *
 * Adapters must tolerate non-monotonic clocks (NTP adjustments);
 * clamp negative elapsed time to 0 to avoid invalid states.
 */
export interface RateLimiter {
  /**
   * Atomically consume tokens from a rate limit bucket.
   *
   * @param key - Rate limit key (e.g., "user:123")
   * @param cost - Number of tokens to consume (positive integer)
   * @returns Promise resolving to RateLimitDecision
   */
  consume(key: string, cost: number): Promise<RateLimitDecision>;

  /**
   * Get the policy configuration for this rate limiter.
   * **Required by all adapters.** Used by middleware to report accurate capacity in error responses.
   *
   * @returns Policy object with capacity, tokensPerSecond, and optional prefix
   */
  getPolicy(): Policy;

  /**
   * Optional: cleanup resources (connection, timers, etc.).
   * Called on app shutdown.
   *
   * Adapters may return a Promise for async cleanup (e.g., Redis client disconnection)
   * or void for synchronous cleanup. Both are supported.
   */
  dispose?(): void | Promise<void>;
}

/**
 * Context available before schema validation (for pre-validation middleware).
 *
 * Rate limiting and other pre-validation checks use this context. Only includes
 * parsed, trusted fields (connection metadata, app state from authenticate).
 * Prevents accidental dependencies on unvalidated payload, ensuring middleware stays
 * correct even as schema changes.
 *
 * Generic parameter TData must extend WebSocketData to preserve augmented connection data
 * and maintain type safety with connection state set during authentication (userId, roles, etc.).
 */
export interface IngressContext<TData extends WebSocketData = WebSocketData> {
  /** Message type (extracted from frame) */
  type: string;

  /** Connection ID (UUID v7) */
  id: string;

  /** Client IP address */
  ip: string;

  /** WebSocket connection with app-specific data (from authenticate) */
  ws: { data: TData };

  /** Server-controlled metadata (timestamp, etc.) */
  meta: { receivedAt: number };
}

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
 * Authentication failure policy configuration.
 *
 * Controls whether message-scope authentication/authorization errors
 * automatically close the connection or remain open for in-band error handling.
 *
 * **Default (false)**: Errors are sent as ERROR messages; connection stays open.
 * **Strict (true)**: Connection closes after sending error message (code 1008).
 *
 * Handshake-scope auth failures (during upgrade or first message guard) always
 * close with code 1008 regardless of these flags.
 */
export interface AuthFailurePolicy {
  /**
   * Close connection after sending UNAUTHENTICATED error in message scope (default: false).
   *
   * When false (default): UNAUTHENTICATED errors are sent as ERROR messages
   * and the connection remains open, allowing graceful client recovery.
   *
   * When true: Connection closes with code 1008 after sending the error,
   * enforcing a strict authentication policy at the application level.
   */
  closeOnUnauthenticated?: boolean;

  /**
   * Close connection after sending PERMISSION_DENIED error in message scope (default: false).
   *
   * When false (default): PERMISSION_DENIED errors are sent as ERROR messages
   * and the connection remains open, allowing graceful client recovery.
   *
   * When true: Connection closes with code 1008 after sending the error,
   * enforcing strict authorization at the application level.
   */
  closeOnPermissionDenied?: boolean;
}

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

  /** Authentication failure policy for message-scope errors (default: keep open) */
  auth?: AuthFailurePolicy;

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
   *
   * @deprecated Use `rpcMaxInflightPerSocket` instead (preferred for clarity among mixed options).
   */
  maxInflightRpcsPerSocket?: number;

  /**
   * Maximum in-flight (non-terminal) RPC requests per socket (default: 1000).
   *
   * When a socket exceeds this limit, new RPC requests are rejected with
   * RPC_ERROR code "RESOURCE_EXHAUSTED". Helps prevent resource exhaustion from
   * misbehaving clients sending unbounded concurrent RPC requests.
   *
   * Preferred over the legacy `maxInflightRpcsPerSocket` for clarity when mixed with
   * other unrelated options (heartbeat, auth, logging, etc.).
   */
  rpcMaxInflightPerSocket?: number;

  /**
   * Timeout for orphaned/idle RPC cleanup in milliseconds (default: rpcTimeoutMs + 10000).
   *
   * RPC state that hasn't had activity (request or cancel) for this duration
   * is automatically cleaned up to prevent memory leaks. Useful for handling
   * client disconnects that don't fire close handler or network partitions.
   */
  rpcIdleTimeoutMs?: number;

  /**
   * RPC cleanup scan cadence in milliseconds (default: 5000).
   *
   * Controls how frequently the router checks for idle RPC state and runs
   * cleanup. Lower values reduce memory from lingering idle RPCs but increase
   * CPU cost; higher values reduce CPU overhead but may accumulate more state.
   *
   * Useful for tuning in high-throughput systems. Typically left at default.
   *
   * @internal Advanced tuning; use only if profiling shows cleanup needs adjustment
   */
  rpcCleanupCadenceMs?: number;

  /**
   * RPC deduplication window in milliseconds (default: 3600000 / 1 hour).
   *
   * Controls how long the router remembers completed RPC IDs to detect duplicate
   * requests from the same client. This prevents handling the same request twice
   * if a completion message is lost and the client retries.
   *
   * Shorter values reduce memory but increase collision risk; longer values are safer
   * but consume more memory. Typically left at default for production.
   *
   * @internal Advanced tuning; adjust only if analyzing memory usage under specific workloads
   */
  rpcDedupWindowMs?: number;

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

/**
 * Public protocol for WebSocket routers.
 *
 * Any object implementing this interface can be passed to adapters.
 * Implementations include:
 * - WebSocketRouter (untyped core)
 * - TypedZodRouter (@ws-kit/zod)
 * - TypedValibotRouter (@ws-kit/valibot, future)
 * - Custom router implementations
 *
 * Uses `this` return type for fluent chaining (works for both class and factory-based routers).
 * Adapters depend on this interface, not on concrete implementations.
 *
 * @typeParam TData - Application-specific connection data
 */
export interface IWebSocketRouter<TData extends WebSocketData = WebSocketData> {
  /** Register handler for fire-and-forget messages */
  on<TSchema extends MessageSchemaType>(
    schema: TSchema,
    handler: MessageHandler<TSchema, TData>,
  ): this;

  /** Unregister handler for a message type */
  off(schema: MessageSchemaType): this;

  /** Register handler for RPC request-response messages */
  rpc<TSchema extends MessageSchemaType>(
    schema: TSchema,
    handler: RpcHandler<TSchema, TData>,
  ): this;

  /** Register topic subscription handler */
  topic<TSchema extends MessageSchemaType>(
    schema: TSchema,
    options?: { onPublish?: MessageHandler<TSchema, TData> },
  ): this;

  /** Register connection open lifecycle hook */
  onOpen(handler: OpenHandler<TData>): this;

  /** Register connection close lifecycle hook */
  onClose(handler: CloseHandler<TData>): this;

  /** Register authentication hook */
  onAuth(handler: AuthHandler<TData>): this;

  /** Register error handler */
  onError(handler: ErrorHandler<TData>): this;

  /** Register global middleware */
  use(middleware: Middleware<TData>): this;

  /** Merge handlers from another router */
  merge(router: IWebSocketRouter<TData>): this;

  /** Publish message to a channel/topic */
  publish<TSchema extends MessageSchemaType>(
    channel: string,
    schema: TSchema,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<PublishResult>;

  /**
   * Platform adapter handlers for WebSocket lifecycle events.
   *
   * Provides the core connection handling for platform integrations.
   * Call these methods from your platform's WebSocket handlers
   * (e.g., Bun.serve, Cloudflare DO, Node.js http.createServer).
   *
   * @internal - Platform adapters only
   *
   * @example
   * const { open, message, close } = router.websocket;
   * // In your platform's WebSocket handler:
   * ws.onopen = () => open(ws);
   * ws.onmessage = (msg) => message(ws, msg.data);
   * ws.onclose = (ev) => close(ws, ev.code);
   */
  readonly websocket: {
    /** Called when a WebSocket connection opens */
    open(ws: ServerWebSocket<TData>): Promise<void>;
    /** Called when a message arrives */
    message(ws: ServerWebSocket<TData>, data: string | Buffer): Promise<void>;
    /** Called when a connection closes */
    close(
      ws: ServerWebSocket<TData>,
      code: number,
      reason?: string,
    ): Promise<void>;
  };
}
