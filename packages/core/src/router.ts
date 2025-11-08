// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { DEFAULT_CONFIG, RESERVED_CONTROL_PREFIX } from "./constants.js";
import { ERROR_CODE_META, ErrorCode, WsKitError } from "./error.js";
import { normalizeInboundMessage } from "./normalize.js";
import { MemoryPubSub } from "./pubsub.js";
import { RpcManager } from "./rpc-manager.js";
import type {
  AuthHandler,
  CloseHandler,
  CloseHandlerContext,
  ErrorHandler,
  ErrorKind,
  EventHandler,
  IWebSocketRouter,
  LimitExceededHandler,
  LimitExceededInfo,
  LimitType,
  MessageContext,
  MessageHandler,
  MessageHandlerEntry,
  MessageMeta,
  MessageSchemaType,
  Middleware,
  OpenHandler,
  OpenHandlerContext,
  PlatformAdapter,
  PublishOptions,
  PublishResult,
  PubSub,
  PubSubPublishOptions,
  RpcHandler,
  SendFunction,
  ServerWebSocket,
  ValidatorAdapter,
  WebSocketData,
  WebSocketRouterOptions,
} from "./types.js";

/**
 * Internal symbol for marking publish calls that originate from within a message handler.
 * Used for handler context detection without polluting user-facing options object.
 */
const HANDLER_CONTEXT_MARKER = Symbol.for("ws-kit.handler-context");

/**
 * Heartbeat state tracking per connection.
 */
interface HeartbeatState<TData extends WebSocketData = WebSocketData> {
  pingTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  lastPongTime: number;
  ws: ServerWebSocket<TData>;
  authenticated: boolean; // Track if connection has been authenticated
}

/**
 * Testing utilities for inspecting router internal state.
 * Used only in test mode for introspection and assertions.
 */
interface TestingUtils<TData extends WebSocketData = WebSocketData> {
  /** Access to message handlers map for inspection */
  handlers: Map<string, MessageHandlerEntry<TData>>;
  /** Access to global middleware array for inspection */
  middleware: Middleware<TData>[];
  /** Access to per-route middleware map for inspection */
  routeMiddleware: Map<string, Middleware<TData>[]>;
  /** Access to heartbeat states for inspection */
  heartbeatStates: Map<string, HeartbeatState<TData>>;
  /** Access to lifecycle handlers for inspection */
  openHandlers: OpenHandler<TData>[];
  closeHandlers: CloseHandler<TData>[];
  authHandlers: AuthHandler<TData>[];
  errorHandlers: ErrorHandler<TData>[];
}

/**
 * Platform-agnostic WebSocket router for type-safe message routing with validation.
 *
 * Routes incoming messages to handlers based on message type, with support for:
 * - Pluggable validator adapters (Zod, Valibot, or custom)
 * - Pluggable platform adapters (Bun, Cloudflare DO, Node.js, etc.)
 * - Pluggable PubSub implementations (MemoryPubSub, Redis, platform-native, etc.)
 * - Lifecycle hooks (onOpen, onClose, onAuth, onError)
 * - Connection heartbeat (ping/pong with configurable intervals)
 * - Payload size limits
 *
 * **Best Practice**: For full TypeScript type inference in message handlers, use the
 * typed factory functions from validator packages:
 * - `createRouter()` from `@ws-kit/zod`
 * - `createRouter()` from `@ws-kit/valibot`
 *
 * These factories provide type-safe method signatures that preserve payload types
 * from your schema throughout the routing pipeline, eliminating the need for manual
 * type assertions in handlers.
 *
 * @template V - Validator adapter type (Zod, Valibot, etc.)
 * @template TData - Application-specific data stored with each connection
 */
export class WebSocketRouter<
  V extends ValidatorAdapter = ValidatorAdapter,
  TData extends WebSocketData = WebSocketData,
> implements IWebSocketRouter<TData>
{
  private readonly validator: V | undefined;
  private readonly validatorId: unknown | undefined; // Store validator identity for compatibility checks
  private readonly platform: PlatformAdapter | undefined;
  private pubsubInstance?: PubSub;
  private readonly pubsubProvider?: () => PubSub; // Optional provider for platform/custom pubsub

  // Handler registries
  private readonly messageHandlers = new Map<
    string,
    MessageHandlerEntry<TData>
  >();
  private readonly openHandlers: OpenHandler<TData>[] = [];
  private readonly closeHandlers: CloseHandler<TData>[] = [];
  private readonly authHandlers: AuthHandler<TData>[] = [];
  private readonly errorHandlers: ErrorHandler<TData>[] = [];
  private readonly limitExceededHandlers: LimitExceededHandler<TData>[] = [];
  private readonly middlewares: Middleware<TData>[] = [];
  private readonly routeMiddleware = new Map<string, Middleware<TData>[]>(); // Per-route middleware by message type

  // Heartbeat state
  private readonly heartbeatConfig?: {
    intervalMs: number;
    timeoutMs: number;
    onStaleConnection?: (clientId: string, ws: ServerWebSocket<TData>) => void;
  };
  private readonly heartbeatStates = new Map<string, HeartbeatState<TData>>();

  // Limits
  private readonly maxPayloadBytes: number;
  private readonly limitsConfig?: {
    onExceeded?: "send" | "close" | "custom";
    closeCode?: number;
  };
  private readonly socketBufferLimitBytes: number;
  private readonly rpcTimeoutMs: number;
  private readonly dropProgressOnBackpressure: boolean;

  // Error handling configuration
  private readonly autoSendErrorOnThrow: boolean;
  private readonly exposeErrorDetails: boolean;
  private readonly warnIncompleteRpc: boolean;

  // Auth failure policy
  private readonly authConfig?: {
    closeOnUnauthenticated?: boolean;
    closeOnPermissionDenied?: boolean;
  };

  // RPC state management (encapsulated in RpcManager)
  readonly #rpc: RpcManager;

  // Testing utilities (only available when testing mode is enabled)
  _testing?: TestingUtils<TData>;

  constructor(options: WebSocketRouterOptions<V, TData> = {}) {
    this.validator = options.validator;
    // Capture validator identity for runtime compatibility checks
    // Uses the constructor function as identity marker (works for both Zod and Valibot adapters)
    this.validatorId = this.validator?.constructor;
    this.platform = options.platform;
    if (options.auth) {
      this.authConfig = options.auth;
    }

    // Mark this instance as a ws-kit router for merge() validation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)[Symbol.for("ws-kit.router")] = true;

    // Store provided pubsub or set up lazy provider
    if (options.pubsub) {
      this.pubsubInstance = options.pubsub;
    } else if (options.platform?.pubsub) {
      this.pubsubInstance = options.platform.pubsub;
    } else {
      // Lazy provider: create MemoryPubSub only on first access
      this.pubsubProvider = () => new MemoryPubSub();
    }

    this.maxPayloadBytes =
      options.limits?.maxPayloadBytes ?? DEFAULT_CONFIG.MAX_PAYLOAD_BYTES;

    // Store limits behavior configuration
    if (options.limits) {
      this.limitsConfig = {
        onExceeded: options.limits.onExceeded ?? "send",
        ...(options.limits.closeCode !== undefined && {
          closeCode: options.limits.closeCode,
        }),
      };
    }

    // Store RPC configuration
    this.socketBufferLimitBytes =
      options.socketBufferLimitBytes ??
      DEFAULT_CONFIG.MAX_QUEUED_BYTES_PER_SOCKET;
    this.rpcTimeoutMs =
      options.rpcTimeoutMs ?? DEFAULT_CONFIG.DEFAULT_RPC_TIMEOUT_MS;

    // Store backpressure behavior (default: true = drop progress messages)
    this.dropProgressOnBackpressure =
      options.dropProgressOnBackpressure ?? true;

    // Store error handling configuration
    this.autoSendErrorOnThrow = options.autoSendErrorOnThrow ?? true;
    this.exposeErrorDetails = options.exposeErrorDetails ?? false;
    this.warnIncompleteRpc = options.warnIncompleteRpc ?? true;

    // Initialize RPC manager with configuration
    const rpcIdleTimeoutMs =
      options.rpcIdleTimeoutMs ?? this.rpcTimeoutMs + 10_000; // Default: timeout + 10s
    const rpcConfig: {
      maxInflightPerSocket?: number;
      idleTimeoutMs?: number;
      cleanupCadenceMs?: number;
      dedupWindowMs?: number;
    } = {
      // Support both new and legacy option names for backwards compatibility
      maxInflightPerSocket:
        options.rpcMaxInflightPerSocket ??
        ((options as Record<string, unknown>).maxInflightRpcsPerSocket as
          | number
          | undefined) ??
        1000,
      idleTimeoutMs: rpcIdleTimeoutMs,
    };
    if (options.rpcCleanupCadenceMs !== undefined) {
      rpcConfig.cleanupCadenceMs = options.rpcCleanupCadenceMs;
    }
    if (options.rpcDedupWindowMs !== undefined) {
      rpcConfig.dedupWindowMs = options.rpcDedupWindowMs;
    }
    this.#rpc = new RpcManager(rpcConfig);

    // Start idle RPC cleanup timer
    this.#rpc.start();

    // Store heartbeat config only if explicitly provided
    // Heartbeat is opt-in: only initialize if options.heartbeat is set
    if (options.heartbeat) {
      const heartbeatConfig: typeof this.heartbeatConfig = {
        intervalMs:
          options.heartbeat.intervalMs ?? DEFAULT_CONFIG.HEARTBEAT_INTERVAL_MS,
        timeoutMs:
          options.heartbeat.timeoutMs ?? DEFAULT_CONFIG.HEARTBEAT_TIMEOUT_MS,
      };
      if (options.heartbeat.onStaleConnection) {
        heartbeatConfig.onStaleConnection = options.heartbeat.onStaleConnection;
      }
      this.heartbeatConfig = heartbeatConfig;
    }

    // Register hooks if provided
    if (options.hooks) {
      if (options.hooks.onOpen) this.openHandlers.push(options.hooks.onOpen);
      if (options.hooks.onClose) this.closeHandlers.push(options.hooks.onClose);
      if (options.hooks.onAuth) this.authHandlers.push(options.hooks.onAuth);
      if (options.hooks.onError) this.errorHandlers.push(options.hooks.onError);
      if (options.hooks.onLimitExceeded)
        this.limitExceededHandlers.push(options.hooks.onLimitExceeded);
    }

    // Set up testing utilities if testing mode is enabled
    // This allows test code to inspect and assert on internal state without reflection
    if ((options as Record<string, unknown>).testing === true) {
      this._testing = {
        handlers: this.messageHandlers,
        middleware: this.middlewares,
        routeMiddleware: this.routeMiddleware,
        heartbeatStates: this.heartbeatStates,
        openHandlers: this.openHandlers,
        closeHandlers: this.closeHandlers,
        authHandlers: this.authHandlers,
        errorHandlers: this.errorHandlers,
      };
    }
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Public API - Handler Registration
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Register a handler for a fire-and-forget or pub/sub message.
   *
   * Use `on()` for events, notifications, and pub/sub messaging where handlers
   * don't need to produce a guaranteed response. The handler executes independently
   * without correlation, timeout, or one-shot guarantees.
   *
   * For request/response patterns, use `router.rpc()` instead, which provides:
   * - One-shot reply guarantee (multiple replies guarded)
   * - Correlation ID tracking and deadline awareness
   * - Progress streaming (`ctx.progress()`) before terminal reply
   * - Cancellation signals and timeout handling
   *
   * **Intent signaling**: Calling `router.on()` at the callsite signals to readers
   * that this is an event listener, not a request/response handler. This clarity
   * helps with code review, maintenance, and team onboarding.
   *
   * See ADR-015 for the design rationale behind separating `on()` and `rpc()`.
   *
   * @param schema - Message schema (format depends on validator adapter)
   * @param handler - Event handler function (receives EventMessageContext, no RPC methods)
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * // Event handler (no response needed)
   * const UserLoggedIn = message("USER_LOGGED_IN", { userId: z.string() });
   * router.on(UserLoggedIn, (ctx) => {
   *   router.publish("notifications", NotifyMessage, { text: "User logged in" });
   * });
   *
   * // Pub/sub handler
   * const RoomMessage = message("ROOM_MESSAGE", { text: z.string() });
   * router.on(RoomMessage, (ctx) => {
   *   router.publish(`room:${roomId}`, RoomMessage, ctx.payload);
   * });
   * ```
   */
  on<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: EventHandler<Schema, TData>,
  ): this {
    if (!this.validator) {
      throw new Error(
        "Cannot register message handler: no validator configured. " +
          "Create router with a validator adapter, e.g., " +
          "createRouter({ validator: new ZodAdapter() }) or use the factory from @ws-kit/zod.",
      );
    }

    const messageType = this.validator.getMessageType(schema);

    // Enforce reserved control prefix rule at design time
    if (messageType.startsWith(RESERVED_CONTROL_PREFIX)) {
      throw new Error(
        `Cannot register handler for message type "${messageType}": ` +
          `Message types cannot use reserved prefix "${RESERVED_CONTROL_PREFIX}". ` +
          `This prefix is reserved for internal control messages.`,
      );
    }

    if (this.messageHandlers.has(messageType)) {
      console.warn(
        `[ws] Handler for message type "${messageType}" is being overwritten.`,
      );
    }

    // Dev-mode warning: RPC schema registered with .on()?
    if (process.env.NODE_ENV !== "production") {
      if (schema && typeof schema === "object" && "response" in schema) {
        console.warn(
          `[ws] Message schema "${messageType}" has a .response field but is registered with ` +
            `router.on(). For request/response patterns with guaranteed replies, use ` +
            `router.rpc() instead. This ensures one-shot semantics, correlation tracking, ` +
            `and deadline awareness.`,
        );
      }
    }

    this.messageHandlers.set(messageType, {
      schema,
      handler: handler as MessageHandler<MessageSchemaType, TData>,
    });

    return this;
  }

  /**
   * Unregister a handler for a specific message type.
   *
   * Removes the handler registered via `on()` for the given message schema.
   * If no handler is registered for this message type, this is a no-op.
   *
   * @param schema - Message schema identifying the message type to unregister
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * const PingMessage = message("PING", { text: z.string() });
   * router.off(PingMessage);
   * ```
   */
  off<Schema extends MessageSchemaType>(schema: Schema): this {
    if (!this.validator) {
      throw new Error(
        "Cannot unregister message handler: no validator configured. " +
          "Router must be created with a validator adapter.",
      );
    }

    const messageType = this.validator.getMessageType(schema);
    this.messageHandlers.delete(messageType);

    return this;
  }

  /**
   * Register a handler for a request/response (RPC) message.
   *
   * Use `router.rpc()` for request/response patterns where the client expects
   * a guaranteed response with correlation tracking, timeout awareness, and
   * optional progress streaming.
   *
   * Handlers receive RPC-specific context methods:
   * - `ctx.reply(data)` — Terminal, one-shot reply (multiple calls guarded)
   * - `ctx.progress(data)` — Non-terminal progress updates before reply
   * - `ctx.onCancel(cb)` — Register cancellation callbacks
   * - `ctx.abortSignal` — Standard AbortSignal for cancellation
   * - `ctx.deadline` — Request timeout deadline (epoch ms)
   * - `ctx.timeRemaining()` — ms until deadline
   *
   * **Intent signaling**: Calling `router.rpc()` at the callsite immediately
   * signals to readers "this handler produces a guaranteed response." This clarity
   * is critical for code review (reviewers spot the pattern at a glance) and for
   * team onboarding (new developers see the method name and understand the contract).
   *
   * **Operational surface**: RPC handlers enforce one-shot semantics, correlation
   * tracking, and deadline awareness. Event handlers (via `router.on()`) don't.
   * The separate entry point makes this boundary explicit, preventing the common
   * mistake of "replying" to an event handler via `ctx.send()` as if it's RPC.
   *
   * For fire-and-forget or pub/sub patterns, use `router.on()` instead.
   * See ADR-015 for the design rationale behind separating `on()` and `rpc()`.
   *
   * @param schema - RPC message schema (must have `.response` field)
   * @param handler - RPC handler function receiving RpcMessageContext (must call ctx.reply() or ctx.error())
   * @returns This router for method chaining
   * @throws If schema does not have a `.response` field
   *
   * @example
   * ```typescript
   * // Simple RPC with guaranteed reply
   * const GetUser = rpc(
   *   "GET_USER",
   *   { id: z.string() },
   *   "USER_RESPONSE",
   *   { user: UserSchema }
   * );
   *
   * router.rpc(GetUser, async (ctx) => {
   *   const user = await db.users.findById(ctx.payload.id);
   *   if (!user) {
   *     ctx.error("NOT_FOUND", "User not found");
   *     return;
   *   }
   *   ctx.reply(GetUser.response, { user });  // One-shot, guaranteed reply
   * });
   *
   * // RPC with progress streaming
   * const LongQuery = rpc(
   *   "LONG_QUERY",
   *   { query: z.string() },
   *   "QUERY_RESPONSE",
   *   { result: z.any() }
   * );
   *
   * router.rpc(LongQuery, async (ctx) => {
   *   for (const item of largeDataset) {
   *     ctx.progress({ processed: item.count });
   *     // Progress updates are non-terminal; client sees them but waits for reply
   *   }
   *   ctx.reply(LongQuery.response, { result: finalResult });  // Terminal reply
   * });
   * ```
   */
  rpc<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: RpcHandler<Schema, TData>,
  ): this {
    // Enforce that schema has a response field (RPC semantics)
    if (!schema || typeof schema !== "object" || !("response" in schema)) {
      throw new Error(
        "Cannot register RPC handler: schema must have a .response field. " +
          "Use the rpc() helper to create RPC schemas, or add .response to your schema. " +
          "For fire-and-forget messaging, use router.on() instead.",
      );
    }

    // Delegate to on() for actual registration
    // The RpcManager will handle one-shot reply guarantee, correlation tracking, and deadlines
    // Type assertion is safe here: the runtime handler dispatcher in _dispatch()
    // already handles both EventHandler and RpcHandler based on schema.response presence
    return this.on(schema, handler as unknown as EventHandler<Schema, TData>);
  }

  /**
   * Register a handler for a topic (pub/sub) message.
   *
   * Sugar method over `.on()` for messages that are typically published to channels.
   * Optional handler executes when message is published, but isn't required.
   *
   * @param schema - Topic message schema
   * @param options - Optional configuration (onPublish handler)
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * const RoomUpdate = message("ROOM_UPDATE", { text: z.string() });
   *
   * router.topic(RoomUpdate, {
   *   onPublish: (ctx) => {
   *     // Executed when message is published via router.publish()
   *     console.log(`Room updated: ${ctx.payload.text}`);
   *   },
   * });
   *
   * // Later: broadcast to subscribers
   * router.publish("room:123", RoomMessage, { text: "Hello all" });
   * ```
   */
  topic<Schema extends MessageSchemaType>(
    schema: Schema,
    options?: { onPublish?: MessageHandler<Schema, TData> },
  ): this {
    // Register handler if provided
    if (options?.onPublish) {
      // Type assertion is safe: both EventHandler and RpcHandler are supported at runtime
      return this.on(schema, options.onPublish as EventHandler<Schema, TData>);
    }

    // No-op if no handler provided (schema is just registered as a type)
    return this;
  }

  /**
   * Register a handler for WebSocket open events.
   *
   * Called when a client connects, before authentication validation.
   * Multiple handlers can be registered and execute in order.
   *
   * Authentication is enforced per-message via middleware, not at connection time.
   * Use global middleware if you need to block unauthenticated connections entirely.
   *
   * @param handler - Handler function
   * @returns This router for method chaining
   */
  onOpen(handler: OpenHandler<TData>): this {
    this.openHandlers.push(handler);
    return this;
  }

  /**
   * Register a handler for WebSocket close events.
   *
   * Called when a client disconnects. Multiple handlers can be registered
   * and execute in order. This is the primary place for cleanup logic.
   *
   * @param handler - Handler function
   * @returns This router for method chaining
   */
  onClose(handler: CloseHandler<TData>): this {
    this.closeHandlers.push(handler);
    return this;
  }

  /**
   * Register a handler for authentication.
   *
   * Called on connection open before any other handlers.
   * If any auth handler returns false, the connection is rejected.
   *
   * @param handler - Handler that returns true to allow connection
   * @returns This router for method chaining
   */
  onAuth(handler: AuthHandler<TData>): this {
    this.authHandlers.push(handler);
    return this;
  }

  /**
   * Register a handler for error events.
   *
   * Called when an error occurs during message processing.
   * Errors don't close the connection automatically.
   *
   * @param handler - Handler function
   * @returns This router for method chaining
   */
  onError(handler: ErrorHandler<TData>): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /**
   * Register global middleware for all messages.
   *
   * Middleware executes before message handlers in registration order.
   * Each middleware receives a `next()` function to proceed to the next
   * middleware or handler. Middleware can return early to skip the handler.
   *
   * @param middleware - Middleware function
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * // Global authentication middleware
   * router.use((ctx, next) => {
   *   if (!ctx.ws.data?.userId) {
   *     ctx.error("UNAUTHENTICATED", "Not authenticated");
   *     return; // Skip handler
   *   }
   *   return next(); // Proceed to handler
   * });
   *
   * // Logging middleware with async support
   * router.use(async (ctx, next) => {
   *   const start = performance.now();
   *   await next(); // Wait for handler
   *   const duration = performance.now() - start;
   *   console.log(`[${ctx.type}] ${duration}ms`);
   * });
   * ```
   */
  use(middleware: Middleware<TData>): this;

  /**
   * Register per-route middleware for a specific message type.
   *
   * Runs only for messages matching the given schema, after global middleware.
   *
   * @param schema - Message schema (identifies the message type)
   * @param middleware - Middleware function to run for this message type
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * const RateLimiter = new Map<string, number[]>();
   *
   * // Rate limiting for SendMessage only
   * router.use(SendMessage, (ctx, next) => {
   *   const userId = ctx.ws.data?.userId || "anon";
   *   const now = Date.now();
   *   const timestamps = RateLimiter.get(userId) || [];
   *   const recent = timestamps.filter((t) => now - t < 1000);
   *
   *   if (recent.length > 10) {
   *     ctx.error("RESOURCE_EXHAUSTED", "Max 10 messages per second");
   *     return;
   *   }
   *
   *   recent.push(now);
   *   RateLimiter.set(userId, recent);
   *   return next();
   * });
   *
   * router.on(SendMessage, (ctx) => {
   *   // This handler only runs if rate limit middleware calls next()
   *   console.log("Message:", ctx.payload);
   * });
   * ```
   */
  use<Schema extends MessageSchemaType>(
    schema: Schema,
    middleware: Middleware<TData>,
  ): this;

  use<Schema extends MessageSchemaType>(
    schemaOrMiddleware: Schema | Middleware<TData>,
    middleware?: Middleware<TData>,
  ): this {
    // If only one argument, it's global middleware
    if (middleware === undefined) {
      this.middlewares.push(schemaOrMiddleware as Middleware<TData>);
      return this;
    }

    // If two arguments, it's per-route middleware
    if (!this.validator) {
      throw new Error(
        "Cannot register per-route middleware: no validator configured. " +
          "Router must be created with a validator adapter.",
      );
    }

    // Validate schema compatibility (runtime validator check)
    const schema = schemaOrMiddleware as MessageSchemaType;
    const schemaValidatorId = (
      schema as unknown as { __wsKitValidatorId?: unknown }
    )?.__wsKitValidatorId;
    if (schemaValidatorId && schemaValidatorId !== this.validatorId) {
      console.error(
        `[ws] Per-route middleware schema uses incompatible validator. ` +
          `Expected validator from same family as router, but got different validator instance.`,
      );
      return this;
    }

    const messageType = this.validator.getMessageType(schema);
    const routeMiddlewareList = this.routeMiddleware.get(messageType) || [];
    routeMiddlewareList.push(middleware);
    this.routeMiddleware.set(messageType, routeMiddlewareList);
    return this;
  }

  /**
   * Clear all registered handlers, middleware, and state.
   *
   * Useful for resetting the router in tests without creating a new instance.
   * Preserves configuration like validator, platform adapter, and limits.
   * Does NOT reset heartbeat states for active connections.
   *
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * let router: WebSocketRouter;
   *
   * beforeEach(() => {
   *   if (!router) {
   *     router = createRouter();
   *   } else {
   *     router.reset(); // Reuse same instance, clear state
   *   }
   * });
   * ```
   */
  reset(): this {
    this.messageHandlers.clear();
    this.middlewares.length = 0;
    this.routeMiddleware.clear();
    this.openHandlers.length = 0;
    this.closeHandlers.length = 0;
    this.authHandlers.length = 0;
    this.errorHandlers.length = 0;
    // NOTE: RPC state is managed by RpcManager and not cleared on reset
    // NOTE: intentionally preserve heartbeatStates for active connections
    return this;
  }

  /**
   * @internal Testing only - Configure RPC manager for integration tests.
   *
   * Provides safe access to RPC manager configuration for tests that need
   * different cleanup timing than production defaults (e.g., shorter dedup window for
   * faster test execution).
   *
   * @example
   * ```typescript
   * const rpc = router._testingConfigureRpc();
   * rpc.setDedupWindow(100); // Override dedup window to 100ms for fast test cleanup
   * ```
   */
  _testingConfigureRpc(): {
    setDedupWindow(dedupWindowMs: number): void;
  } {
    return {
      setDedupWindow: (dedupWindowMs: number) => {
        this.#rpc.setDedupWindow(dedupWindowMs);
      },
    };
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Public API - Router Composition & Publishing
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Get all registered message routes.
   *
   * Returns a read-only view of the router's message handlers and their associated
   * per-route middleware. Useful for introspection and composability.
   *
   * @returns Array of route entries with messageType, handler, and middleware
   *
   * @example
   * ```typescript
   * const routes = router.routes();
   * for (const route of routes) {
   *   console.log(`Route: ${route.messageType}, Middleware: ${route.middleware.length}`);
   * }
   * ```
   */
  routes(): readonly {
    messageType: string;
    handler: MessageHandlerEntry<TData>;
    middleware: readonly Middleware<TData>[];
  }[] {
    const result: {
      messageType: string;
      handler: MessageHandlerEntry<TData>;
      middleware: Middleware<TData>[];
    }[] = [];

    for (const [messageType, handler] of this.messageHandlers) {
      result.push({
        messageType,
        handler,
        middleware: [...(this.routeMiddleware.get(messageType) || [])],
      });
    }

    return result;
  }

  /**
   * Merge message handlers from another router into this one.
   *
   * Useful for composing routers from different modules/features.
   * Merges handlers, lifecycle hooks, global middleware, and per-route middleware.
   * Last-write-wins for duplicate message types.
   *
   * @param router - A WebSocketRouter instance (from @ws-kit/core, @ws-kit/zod, or @ws-kit/valibot)
   * @returns This router for method chaining
   * @throws TypeError if the router is not a ws-kit router
   *
   * @example
   * ```typescript
   * import { createRouter } from "@ws-kit/zod";
   *
   * const authRouter = createRouter();
   * authRouter.on(LoginSchema, handleLogin);
   *
   * const chatRouter = createRouter();
   * chatRouter.on(MessageSchema, handleMessage);
   *
   * const mainRouter = createRouter({
   *   platform: createBunAdapter(),
   * })
   *   .merge(authRouter)
   *   .merge(chatRouter);
   * ```
   */
  merge(router: IWebSocketRouter<TData>): this {
    // **Design**: Route composition via merge enables modular router setup.
    // Routers can be initialized independently (each with its own handlers),
    // then merged into a primary router for unified serving. This supports
    // patterns like splitting auth/chat/game routes across modules.
    //
    // Type parameter note: ValidatorAdapter allows any validator (Zod, Valibot, etc.)
    // since merge only accesses handler structures, not validator-specific logic.
    //
    // **Gotcha**: Merging routers with different validators (e.g., Zod + Valibot)
    // is allowed at the type level but will cause runtime validation errors when
    // messages matching the merged handlers are processed. Keep validators consistent
    // across all routers in a merge chain. Use `createRouter()` from the same package
    // (@ws-kit/zod or @ws-kit/valibot) for all routers you plan to merge.

    // Access private members through type assertion for composability
    interface AccessibleRouter {
      messageHandlers: Map<string, MessageHandlerEntry<TData>>;
      openHandlers: OpenHandler<TData>[];
      closeHandlers: CloseHandler<TData>[];
      authHandlers: AuthHandler<TData>[];
      errorHandlers: ErrorHandler<TData>[];
      middlewares: Middleware<TData>[];
      routeMiddleware: Map<string, Middleware<TData>[]>;
    }

    // Unwrap router facade if needed (e.g., TypedZodRouter, TypedValibotRouter)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coreToAdd = (router as any)[Symbol.for("ws-kit.core")] ?? router;

    // Validate that the router is compatible by checking for ws-kit router marker
    const isValidRouter =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((coreToAdd as any)[Symbol.for("ws-kit.router")] ?? false) === true;

    if (!isValidRouter) {
      throw new TypeError(
        "Cannot merge router: expected a router from @ws-kit/zod, " +
          "@ws-kit/valibot, or a WebSocketRouter instance",
      );
    }

    // SAFETY: Router internals are intentionally accessible for testing
    const other = coreToAdd as unknown as AccessibleRouter;

    // Merge message handlers
    if (other.messageHandlers) {
      other.messageHandlers.forEach((value, key) => {
        this.messageHandlers.set(key, value);
      });
    }

    // Merge open handlers
    if (other.openHandlers) {
      this.openHandlers.push(...other.openHandlers);
    }

    // Merge close handlers
    if (other.closeHandlers) {
      this.closeHandlers.push(...other.closeHandlers);
    }

    // Merge auth handlers
    if (other.authHandlers) {
      this.authHandlers.push(...other.authHandlers);
    }

    // Merge error handlers
    if (other.errorHandlers) {
      this.errorHandlers.push(...other.errorHandlers);
    }

    // Merge global middleware
    if (other.middlewares) {
      this.middlewares.push(...other.middlewares);
    }

    // Merge per-route middleware
    if (other.routeMiddleware) {
      other.routeMiddleware.forEach((middlewares, messageType) => {
        const existing = this.routeMiddleware.get(messageType) || [];
        this.routeMiddleware.set(messageType, [...existing, ...middlewares]);
      });
    }

    return this;
  }

  /**
   * Get PubSub instance, lazily initializing if needed.
   *
   * If no pubsub was provided in options, creates a MemoryPubSub on first access.
   * This allows zero overhead for apps that don't use broadcasting.
   *
   * @returns PubSub instance
   * @private
   */
  get pubsub(): PubSub {
    if (!this.pubsubInstance) {
      if (this.pubsubProvider) {
        this.pubsubInstance = this.pubsubProvider();
      } else {
        // Fallback: should not happen with current implementation
        this.pubsubInstance = new MemoryPubSub();
      }
    }
    return this.pubsubInstance;
  }

  /**
   * Publish a typed message to a channel (broadcasts to all subscribers).
   *
   * **Design** (ADR-019): Single canonical publishing entry point. Validates the payload
   * against the schema before publishing. Returns Promise<PublishResult> for testing/metrics.
   *
   * **Type Safety**: Payload is validated against schema. Invalid payloads return
   * `{ ok: false }` and log errors; valid payloads are broadcast to all subscribers on the topic.
   * This ensures that subscribers always receive well-formed messages.
   *
   * **Validation Semantics**: Reuses the same schema validation as `ctx.send()` to maintain
   * consistency across send/reply/publish APIs. The message is constructed and validated
   * before being handed to the PubSub layer, ensuring validation is always enforced
   * (no way to bypass via raw pubsub calls).
   *
   * **Metadata Handling**:
   * - `timestamp` is auto-injected (producer time, useful for UI display)
   * - `clientId` is NEVER injected (connection identity, not broadcast metadata)
   * - Custom meta from `options.meta` is merged in
   * - Payload is kept separate from meta (schema validation is strict)
   *
   * **Security Warning for RPC Handlers**: Do NOT call this to send RPC responses.
   * Always use `ctx.reply()` for RPC responses, which ensures unicast delivery
   * to the caller only, preventing accidental data leakage.
   *
   * **Authorization Model**: Use subscription routing rules and topic namespaces to
   * control who receives published messages. This method does not perform authorization
   * checks; that's delegated to subscription guards (who can subscribe to what topics).
   * See docs/specs/broadcasting.md for auth patterns.
   *
   * **Return Value**: Returns `Promise<PublishResult>` with success status and subscriber match info.
   * - On success: `{ ok: true, capability, matched?: number }` indicates matched subscriber count
   * - On failure: `{ ok: false, reason, error }` with details (validation, adapter, etc.)
   * - Useful for testing (assert specific fan-out count)
   * - Useful for metrics/observability (track broadcast scope)
   *
   * **Scope** depends on PubSub implementation:
   * - MemoryPubSub: This process instance only
   * - BunPubSub: Load-balanced cluster (all instances)
   * - DurablePubSub: This DO instance only
   * - RedisPubSub: Multiple instances via Redis
   *
   * **Options** (PublishOptions):
   * - `excludeSelf`: Future feature for suppressing sender echo (default: false)
   * - `partitionKey`: Future feature for sharding in distributed systems
   * - `meta`: Custom metadata to include alongside auto-injected timestamp
   *
   * @param channel - Channel/topic name (e.g., "room:123", "user:456", "system:alerts")
   * @param schema - Message schema (used for validation, identifies message type)
   * @param payload - Message payload (must match schema; validated)
   * @param options - Publish options (excludeSelf, partitionKey, meta)
   * @returns Promise<PublishResult> - Resolves to publish result with subscriber match info
   *
   * @example
   * ```typescript
   * // From handler (use ctx.publish() for ergonomics)
   * router.on(UserCreated, async (ctx) => {
   *   const user = await db.create(ctx.payload);
   *   const result = await ctx.publish(
   *     `org:${ctx.payload.orgId}:users`,
   *     UserListInvalidated,
   *     { orgId: ctx.payload.orgId }
   *   );
   *   if (result.ok && result.matched !== undefined) {
   *     console.log(`Notified ${result.matched} subscribers`);
   *   }
   * });
   * ```
   *
   * ```typescript
   * // Outside handlers (cron, queue, lifecycle)
   * const result = await router.publish(
   *   "system:announcements",
   *   System.Announcement,
   *   { text: "Server maintenance at 02:00 UTC" }
   * );
   * if (result.ok) {
   *   console.log("Announcement published");
   * }
   * ```
   */
  async publish(
    channel: string,
    schema: MessageSchemaType,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<PublishResult> {
    try {
      if (!this.validator) {
        return {
          ok: false,
          reason: "adapter_error",
          error:
            "No validator configured. Router must be created with a validator adapter.",
        };
      }

      // Extract message type from schema
      const messageType = this.validator.getMessageType(schema);

      // Build metadata with auto-injected fields
      // INVARIANT: clientId is NEVER injected here (connection identity ≠ broadcast metadata)
      const messageMetadata: Record<string, unknown> = {
        timestamp: Date.now(),
        ...options?.meta,
      };

      // Create message object with required structure
      // Schema validation is strict, so payload is separate from meta
      const message = {
        type: messageType,
        meta: messageMetadata,
        ...(payload !== undefined && { payload }),
      };

      // Validate constructed message
      // This ensures all published messages conform to their schema
      const validationResult = this.validator.safeParse(schema, message);

      if (!validationResult.success) {
        return {
          ok: false,
          reason: "validation",
          error: `Validation error for message type "${messageType}"`,
        };
      }

      // Prepare PubSub options
      const pubsubOptions: PubSubPublishOptions = {};
      if (options?.partitionKey) {
        pubsubOptions.partitionKey = options.partitionKey;
      }

      // Reject excludeSelf unconditionally until pubsub layer can actually filter the sender.
      // This prevents devs from trusting a flag that currently does nothing, regardless of call site.
      // (Rejecting only for ctx.publish would create a silent no-op if router.publish() is called directly.)
      if (options?.excludeSelf) {
        throw new Error(
          "[ws] publish({ excludeSelf: true }) is not yet supported. " +
            "Sender filtering requires pubsub adapter support. " +
            "Workarounds: use dedicated channels per connection or check message origin in subscriber handlers.",
        );
      }

      // Publish validated message to pubsub
      // At this point, message is guaranteed to match schema
      await this.pubsub.publish(channel, validationResult.data, pubsubOptions);

      // Determine capability and return appropriate result
      let capability: "exact" | "estimate" | "unknown" = "unknown";
      let matched: number | undefined;

      // Check if pubsub supports subscriber counting (e.g., MemoryPubSub)
      // MemoryPubSub has a subscriberCount method for testing/metrics
      const memoryPubSub = this.pubsub as MemoryPubSub | undefined;
      if (memoryPubSub && typeof memoryPubSub.subscriberCount === "function") {
        const count = memoryPubSub.subscriberCount(channel);
        capability = "exact";
        // Report count only if excludeSelf is not used (since we can't exclude the sender yet).
        // Note: excludeSelf is rejected unconditionally above, so this code is defensive.
        // When excludeSelf is implemented, check HANDLER_CONTEXT_MARKER to determine sender.
        if (!options?.excludeSelf) {
          matched = count;
        }
      }

      return {
        ok: true,
        capability,
        ...(matched !== undefined && { matched }),
      };
    } catch (error) {
      console.error(
        `[ws] Error publishing message to channel "${channel}":`,
        error,
      );
      return {
        ok: false,
        reason: "adapter_error",
        error,
      };
    }
  }

  /**
   * Get websocket handler object for testing and direct platform integration.
   *
   * Returns handlers that can be used with Bun.serve() websocket option.
   * Primarily useful for testing and advanced platform integrations.
   *
   * @returns WebSocket handler object with message, open, close methods
   * @internal - Primarily for testing and platform adapters
   */
  get websocket() {
    return {
      message: async (ws: ServerWebSocket<TData>, message: string | Buffer) => {
        try {
          await this.handleMessage(ws, message);
        } catch (error) {
          this.callErrorHandlers(
            error instanceof Error ? error : new Error(String(error)),
            this.createMessageContext(
              ws,
              "",
              ws.data.clientId,
              Date.now(),
              this.createSendFunction(ws),
            ),
          );
        }
      },
      open: async (ws: ServerWebSocket<TData>) => {
        try {
          await this.handleOpen(ws);
        } catch (error) {
          this.callErrorHandlers(
            error instanceof Error ? error : new Error(String(error)),
            this.createMessageContext(
              ws,
              "",
              ws.data.clientId,
              Date.now(),
              this.createSendFunction(ws),
            ),
          );
        }
      },
      close: async (
        ws: ServerWebSocket<TData>,
        code: number,
        reason?: string,
      ) => {
        try {
          await this.handleClose(ws, code, reason);
        } catch (error) {
          this.callErrorHandlers(
            error instanceof Error ? error : new Error(String(error)),
            this.createMessageContext(
              ws,
              "",
              ws.data.clientId,
              Date.now(),
              this.createSendFunction(ws),
            ),
          );
        }
      },
    };
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Platform Adapter Integration - These are called by platform adapters
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Handle WebSocket open event.
   *
   * Called by platform adapters when a client connects.
   * Triggers authentication, then heartbeat and open handlers.
   *
   * @param ws - ServerWebSocket instance from platform
   */
  async handleOpen(ws: ServerWebSocket<TData>): Promise<void> {
    const clientId = ws.data.clientId;
    console.log(`[ws] Connection opened: ${clientId}`);

    const heartbeat = this.heartbeatStates.get(clientId);
    if (!heartbeat) {
      // Initialize heartbeat state
      this.heartbeatStates.set(clientId, {
        pingTimer: null,
        pongTimer: null,
        lastPongTime: Date.now(),
        ws,
        authenticated: false,
      });
    }

    const send = this.createSendFunction(ws);

    // Execute open handlers (after heartbeat initialized, before auth)
    // Open handlers run BEFORE auth by design - this allows clients to send
    // authentication messages (e.g., via message handlers) rather than being forced
    // to authenticate synchronously. Auth is enforced per-message via middleware.
    for (const handler of this.openHandlers) {
      try {
        const context: OpenHandlerContext<TData> = { ws, send };
        const result = handler(context);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        this.callErrorHandlers(
          error instanceof Error ? error : new Error(String(error)),
          this.createMessageContext(ws, "", clientId, Date.now(), send),
        );
      }
    }

    // Start heartbeat if configured
    if (this.heartbeatConfig) {
      this.startHeartbeat(clientId, ws);
    }
  }

  /**
   * Handle WebSocket close event.
   *
   * Called by platform adapters when a client disconnects.
   *
   * @param ws - ServerWebSocket instance
   * @param code - WebSocket close code
   * @param reason - Optional close reason
   */
  async handleClose(
    ws: ServerWebSocket<TData>,
    code: number,
    reason?: string,
  ): Promise<void> {
    const clientId = ws.data.clientId;
    console.log(
      `[ws] Connection closed: ${clientId} (Code: ${code}, Reason: ${reason || "N/A"})`,
    );

    // Stop heartbeat
    this.stopHeartbeat(clientId);

    // Cancel all in-flight RPCs for this connection (per-socket)
    // This triggers onCancel callbacks for cleanup
    this.#rpc.onDisconnect(clientId);

    const send = this.createSendFunction(ws);

    // Execute close handlers
    for (const handler of this.closeHandlers) {
      try {
        const context: CloseHandlerContext<TData> = { ws, code, send };
        if (reason) {
          context.reason = reason;
        }
        const result = handler(context);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`[ws] Error in close handler for ${clientId}:`, error);
      }
    }
  }

  /**
   * Handle WebSocket message.
   *
   * Called by platform adapters when a message arrives.
   * Implements the full message processing pipeline:
   * 1. Payload size check
   * 2. JSON parsing
   * 3. Auth check (first message only)
   * 4. Normalization
   * 5. Schema validation
   * 6. Handler dispatch
   *
   * @param ws - ServerWebSocket instance
   * @param message - Raw message data (string or Buffer)
   */
  async handleMessage(
    ws: ServerWebSocket<TData>,
    message: string | Buffer,
  ): Promise<void> {
    const clientId = ws.data.clientId;
    const receivedAt = Date.now();
    const send = this.createSendFunction(ws);

    // Reset heartbeat pong timeout on message received
    this.handlePong(clientId);

    try {
      // Step 1: Payload size check (before parsing)
      this.checkPayloadSize(message);

      // Step 2: JSON parsing
      let parsedMessage: unknown;
      try {
        if (typeof message === "string") {
          parsedMessage = JSON.parse(message);
        } else if (message instanceof Buffer) {
          parsedMessage = JSON.parse(message.toString());
        } else {
          console.warn(
            `[ws] Received non-string/buffer message from ${clientId}`,
          );
          return;
        }
      } catch (parseError) {
        console.error(
          `[ws] Failed to parse message from ${clientId}:`,
          parseError,
        );
        return;
      }

      // Step 3: Basic structure validation
      if (
        typeof parsedMessage !== "object" ||
        parsedMessage === null ||
        typeof (parsedMessage as { type: unknown }).type !== "string"
      ) {
        console.warn(
          `[ws] Received invalid message format from ${clientId}:`,
          parsedMessage,
        );
        return;
      }

      const messageType = (parsedMessage as { type: string }).type;

      // Step 3.5: Handle reserved control frames (internal $ws:* messages)
      if (messageType.startsWith(RESERVED_CONTROL_PREFIX)) {
        // Log all control messages for observability
        console.debug(`[ws] Control message: ${messageType}`);

        // Handle specific control messages
        if (messageType === "$ws:abort") {
          const msg = parsedMessage as Record<string, unknown>;
          const correlationId = (msg.meta as Record<string, unknown>)
            ?.correlationId;
          if (typeof correlationId === "string") {
            console.debug(
              `[ws] RPC abort received for correlation ${correlationId}`,
            );
            this.#rpc.onAbort(clientId, correlationId);
          }
        }
        // Ignore unknown control messages, don't dispatch to handlers
        return;
      }

      // Step 3.6: Assert user message types don't use reserved prefix
      if (messageType.startsWith(RESERVED_CONTROL_PREFIX)) {
        console.error(
          `[ws] User message type "${messageType}" uses reserved prefix "${RESERVED_CONTROL_PREFIX}"`,
        );
        return;
      }

      // Step 4: Authentication check (first message only)
      const heartbeat = this.heartbeatStates.get(clientId);
      if (heartbeat && !heartbeat.authenticated) {
        const authResult = await this.authenticateConnection(
          ws,
          send,
          receivedAt,
        );
        if (!authResult.ok) {
          console.warn(`[ws] Authentication failed for ${clientId}`);
          // Close with RFC 6455 Policy Violation (1008), not custom code (4403).
          // Rationale: Standard close codes ensure compatibility with client libraries, proxies, and logs.
          // See docs/specs/error-handling.md#auto-close-behavior for the canonical mapping.
          // Note: Auth is enforced on FIRST MESSAGE (not handshake), by design—client upgrades first, then auth.
          // Reason defaults to "PERMISSION_DENIED" for backward compatibility if not specified.
          const closeReason = authResult.reason ?? "PERMISSION_DENIED";
          ws.close(1008, closeReason);
          return;
        }
        heartbeat.authenticated = true;
      }

      // Step 5: Normalization (strip reserved keys)
      const normalized = normalizeInboundMessage(parsedMessage);

      // Step 6: Schema validation (BEFORE injecting server-controlled fields)
      // This ensures the schema can be strict and reject client-provided reserved keys
      const handlerEntry = this.messageHandlers.get(messageType);

      if (!handlerEntry) {
        console.warn(
          `[ws] No handler found for message type "${messageType}" from ${clientId}`,
        );
        return;
      }

      if (!this.validator) {
        console.warn(
          `[ws] No validator configured. Cannot validate message type "${messageType}"`,
        );
        return;
      }

      const validationResult = this.validator.safeParse(
        handlerEntry.schema,
        normalized,
      );

      if (!validationResult.success) {
        console.error(
          `[ws] Message validation failed for type "${messageType}" from ${clientId}:`,
          validationResult.error,
        );

        // Check if this is an RPC request (would have .response property if registered as RPC)
        const isRpcMessage =
          handlerEntry.schema &&
          typeof handlerEntry.schema === "object" &&
          "response" in handlerEntry.schema;

        if (isRpcMessage) {
          // Extract correlationId for RPC error handling
          const msgCorrelationId = (normalized.meta as Record<string, unknown>)
            ?.correlationId;
          const trimmedCorrelationId =
            typeof msgCorrelationId === "string"
              ? msgCorrelationId.trim()
              : undefined;

          // Enforce correlationId presence for RPC (RFC: INVALID_ARGUMENT if missing)
          // If RPC message lacks valid correlationId, send ERROR (not RPC_ERROR)
          // since we can't correlate the error back to the request
          if (!trimmedCorrelationId) {
            this.sendErrorEnvelope(
              ws,
              ErrorCode.INVALID_ARGUMENT,
              "RPC request requires non-empty meta.correlationId",
              undefined,
              {
                errorKind: { kind: "oneway", clientId },
              },
            );
          } else {
            // Send RPC_ERROR for validation failure (socket stays open)
            this.sendErrorEnvelope(
              ws,
              ErrorCode.INVALID_ARGUMENT,
              "Request validation failed",
              undefined,
              {
                errorKind: { kind: "rpc", correlationId: trimmedCorrelationId },
              },
            );
          }
        }
        // For non-RPC, just silently drop (existing behavior)
        return;
      }

      // Step 7: Inject server-controlled metadata (AFTER validation)
      // This ensures the metadata is trusted and not subject to client spoofing
      const validatedData = validationResult.data;
      if (!validatedData.meta || typeof validatedData.meta !== "object") {
        validatedData.meta = {};
      }
      const meta = validatedData.meta as Record<string, unknown>;
      meta.clientId = clientId;
      meta.receivedAt = receivedAt;

      // Step 8: Pre-compute RPC detection for use in closures
      // Detect RPC (check if schema has .response property)
      const isRpc =
        handlerEntry.schema &&
        typeof handlerEntry.schema === "object" &&
        "response" in handlerEntry.schema;

      // Step 9: Handler dispatch with middleware pipeline
      // Create error sending function for type-safe error responses
      const errorSend = (
        code: string,
        message: string,
        details?: Record<string, unknown>,
        options?: {
          retryable?: boolean;
          retryAfterMs?: number | null;
        },
      ) => {
        try {
          if (!this.validator) {
            throw new Error(
              "Cannot send error: no validator configured. " +
                "Router must be created with a validator adapter.",
            );
          }

          // Construct errorKind discriminated union
          let errorKind: ErrorKind;
          if (isRpc) {
            // For RPC: extract and validate correlationId
            const rpcCorrelationId = (
              validatedData.meta as Record<string, unknown>
            )?.correlationId;
            const trimmedCorrelationId =
              typeof rpcCorrelationId === "string"
                ? rpcCorrelationId.trim()
                : undefined;

            if (!trimmedCorrelationId) {
              // No correlationId found - type error, should not happen
              // Fall back to oneway error
              console.error(
                "[ws] RPC error without correlationId (type system violation)",
              );
              errorKind = { kind: "oneway", clientId };
            } else {
              // Valid RPC error
              errorKind = { kind: "rpc", correlationId: trimmedCorrelationId };

              // Check one-shot guard before sending
              if (this.#rpc.isTerminal(clientId, trimmedCorrelationId)) {
                // Already sent terminal, suppress
                return;
              }
              this.#rpc.onTerminal(clientId, trimmedCorrelationId);

              // Check backpressure (warn but still send)
              if (this.shouldBackpressure(ws)) {
                console.warn(
                  `[ws] Backpressure on RPC error send for ${code}, still sending RPC_ERROR`,
                );
              }
            }
          } else {
            // Non-RPC error
            errorKind = { kind: "oneway", clientId };
          }

          // Send unified error envelope
          const envOptions: {
            errorKind?: ErrorKind;
            retryable?: boolean;
            retryAfterMs?: number | null;
          } = { errorKind };
          if (options?.retryable !== undefined) {
            envOptions.retryable = options.retryable;
          }
          if (options?.retryAfterMs !== undefined) {
            envOptions.retryAfterMs = options.retryAfterMs;
          }
          this.sendErrorEnvelope(ws, code, message, details, envOptions);
        } catch (error) {
          console.error("[ws] Error sending error message:", error);
        }
      };

      // Create assignData function for clean connection data updates
      const assignData = (partial: Partial<TData>): void => {
        try {
          if (ws.data && typeof ws.data === "object") {
            Object.assign(ws.data, partial);
          }
        } catch (error) {
          console.error("[ws] Error assigning data to connection:", error);
        }
      };

      // Create getData function for type-safe connection data access
      const getData = <K extends keyof TData>(key: K): TData[K] => {
        try {
          return ws.data?.[key];
        } catch (error) {
          console.error("[ws] Error getting data from connection:", error);
          return undefined as TData[K];
        }
      };

      // Create subscribe function as convenience method
      const subscribe = (channel: string): void => {
        try {
          ws.subscribe(channel);
        } catch (error) {
          console.error("[ws] Error subscribing to channel:", error);
        }
      };

      // Create unsubscribe function as convenience method
      const unsubscribe = (channel: string): void => {
        try {
          ws.unsubscribe(channel);
        } catch (error) {
          console.error("[ws] Error unsubscribing from channel:", error);
        }
      };

      // Create publish function as bound convenience method for context
      // **Design** (ADR-019): ctx.publish() is a thin passthrough to router.publish()
      // for optimal handler ergonomics. Rather than exporting a standalone helper
      // function that requires passing the router, we bind it to the context for
      // use within message handlers, middleware, and lifecycle hooks.
      //
      // This aligns with ws-kit's design philosophy:
      // - Factory functions (`message()`, `rpc()`, `createRouter()`) for setup
      // - Context methods (`ctx.send()`, `ctx.subscribe()`, `ctx.publish()`) for operations
      //
      // Ergonomic comparison:
      // - ✅ ctx.publish(channel, schema, payload) — discoverable, consistent
      // - ❌ publish(router, channel, schema, payload) — requires param passing
      // - ❌ router.publish(channel, schema, payload) — less contextual in handlers
      //
      // The separation of concerns is maintained: router.publish() is canonical,
      // ctx.publish() is the ergonomic sugar for the 95% case (handlers).
      const publish = async (
        channel: string,
        schema: MessageSchemaType,
        payload: unknown,
        options?: PublishOptions,
      ): Promise<PublishResult> => {
        // Mark handler context via Symbol to enable future excludeSelf filtering.
        // Symbol key is invisible to user code (can't collide with string keys) and
        // documents that this is internal implementation detail, not part of the public API.
        return this.publish(channel, schema, payload, {
          ...options,
          [HANDLER_CONTEXT_MARKER]: true,
        } as PublishOptions & Record<symbol, boolean>);
      };

      // Calculate deadline for RPC requests
      const timeoutMs =
        (validatedData.meta?.timeoutMs as number | undefined) ||
        this.rpcTimeoutMs;
      const deadline = isRpc ? receivedAt + timeoutMs : undefined;

      // Create onCancel callback registration function
      // Server-side correlation synthesis: generate UUID if missing for RPC messages
      let correlationId =
        typeof validatedData.meta?.correlationId === "string"
          ? validatedData.meta.correlationId
          : undefined;

      // Synthesize correlationId for RPC if missing (belt-and-suspenders approach)
      if (isRpc && !correlationId) {
        // Generate UUID v7-like correlation ID for missing ones
        correlationId = crypto.randomUUID();
        console.debug(
          `[ws] Synthesized correlationId for RPC: ${correlationId}`,
        );
        // Update meta for downstream usage
        if (validatedData.meta && typeof validatedData.meta === "object") {
          const meta = validatedData.meta as Record<string, unknown>;
          meta.correlationId = correlationId;
          meta.syntheticCorrelation = true;
        }
      }

      // RPC-specific checks and setup
      if (isRpc && correlationId) {
        // Check inflight RPC limit per socket
        if (!this.#rpc.onRequest(clientId, correlationId)) {
          console.warn(
            `[ws] RPC inflight limit exceeded for ${clientId}, rejecting ${correlationId}`,
          );
          errorSend(
            "RESOURCE_EXHAUSTED",
            "Too many in-flight RPCs",
            undefined,
            {
              retryable: true,
              retryAfterMs: 100,
            },
          );
          return;
        }
      }

      const onCancel: ((cb: () => void) => () => void) | undefined = isRpc
        ? (cb: () => void): (() => void) => {
            if (!correlationId) {
              console.warn("[ws] onCancel called but no correlationId");
              // eslint-disable-next-line @typescript-eslint/no-empty-function
              return () => {}; // No-op unregister
            }
            return this.#rpc.onCancel(clientId, correlationId, cb);
          }
        : undefined;

      // Get AbortSignal for RPC request (always present for RPC, never undefined)
      const abortSignal: AbortSignal | undefined =
        isRpc && correlationId
          ? this.#rpc.getAbortSignal(clientId, correlationId)
          : undefined; // undefined for non-RPC, which won't be spread to context

      // Create timeRemaining function
      const timeRemaining = (): number => {
        if (!deadline) return Infinity;
        return Math.max(0, deadline - Date.now());
      };

      // Create RPC-aware send wrapper
      let rpcAwareSend: SendFunction;
      if (isRpc && correlationId) {
        // For RPC: wrap send with one-shot guard and backpressure checks
        rpcAwareSend = (
          schema: MessageSchemaType,
          payload: unknown,
          options: Record<string, unknown> = {},
        ) => {
          // Check if terminal already sent (suppress further sends)
          if (this.#rpc.isTerminal(clientId, correlationId)) {
            console.debug(
              `[ws] Suppressing send after terminal for RPC ${correlationId}`,
            );
            return;
          }

          // Check for backpressure on non-progress sends (terminal replies)
          const msgType = this.validator?.getMessageType(schema) ?? "";
          const handlerSchema = handlerEntry.schema as Record<string, unknown>;
          const isProgressMsg =
            msgType !==
            (handlerSchema && "response" in handlerSchema
              ? this.validator?.getMessageType(handlerSchema.response)
              : "");

          if (!isProgressMsg && this.shouldBackpressure(ws)) {
            console.warn(
              `[ws] Backpressure exceeded on RPC terminal send for ${correlationId}`,
            );
            // Send RESOURCE_EXHAUSTED error instead (per ADR-015)
            errorSend(
              "RESOURCE_EXHAUSTED",
              "Socket buffer exceeded capacity",
              undefined,
              {
                retryable: true,
                retryAfterMs: 100,
              },
            );
            return;
          }

          // Auto-copy correlationId if not present
          if (!options.correlationId) {
            options = { ...options, correlationId };
          }

          // Mark as terminal if this is the response message
          if (
            msgType ===
            ("response" in handlerSchema
              ? this.validator?.getMessageType(handlerSchema.response)
              : undefined)
          ) {
            this.#rpc.onTerminal(clientId, correlationId);
          }

          // Call original send
          send(schema, payload, options);
        };
      } else {
        rpcAwareSend = send;
      }

      // Implement reply() for RPC terminal responses
      const reply = (
        responseSchema: MessageSchemaType,
        data: unknown,
        options: Record<string, unknown> = {},
      ): void => {
        if (!isRpc || !correlationId) {
          console.warn("[ws] reply() called on non-RPC message, ignoring");
          return;
        }

        // Check one-shot guard
        if (this.#rpc.isTerminal(clientId, correlationId)) {
          console.debug(
            `[ws] Suppressing reply after terminal for RPC ${correlationId}`,
          );
          return;
        }

        // Mark as terminal
        this.#rpc.onTerminal(clientId, correlationId);

        // Check if backpressured (log warning but still send)
        if (this.shouldBackpressure(ws)) {
          console.warn(
            `[ws] Backpressure on RPC reply for ${correlationId}, still sending`,
          );
        }

        // Auto-copy correlationId if not present
        if (!options.correlationId) {
          options = { ...options, correlationId };
        }

        // Send via the standard send function
        send(responseSchema, data, options);
      };

      // Implement progress() for RPC streaming updates
      const progress = (data?: unknown): void => {
        if (!isRpc || !correlationId) {
          console.warn("[ws] progress() called on non-RPC message, ignoring");
          return;
        }

        // Check one-shot guard - don't send if terminal already sent
        if (this.#rpc.isTerminal(clientId, correlationId)) {
          console.debug(
            `[ws] Suppressing progress after terminal for RPC ${correlationId}`,
          );
          return;
        }

        // Update activity timestamp
        this.#rpc.onProgress(clientId, correlationId);

        // Check backpressure
        if (this.shouldBackpressure(ws)) {
          if (this.dropProgressOnBackpressure) {
            // Silently drop progress message
            console.debug(
              `[ws] Dropping progress on backpressure for RPC ${correlationId}`,
            );
            return;
          }
          // Otherwise, log warning and send anyway
          console.warn(
            `[ws] Backpressure on RPC progress for ${correlationId}, still sending`,
          );
        }

        // Send RPC_PROGRESS control message
        try {
          ws.send(
            JSON.stringify({
              type: "$ws:rpc-progress",
              data,
              meta: {
                timestamp: Date.now(),
                correlationId,
              },
            }),
          );
        } catch (error) {
          console.error("[ws] Error sending RPC progress:", error);
        }
      };

      const context: MessageContext<MessageSchemaType, TData> = {
        ws,
        type: messageType,
        meta: validatedData.meta,
        receivedAt: receivedAt,
        send: rpcAwareSend,
        error: errorSend,
        assignData,
        getData,
        subscribe,
        unsubscribe,
        publish,
        ...(isRpc && { onCancel }),
        ...(isRpc && { abortSignal }),
        ...(isRpc && { deadline }),
        ...(isRpc && { reply }),
        ...(isRpc && { progress }),
        timeRemaining,
        isRpc,
        ...(validatedData.payload !== undefined && {
          payload: validatedData.payload,
        }),
      };

      // Execute middleware pipeline followed by handler
      const executeHandlerWithMiddleware = async (): Promise<void> => {
        // Build combined middleware list: global + per-route
        const allMiddleware: Middleware<TData>[] = [
          ...this.middlewares,
          ...(this.routeMiddleware.get(messageType) || []),
        ];
        let middlewareIndex = 0;

        const next = async (): Promise<void> => {
          // Execute remaining middleware in order
          if (middlewareIndex < allMiddleware.length) {
            const middleware = allMiddleware[middlewareIndex++];
            if (!middleware) return; // Safeguard (should not happen)
            const result = middleware(context, next);
            if (result instanceof Promise) {
              await result;
            }
          } else {
            // All middleware executed, now dispatch handler
            // Type assertion is safe: context structure matches handler expectations
            // based on schema.response presence (RPC vs Event determination)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = handlerEntry.handler(context as any);
            if (result instanceof Promise) {
              await result;
            }
          }
        };

        // Start middleware pipeline and await it
        await next();
      };

      // Execute the middleware pipeline with proper error handling
      try {
        await executeHandlerWithMiddleware();

        // Warn if RPC handler completed without sending terminal response
        if (
          process.env.NODE_ENV !== "production" &&
          this.warnIncompleteRpc &&
          isRpc &&
          correlationId &&
          !this.#rpc.isTerminal(clientId, correlationId)
        ) {
          console.warn(
            `[ws] RPC handler for ${messageType} (${correlationId}) completed without calling ctx.reply() or ctx.error(). ` +
              `Client may timeout. Consider using ctx.reply() to send a response, or disable this warning ` +
              `with warnIncompleteRpc: false if spawning async work.`,
          );
        }
      } catch (error) {
        const actualError =
          error instanceof Error ? error : new Error(String(error));
        const suppressed = this.callErrorHandlers(actualError, context);

        // Auto-send INTERNAL response unless suppressed by error handler
        if (this.autoSendErrorOnThrow && !suppressed) {
          const errorMessage = this.exposeErrorDetails
            ? actualError.message
            : "Internal server error";
          context.error("INTERNAL", errorMessage);
        }
      }
    } catch (error) {
      const actualError =
        error instanceof Error ? error : new Error(String(error));

      // Check if this is a limit exceeded error
      const limitInfo = (actualError as unknown as Record<string, unknown>)
        ?._limitExceeded as
        | {
            type: string;
            observed: number;
            limit: number;
            retryAfterMs?: number | null;
            tentativeCorrelationId?: string;
          }
        | undefined;

      if (limitInfo) {
        // Handle limit exceeded case
        const limitExceededInfo: LimitExceededInfo<TData> = {
          type: limitInfo.type as LimitType,
          observed: limitInfo.observed,
          limit: limitInfo.limit,
          ws,
          clientId,
          ...(limitInfo.retryAfterMs !== null &&
            limitInfo.retryAfterMs !== undefined && {
              retryAfterMs: limitInfo.retryAfterMs,
            }),
        };

        // Call limit exceeded handlers (fire-and-forget)
        this.callLimitExceededHandlers(limitExceededInfo);

        // Handle based on configuration
        const onExceeded = this.limitsConfig?.onExceeded ?? "send";

        if (onExceeded === "send") {
          // Send RESOURCE_EXHAUSTED error response, keep connection open
          // Use fallbackContext to ensure wire format consistency with protocol
          // If correlationId was extracted from the raw payload, include it in meta
          const fallbackMeta: MessageMeta = {
            clientId,
            receivedAt,
          };
          if (limitInfo.tentativeCorrelationId) {
            fallbackMeta.correlationId = limitInfo.tentativeCorrelationId;
          }

          const fallbackContext = this.createMessageContext(
            ws,
            "",
            clientId,
            receivedAt,
            send,
            fallbackMeta,
          );

          // If retryAfterMs is null, it's an impossible operation (cost > capacity)
          if (limitInfo.retryAfterMs === null) {
            if (fallbackMeta.correlationId) {
              // RPC error path: preserve correlation for RPC client to match response to request.
              // Payload size limits can trigger before JSON parsing, so we detect RPC by checking
              // if correlationId was extracted from the raw payload (tentativeCorrelationId).
              this.sendErrorEnvelope(
                ws,
                "FAILED_PRECONDITION",
                `Operation cost exceeds limit capacity (${limitInfo.observed} > ${limitInfo.limit})`,
                {
                  observed: limitInfo.observed,
                  limit: limitInfo.limit,
                },
                {
                  errorKind: {
                    kind: "rpc",
                    correlationId: fallbackMeta.correlationId as string,
                  },
                },
              );
            } else {
              // Non-RPC error path: send via context (defaults to oneway error kind)
              fallbackContext.error(
                "FAILED_PRECONDITION",
                `Operation cost exceeds limit capacity (${limitInfo.observed} > ${limitInfo.limit})`,
                {
                  observed: limitInfo.observed,
                  limit: limitInfo.limit,
                },
              );
            }
          } else {
            // Retryable limit: forward computed retryAfterMs, or default to 100ms for payload limits
            const retryAfterMs =
              limitInfo.retryAfterMs ??
              (limitInfo.type === "payload" ? 100 : undefined);
            if (fallbackMeta.correlationId) {
              // RPC error path: preserve correlation even though schema validation hasn't run yet.
              // This is critical for RPC callers that sent oversized payloads (validation happens
              // after size check, so we extract correlationId from raw JSON before full parsing).
              this.sendErrorEnvelope(
                ws,
                "RESOURCE_EXHAUSTED",
                `Limit exceeded (${limitInfo.observed} > ${limitInfo.limit})`,
                {
                  observed: limitInfo.observed,
                  limit: limitInfo.limit,
                },
                {
                  errorKind: {
                    kind: "rpc",
                    correlationId: fallbackMeta.correlationId as string,
                  },
                  retryable: true,
                  ...(retryAfterMs !== undefined && { retryAfterMs }),
                },
              );
            } else {
              // Non-RPC error path: send via context (defaults to oneway error kind)
              fallbackContext.error(
                "RESOURCE_EXHAUSTED",
                `Limit exceeded (${limitInfo.observed} > ${limitInfo.limit})`,
                {
                  observed: limitInfo.observed,
                  limit: limitInfo.limit,
                },
                {
                  retryable: true,
                  ...(retryAfterMs !== undefined && { retryAfterMs }),
                },
              );
            }
          }
        } else if (onExceeded === "close") {
          // Close connection with configured code (default: 1009 "Message Too Big")
          const closeCode = this.limitsConfig?.closeCode ?? 1009;
          ws.close(closeCode, "RESOURCE_EXHAUSTED");
        }
        // For "custom", do nothing - let app handle in onLimitExceeded hook
      } else {
        // Not a limit error - handle as regular error
        const fallbackContext = this.createMessageContext(
          ws,
          "",
          clientId,
          receivedAt,
          send,
        );
        const suppressed = this.callErrorHandlers(actualError, fallbackContext);

        // Auto-send INTERNAL response unless suppressed by error handler
        if (this.autoSendErrorOnThrow && !suppressed) {
          const errorMessage = this.exposeErrorDetails
            ? actualError.message
            : "Internal server error";
          fallbackContext.error("INTERNAL", errorMessage);
        }
      }
    }
  }

  /**
   * Handle pong response from client (for heartbeat).
   *
   * Called by platform adapters when a pong frame is received.
   *
   * @param clientId - Client identifier
   */
  handlePong(clientId: string): void {
    const heartbeat = this.heartbeatStates.get(clientId);
    if (!heartbeat) return;

    heartbeat.lastPongTime = Date.now();

    // Clear pending pong timeout
    if (heartbeat.pongTimer) {
      clearTimeout(heartbeat.pongTimer);
      heartbeat.pongTimer = null;
    }
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Private Methods - Internal Implementation
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Lenient extraction of correlationId from raw message bytes.
   * Uses regex scan to find "correlationId": "..." without full parsing.
   * Safe for large payloads—we only scan, never execute.
   * @internal
   */
  private extractCorrelationIdFromRaw(
    message: string | Buffer,
  ): string | undefined {
    const str =
      typeof message === "string" ? message : message.toString("utf8");

    // Lenient regex: find "correlationId":"xxx" in meta object
    // Matches: "correlationId": "value" with optional whitespace
    const match = /"correlationId"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/;
    const result = match.exec(str);
    return result?.[1]?.trim();
  }

  /**
   * Check if payload size is within limits.
   *
   * Returns the payload size for tracking.
   *
   * @returns Payload size in bytes
   * @throws Error if payload exceeds maxPayloadBytes (with special marker)
   */
  private checkPayloadSize(message: string | Buffer): number {
    let size: number;

    if (typeof message === "string") {
      size = Buffer.byteLength(message, "utf8");
    } else {
      size = message.length;
    }

    if (size > this.maxPayloadBytes) {
      const error = new Error(
        `Payload size ${size} exceeds limit of ${this.maxPayloadBytes}`,
      );

      // Try lenient extraction of correlationId before throwing
      // This allows RPC payload limit errors to be correlated back to the client
      const tentativeCorrelationId = this.extractCorrelationIdFromRaw(message);

      // Mark this as a limit exceeded error for special handling
      (error as unknown as Record<string, unknown>)._limitExceeded = {
        type: "payload",
        observed: size,
        limit: this.maxPayloadBytes,
        ...(tentativeCorrelationId && { tentativeCorrelationId }),
      };
      throw error;
    }

    return size;
  }

  /**
   * Authenticate the connection by calling auth handlers.
   *
   * @returns Object with `ok` (boolean) and optional `reason` ("UNAUTHENTICATED" or "PERMISSION_DENIED")
   */
  private async authenticateConnection(
    ws: ServerWebSocket<TData>,
    send: SendFunction,
    receivedAt: number,
  ): Promise<{
    ok: boolean;
    reason?: "UNAUTHENTICATED" | "PERMISSION_DENIED";
  }> {
    if (this.authHandlers.length === 0) {
      // No auth handlers = allow
      return { ok: true };
    }

    let failureReason: "UNAUTHENTICATED" | "PERMISSION_DENIED" | undefined;

    for (const handler of this.authHandlers) {
      try {
        const context = this.createMessageContext(
          ws,
          "",
          ws.data.clientId,
          receivedAt,
          send,
        );

        const result = handler(context);
        const handlerResult = result instanceof Promise ? await result : result;

        // Process handler result: boolean or explicit reason string
        if (typeof handlerResult === "boolean") {
          if (!handlerResult) {
            // false means permission denied (legacy default)
            if (!failureReason) failureReason = "PERMISSION_DENIED";
            return { ok: false, reason: failureReason };
          }
        } else if (handlerResult === "UNAUTHENTICATED") {
          // Highest precedence: if any handler says UNAUTHENTICATED, use that
          failureReason = "UNAUTHENTICATED";
          return { ok: false, reason: failureReason };
        } else if (handlerResult === "PERMISSION_DENIED") {
          // Use PERMISSION_DENIED if no higher-precedence reason yet
          if (!failureReason) failureReason = "PERMISSION_DENIED";
          return { ok: false, reason: failureReason };
        }
      } catch (error) {
        console.error(
          `[ws] Error in auth handler for ${ws.data.clientId}:`,
          error,
        );
        // Caught errors default to PERMISSION_DENIED for security
        return { ok: false, reason: "PERMISSION_DENIED" };
      }
    }

    return { ok: true };
  }

  /**
   * Call all registered limit exceeded handlers.
   *
   * Fire-and-forget execution: exceptions are logged but don't interrupt other handlers.
   */
  private callLimitExceededHandlers(info: LimitExceededInfo<TData>): void {
    if (this.limitExceededHandlers.length === 0) {
      return;
    }

    for (const handler of this.limitExceededHandlers) {
      try {
        const result = handler(info);
        // If handler returns a promise, don't await (fire-and-forget pattern)
        // But log if it rejects
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(
              `[ws] Error in onLimitExceeded handler for ${info.clientId}:`,
              error,
            );
          });
        }
      } catch (handlerError) {
        console.error(
          `[ws] Error in onLimitExceeded handler for ${info.clientId}:`,
          handlerError,
        );
      }
    }
  }

  /**
   * Call all registered error handlers and track suppression requests.
   *
   * @param error - The error to pass to handlers
   * @param context - Message context (may be partial if error occurred early)
   * @returns true if automatic error response should be suppressed (any handler returned false)
   */
  private callErrorHandlers(
    error: Error,
    context: MessageContext<MessageSchemaType, TData>,
  ): boolean {
    // Wrap error as WsKitError if it isn't already
    const wsKitError = WsKitError.wrap(
      error,
      ErrorCode.INTERNAL,
      error.message,
    );

    if (this.errorHandlers.length === 0) {
      // No error handlers registered - log to console with structured format
      console.error(
        "[ws] Unhandled error:",
        JSON.stringify(wsKitError.toJSON(), null, 2),
      );
      return false; // Not suppressed
    }

    let suppressed = false;
    for (const handler of this.errorHandlers) {
      try {
        const result = handler(wsKitError, context);
        // Handler can return false to suppress automatic error response
        if (result === false) {
          suppressed = true;
        }
      } catch (handlerError) {
        console.error("[ws] Error in error handler:", handlerError);
      }
    }
    return suppressed;
  }

  /**
   * Create a complete MessageContext with all required methods.
   *
   * This factory ensures type-safe context construction with all required fields
   * (error, reply, assignData, subscribe, unsubscribe) properly bound.
   *
   * @param ws - WebSocket connection
   * @param type - Message type
   * @param clientId - Client identifier
   * @param receivedAt - Receive timestamp
   * @param send - Send function
   * @param meta - Message metadata (optional override)
   * @returns Complete MessageContext
   */
  private createMessageContext<
    TMsg extends MessageSchemaType = MessageSchemaType,
  >(
    ws: ServerWebSocket<TData>,
    type: string,
    clientId: string,
    receivedAt: number,
    send: SendFunction,
    meta?: MessageMeta,
  ): MessageContext<TMsg, TData> {
    const contextMeta = meta || { clientId, receivedAt };

    // Error sending function for type-safe error responses
    const errorSend = (
      code: string,
      message: string,
      details?: Record<string, unknown>,
      options?: {
        retryable?: boolean;
        retryAfterMs?: number | null;
      },
    ) => {
      const envOptions: {
        errorKind?: ErrorKind;
        retryable?: boolean;
        retryAfterMs?: number | null;
      } = { errorKind: { kind: "oneway", clientId } };
      if (options?.retryable !== undefined) {
        envOptions.retryable = options.retryable;
      }
      if (options?.retryAfterMs !== undefined) {
        envOptions.retryAfterMs = options.retryAfterMs;
      }
      this.sendErrorEnvelope(ws, code, message, details, envOptions);
    };

    // Helper to update connection data
    const assignData = (partial: Partial<TData>): void => {
      try {
        if (ws.data && typeof ws.data === "object") {
          Object.assign(ws.data, partial);
        }
      } catch (error) {
        console.error("[ws] Error assigning data to connection:", error);
      }
    };

    // Helper to access connection data with type safety
    const getData = <K extends keyof TData>(key: K): TData[K] => {
      try {
        return ws.data?.[key];
      } catch (error) {
        console.error("[ws] Error getting data from connection:", error);
        return undefined as TData[K];
      }
    };

    // Subscribe to channel
    const subscribe = (channel: string): void => {
      try {
        ws.subscribe(channel);
      } catch (error) {
        console.error("[ws] Error subscribing to channel:", error);
      }
    };

    // Unsubscribe from channel
    const unsubscribe = (channel: string): void => {
      try {
        ws.unsubscribe(channel);
      } catch (error) {
        console.error("[ws] Error unsubscribing from channel:", error);
      }
    };

    // Publish to channel
    const publish = async (
      channel: string,
      schema: MessageSchemaType,
      payload: unknown,
      options?: PublishOptions,
    ): Promise<PublishResult> => {
      return this.publish(channel, schema, payload, options);
    };

    return {
      ws,
      type,
      meta: contextMeta,
      receivedAt,
      send,
      error: errorSend,
      reply: send as SendFunction, // Semantic alias (may not be RPC in all contexts)
      assignData,
      getData,
      subscribe,
      unsubscribe,
      publish,
      timeRemaining: () => Infinity, // No deadline in non-RPC contexts
      isRpc: false, // Not an RPC by default in this context factory
    };
  }

  /**
   * Create a send function for a specific WebSocket connection.
   *
   * The send function validates messages before sending (unless validate: false).
   */
  private createSendFunction(ws: ServerWebSocket<TData>): SendFunction {
    return (
      schema: MessageSchemaType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: any = {},
    ) => {
      try {
        if (!this.validator) {
          throw new Error(
            "Cannot send message: no validator configured. " +
              "Router must be created with a validator adapter.",
          );
        }

        // Extract message type from schema
        const messageType = this.validator.getMessageType(schema);

        // Extract validate option and filter it out from meta
        const shouldValidate = options.validate !== false;
        const metaOptions = { ...options };
        delete metaOptions.validate;

        // Create message object with required structure
        // NOTE: timestamp auto-generated; clientId is NEVER injected
        const message = {
          type: messageType,
          meta: {
            timestamp: Date.now(),
            ...metaOptions,
          },
          ...(payload !== undefined && { payload }),
        };

        // Skip validation if explicitly disabled (useful for testing)
        if (!shouldValidate) {
          ws.send(JSON.stringify(message));
          return;
        }

        // Validate constructed message
        const validationResult = this.validator.safeParse(schema, message);

        if (!validationResult.success) {
          console.error(
            `[ws] Failed to send message of type "${messageType}": Validation error`,
            validationResult.error,
          );
          return;
        }

        // Send validated message
        ws.send(JSON.stringify(validationResult.data));
      } catch (error) {
        console.error(`[ws] Error sending message:`, error);
      }
    };
  }

  /**
   * Start heartbeat for a connection.
   *
   * Sends ping frames at regular intervals. If pong is not received
   * within the timeout, closes the connection.
   */
  private startHeartbeat(clientId: string, ws: ServerWebSocket<TData>): void {
    if (!this.heartbeatConfig) return;

    const heartbeat = this.heartbeatStates.get(clientId);
    if (!heartbeat) return;

    const { intervalMs } = this.heartbeatConfig;

    // Set up periodic ping timer
    heartbeat.pingTimer = setInterval(() => {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        // Try to send ping using ws.send if ping/pong not available
        // Platform adapters should handle this if they support it
        // For now, just log and assume platform handles it
      }
    }, intervalMs) as unknown as ReturnType<typeof setInterval>;

    // Set initial pong timeout
    this.resetPongTimeout(clientId);
  }

  /**
   * Stop heartbeat for a connection.
   */
  private stopHeartbeat(clientId: string): void {
    const heartbeat = this.heartbeatStates.get(clientId);
    if (!heartbeat) return;

    if (heartbeat.pingTimer) {
      clearInterval(heartbeat.pingTimer);
      heartbeat.pingTimer = null;
    }

    if (heartbeat.pongTimer) {
      clearTimeout(heartbeat.pongTimer);
      heartbeat.pongTimer = null;
    }

    this.heartbeatStates.delete(clientId);
  }

  /**
   * Reset the pong timeout for a connection.
   *
   * Called when a pong is received or to start a new timeout.
   */
  private resetPongTimeout(clientId: string): void {
    if (!this.heartbeatConfig) return;

    const heartbeat = this.heartbeatStates.get(clientId);
    if (!heartbeat) return;

    const { timeoutMs } = this.heartbeatConfig;

    // Clear existing timeout
    if (heartbeat.pongTimer) {
      clearTimeout(heartbeat.pongTimer);
    }

    // Set new timeout
    heartbeat.pongTimer = setTimeout(() => {
      console.warn(`[ws] Heartbeat timeout for ${clientId}`);
      // Call optional callback before closing
      if (this.heartbeatConfig?.onStaleConnection) {
        try {
          this.heartbeatConfig.onStaleConnection(clientId, heartbeat.ws);
        } catch (error) {
          console.error(
            `[ws] Error in onStaleConnection callback for ${clientId}:`,
            error,
          );
        }
      }
      heartbeat.ws.close(4000, "HEARTBEAT_TIMEOUT");
      this.stopHeartbeat(clientId);
    }, timeoutMs) as unknown as ReturnType<typeof setTimeout>;
  }

  /**
   * Get buffered bytes for backpressure check.
   * Uses platform adapter if available, otherwise ws.bufferedAmount.
   */
  private getBufferedBytes(ws: ServerWebSocket<TData>): number {
    if (this.platform?.getBufferedBytes) {
      // Platform adapter type may differ from ServerWebSocket interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.platform.getBufferedBytes(ws as any);
    }
    // Fallback: check ws.bufferedAmount if available (Bun, browsers)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((ws as any).bufferedAmount as number) ?? 0;
  }

  /**
   * Check if we should backpressure (buffer is full).
   */
  private shouldBackpressure(ws: ServerWebSocket<TData>): boolean {
    if (this.socketBufferLimitBytes === Infinity) {
      return false; // Backpressure disabled
    }
    return this.getBufferedBytes(ws) > this.socketBufferLimitBytes;
  }

  /**
   * Send a unified error envelope (ERROR or RPC_ERROR with same structure).
   *
   * Both message types use:
   * { type, meta: { timestamp, correlationId? }, payload: { code, message?, details?, retryable?, retryAfterMs? } }
   *
   * This ensures:
   * - Consistent client parsing (no dual paths)
   * - retryAfterMs validation per ERROR_CODE_META
   * - Deterministic backoff hints for transient errors
   */
  /**
   * Sanitize error details before wire transmission.
   * Removes sensitive keys (passwords, tokens, auth credentials) and huge blobs.
   */
  private sanitizeErrorDetails(
    details: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!details || Object.keys(details).length === 0) {
      return details;
    }

    // Forbidden keys (known sensitive fields)
    const forbidden = new Set([
      "password",
      "token",
      "authorization",
      "cookie",
      "secret",
      "apikey",
      "api_key",
      "accesstoken",
      "access_token",
      "refreshtoken",
      "refresh_token",
      "credentials",
      "auth",
      "bearer",
      "jwt",
    ]);

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(details)) {
      // Skip forbidden keys (case-insensitive)
      if (forbidden.has(key.toLowerCase())) {
        continue;
      }

      // Skip huge nested objects (prevent blob leaks)
      if (
        typeof value === "object" &&
        value !== null &&
        !(value instanceof Date)
      ) {
        const str = JSON.stringify(value);
        if (str.length > 500) {
          continue;
        }
      }

      // Safe to include
      result[key] = value;
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private sendErrorEnvelope(
    ws: ServerWebSocket<TData>,
    code: string,
    message?: string,
    details?: Record<string, unknown>,
    options?: {
      errorKind?: ErrorKind;
      retryable?: boolean;
      retryAfterMs?: number | null;
      inHandshakeScope?: boolean;
    },
  ): void {
    try {
      const {
        errorKind = { kind: "oneway" },
        retryable,
        retryAfterMs,
      } = options || {};

      // Look up error code metadata for validation rules
      const meta = ERROR_CODE_META[code as ErrorCode];

      // Validate retryAfterMs against error code rules (soft: warn + omit)
      if (meta) {
        if (
          meta.retryAfterMsRule === "forbidden" &&
          retryAfterMs !== undefined
        ) {
          console.warn(
            `[ws] Error code ${code} forbids retryAfterMs, but value was provided: ${retryAfterMs}ms (omitting)`,
          );
        }
      }

      // Build unified payload
      const payload: Record<string, unknown> = { code };
      if (message !== undefined) {
        payload.message = message;
      }

      // Sanitize details before adding to payload (remove sensitive keys)
      const sanitized = this.sanitizeErrorDetails(details);
      if (sanitized !== undefined) {
        payload.details = sanitized;
      }

      // Include retryable hint
      let finalRetryable = retryable;

      // For INTERNAL errors: require explicit decision (default to false for fail-safe)
      if (code === ErrorCode.INTERNAL && finalRetryable === undefined) {
        console.warn(
          `[ws] INTERNAL error without explicit retryable; defaulting to false. ` +
            `Set retryable=true only if this is transient (e.g., DB timeout). ` +
            `Use UNAVAILABLE or RESOURCE_EXHAUSTED for infrastructure issues.`,
        );
        finalRetryable = false;
      }

      if (finalRetryable !== undefined) {
        payload.retryable = finalRetryable;
      } else if (meta?.retryable === true) {
        // Auto-include retryable=true for known transient codes
        payload.retryable = true;
      }

      // Include backoff hint if applicable (only if not forbidden)
      // ADR-015 semantics for retryAfterMs:
      // - number (≥0): retry after this many ms; implies retryable=true
      // - null: operation impossible under policy (non-retryable; set retryable=false)
      //   Example: operation cost exceeds rate limit capacity
      // - undefined: omitted from payload; client infers default per ERROR_CODE_META
      if (
        retryAfterMs !== undefined &&
        meta?.retryAfterMsRule !== "forbidden"
      ) {
        payload.retryAfterMs = retryAfterMs;
        // null semantics: impossible operation, don't retry
        if (retryAfterMs === null && payload.retryable === undefined) {
          payload.retryable = false;
        } else if (
          // numeric semantics: implied retryable if not explicitly set
          typeof retryAfterMs === "number" &&
          payload.retryable === undefined
        ) {
          payload.retryable = true;
        }
      }

      // Build unified envelope
      const isRpc = errorKind.kind === "rpc";
      const envelope: Record<string, unknown> = {
        type: isRpc ? "RPC_ERROR" : "ERROR",
        meta: { timestamp: Date.now() },
        payload,
      };

      // Add correlationId for RPC (required for client correlation)
      // The type system guarantees correlationId exists for kind: "rpc"
      if (isRpc) {
        (envelope.meta as Record<string, unknown>).correlationId =
          errorKind.correlationId;
      }

      ws.send(JSON.stringify(envelope));

      // Auto-close on auth/authz failures depends on scope.
      // See docs/specs/error-handling.md#auto-close-behavior for details.
      // Handshake scope (before connection established): always close
      // Message scope (after connection established): close only if policy flags are set
      const authErrorCodes = new Set([
        ErrorCode.UNAUTHENTICATED,
        ErrorCode.PERMISSION_DENIED,
      ]);

      if (authErrorCodes.has(code as ErrorCode)) {
        const inHandshakeScope = options?.inHandshakeScope ?? false;
        const shouldClose =
          inHandshakeScope ||
          (code === ErrorCode.UNAUTHENTICATED &&
            this.authConfig?.closeOnUnauthenticated) ||
          (code === ErrorCode.PERMISSION_DENIED &&
            this.authConfig?.closeOnPermissionDenied);

        if (shouldClose) {
          // 1008 = RFC 6455 Policy Violation. Standard codes ensure load balancers, proxies, and clients
          // correctly classify auth failures as non-retryable connection-level failures.
          ws.close(1008, code);
        }
      }
    } catch (error) {
      console.error("[ws] Error sending error envelope:", error);
    }
  }
}
