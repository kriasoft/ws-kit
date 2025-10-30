// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { normalizeInboundMessage } from "./normalize.js";
import { MemoryPubSub } from "./pubsub.js";
import { RpcManager } from "./rpc-manager.js";
import {
  RESERVED_META_KEYS,
  RESERVED_CONTROL_PREFIX,
  DEFAULT_CONFIG,
} from "./constants.js";
import type {
  ServerWebSocket,
  WebSocketData,
  MessageContext,
  EventMessageContext,
  RpcMessageContext,
  MessageMeta,
  SendFunction,
  OpenHandler,
  CloseHandler,
  MessageHandler,
  EventHandler,
  RpcHandler,
  AuthHandler,
  ErrorHandler,
  Middleware,
  MessageSchemaType,
  MessageHandlerEntry,
  WebSocketRouterOptions,
  ValidatorAdapter,
  PlatformAdapter,
  PubSub,
  OpenHandlerContext,
  CloseHandlerContext,
  PublishOptions,
} from "./types.js";

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
> {
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
  private readonly socketBufferLimitBytes: number;
  private readonly rpcTimeoutMs: number;
  private readonly dropProgressOnBackpressure: boolean;

  // Error handling configuration
  private readonly autoSendErrorOnThrow: boolean;
  private readonly exposeErrorDetails: boolean;
  private readonly warnIncompleteRpc: boolean;

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
    this.#rpc = new RpcManager({
      maxInflightRpcsPerSocket: options.maxInflightRpcsPerSocket ?? 1000,
      rpcIdleTimeoutMs,
    });

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
    }

    // Set up testing utilities if testing mode is enabled
    // This allows test code to inspect and assert on internal state without reflection
    if ((options as any).testing === true) {
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
    return this.on(schema, handler);
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
   * router.publish("room:123", { text: "Hello all" });
   * ```
   */
  topic<Schema extends MessageSchemaType>(
    schema: Schema,
    options?: { onPublish?: MessageHandler<Schema, TData> },
  ): this {
    // Register handler if provided
    if (options?.onPublish) {
      return this.on(schema, options.onPublish);
    }

    // No-op if no handler provided (schema is just registered as a type)
    return this;
  }

  /**
   * Register a handler for WebSocket open events.
   *
   * Called after successful authentication when a client connects.
   * Multiple handlers can be registered and execute in order.
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
   *     ctx.error("AUTH_ERROR", "Not authenticated");
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
   *     ctx.error("RATE_LIMIT", "Max 10 messages per second");
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
  routes(): ReadonlyArray<{
    messageType: string;
    handler: MessageHandlerEntry<TData>;
    middleware: ReadonlyArray<Middleware<TData>>;
  }> {
    const result: Array<{
      messageType: string;
      handler: MessageHandlerEntry<TData>;
      middleware: Middleware<TData>[];
    }> = [];

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
   * @param router - Another WebSocketRouter to merge
   * @returns This router for method chaining
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
  merge(router: WebSocketRouter<V, TData>): this {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other = router as unknown as AccessibleRouter;

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
  private get pubsub(): PubSub {
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
   * against the schema before publishing. Returns Promise<number> for testing/metrics.
   *
   * **Type Safety**: Payload is validated against schema. Invalid payloads return 0 and
   * log errors; valid payloads are broadcast to all subscribers on the topic. This
   * ensures that subscribers always receive well-formed messages.
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
   * **Return Value**: Returns `Promise<number>` indicating matched subscriber count.
   * - Useful for testing (assert specific fan-out count)
   * - Useful for metrics/observability (track broadcast scope)
   * - Current implementation: returns 1 as sentinel (distributed pubsub can override)
   * - Future: PubSub interface may add subscriberCount() for exact metrics
   *
   * **Scope** depends on PubSub implementation:
   * - MemoryPubSub: This process instance only
   * - BunPubSub (Phase 3): Load-balanced cluster (all instances)
   * - DurablePubSub (Phase 6): This DO instance only
   * - RedisPubSub (Phase 8): Multiple instances via Redis
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
   * @returns Promise<number> - Resolves to matched subscriber count
   *
   * @example
   * ```typescript
   * // From handler (use ctx.publish() for ergonomics)
   * router.on(UserCreated, async (ctx) => {
   *   const user = await db.create(ctx.payload);
   *   const count = await ctx.publish(
   *     `org:${ctx.payload.orgId}:users`,
   *     UserListInvalidated,
   *     { orgId: ctx.payload.orgId }
   *   );
   *   console.log(`Notified ${count} subscribers`);
   * });
   * ```
   *
   * ```typescript
   * // Outside handlers (cron, queue, lifecycle)
   * const count = await router.publish(
   *   "system:announcements",
   *   System.Announcement,
   *   { text: "Server maintenance at 02:00 UTC" }
   * );
   * ```
   */
  async publish(
    channel: string,
    schema: MessageSchemaType,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<number> {
    try {
      if (!this.validator) {
        console.warn(
          "[ws] Cannot publish: no validator configured. " +
            "Router must be created with a validator adapter.",
        );
        return 0;
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
        console.error(
          `[ws] Failed to publish message of type "${messageType}": Validation error`,
          validationResult.success,
        );
        return 0;
      }

      // Publish validated message to pubsub
      // At this point, message is guaranteed to match schema
      await this.pubsub.publish(channel, validationResult.data);

      // Return subscriber count estimate
      // - For MemoryPubSub: Could query subscriberCount() internally
      // - For distributed pubsub: Count unknown until delivery (return sentinel 1)
      // - Implementations can override by wrapping PubSub interface
      // TODO: Consider adding subscriberCount to PubSub interface for better metrics
      return 1;
    } catch (error) {
      console.error(
        `[ws] Error publishing message to channel "${channel}":`,
        error,
      );
      return 0;
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
        const authenticated = await this.authenticateConnection(
          ws,
          send,
          receivedAt,
        );
        if (!authenticated) {
          console.warn(`[ws] Authentication failed for ${clientId}`);
          ws.close(4403, "FORBIDDEN");
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
          // Send RPC_ERROR for validation failure (socket stays open)
          const correlationId = (normalized.meta as Record<string, unknown>)
            ?.correlationId;
          if (typeof correlationId === "string") {
            ws.send(
              JSON.stringify({
                type: "RPC_ERROR",
                code: "VALIDATION",
                message: "Request validation failed",
                meta: {
                  timestamp: Date.now(),
                  correlationId,
                },
              }),
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
      ) => {
        try {
          if (!this.validator) {
            throw new Error(
              "Cannot send error: no validator configured. " +
                "Router must be created with a validator adapter.",
            );
          }

          // For RPC: check one-shot guard and send RPC_ERROR
          if (isRpc && correlationId) {
            if (this.#rpc.isTerminal(clientId, correlationId)) {
              // Already sent terminal, suppress
              return;
            }
            this.#rpc.onTerminal(clientId, correlationId);

            // Check backpressure
            if (this.shouldBackpressure(ws)) {
              console.warn(
                `[ws] Backpressure on RPC error send, still sending RPC_ERROR`,
              );
            }

            // Send RPC_ERROR with wire format
            ws.send(
              JSON.stringify({
                type: "RPC_ERROR",
                code,
                message,
                ...(details && { details }),
                meta: {
                  timestamp: Date.now(),
                  correlationId,
                },
              }),
            );
          } else {
            // Non-RPC: send standard ERROR message
            ws.send(
              JSON.stringify({
                type: "ERROR",
                meta: {
                  timestamp: Date.now(),
                },
                payload: {
                  code,
                  message,
                  ...(details && { details }),
                },
              }),
            );
          }
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
        payload: any,
        options?: PublishOptions,
      ): Promise<number> => {
        return this.publish(channel, schema, payload, options);
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
      let syntheticCorrelation = false;
      if (isRpc && !correlationId) {
        // Generate UUID v7-like correlation ID for missing ones
        correlationId = crypto.randomUUID();
        syntheticCorrelation = true;
        console.debug(
          `[ws] Synthesized correlationId for RPC: ${correlationId}`,
        );
        // Update meta for downstream usage
        if (validatedData.meta && typeof validatedData.meta === "object") {
          (validatedData.meta as any).correlationId = correlationId;
          (validatedData.meta as any).syntheticCorrelation = true;
        }
      }

      // RPC-specific checks and setup
      if (isRpc && correlationId) {
        // Check inflight RPC limit per socket
        if (!this.#rpc.onRequest(clientId, correlationId)) {
          console.warn(
            `[ws] RPC inflight limit exceeded for ${clientId}, rejecting ${correlationId}`,
          );
          errorSend("RATE_LIMIT", "Too many in-flight RPCs", {
            retryable: true,
            retryAfterMs: 100,
          });
          return;
        }
      }

      const onCancel: ((cb: () => void) => () => void) | undefined = isRpc
        ? (cb: () => void): (() => void) => {
            if (!correlationId) {
              console.warn("[ws] onCancel called but no correlationId");
              return () => {}; // No-op unregister
            }
            return this.#rpc.onCancel(clientId, correlationId, cb);
          }
        : undefined;

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
          payload: any,
          options: any = {},
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
          const isProgressMsg =
            msgType !==
            (handlerEntry.schema && (handlerEntry.schema as any).response
              ? this.validator?.getMessageType(
                  (handlerEntry.schema as any).response,
                )
              : "");

          if (!isProgressMsg && this.shouldBackpressure(ws)) {
            console.warn(
              `[ws] Backpressure exceeded on RPC terminal send for ${correlationId}`,
            );
            // Send BACKPRESSURE error instead
            errorSend("BACKPRESSURE", "Socket buffer exceeded capacity", {
              retryable: true,
              retryAfterMs: 100,
            });
            return;
          }

          // Auto-copy correlationId if not present
          if (!options.correlationId) {
            options = { ...options, correlationId };
          }

          // Mark as terminal if this is the response message
          if (
            msgType ===
            this.validator?.getMessageType(
              (handlerEntry.schema as any).response,
            )
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
        data: any,
        options: any = {},
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
        subscribe,
        unsubscribe,
        publish,
        ...(isRpc && { onCancel }),
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
            const result = handlerEntry.handler(context);
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

        // Auto-send INTERNAL_ERROR response unless suppressed by error handler
        if (this.autoSendErrorOnThrow && !suppressed) {
          const errorMessage = this.exposeErrorDetails
            ? actualError.message
            : "Internal server error";
          context.error("INTERNAL_ERROR", errorMessage);
        }
      }
    } catch (error) {
      const actualError =
        error instanceof Error ? error : new Error(String(error));
      const fallbackContext = this.createMessageContext(
        ws,
        "",
        clientId,
        receivedAt,
        send,
      );
      const suppressed = this.callErrorHandlers(actualError, fallbackContext);

      // Auto-send INTERNAL_ERROR response unless suppressed by error handler
      if (this.autoSendErrorOnThrow && !suppressed) {
        const errorMessage = this.exposeErrorDetails
          ? actualError.message
          : "Internal server error";
        fallbackContext.error("INTERNAL_ERROR", errorMessage);
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
   * Check if payload size is within limits.
   *
   * @throws Error if payload exceeds maxPayloadBytes
   */
  private checkPayloadSize(message: string | Buffer): void {
    let size: number;

    if (typeof message === "string") {
      size = Buffer.byteLength(message, "utf8");
    } else {
      size = message.length;
    }

    if (size > this.maxPayloadBytes) {
      throw new Error(
        `Payload size ${size} exceeds limit of ${this.maxPayloadBytes}`,
      );
    }
  }

  /**
   * Authenticate the connection by calling auth handlers.
   *
   * @returns true if authenticated, false otherwise
   */
  private async authenticateConnection(
    ws: ServerWebSocket<TData>,
    send: SendFunction,
    receivedAt: number,
  ): Promise<boolean> {
    if (this.authHandlers.length === 0) {
      // No auth handlers = allow
      return true;
    }

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
        const authenticated = result instanceof Promise ? await result : result;

        if (!authenticated) {
          return false;
        }
      } catch (error) {
        console.error(
          `[ws] Error in auth handler for ${ws.data.clientId}:`,
          error,
        );
        return false;
      }
    }

    return true;
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
    context?: MessageContext<MessageSchemaType, TData>,
  ): boolean {
    if (this.errorHandlers.length === 0) {
      // No error handlers registered - log to console
      console.error("[ws] Unhandled error:", error, context);
      return false; // Not suppressed
    }

    let suppressed = false;
    for (const handler of this.errorHandlers) {
      try {
        const result = handler(error, context);
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
    ) => {
      try {
        ws.send(
          JSON.stringify({
            type: "ERROR",
            meta: { timestamp: Date.now() },
            payload: { code, message, ...(details && { details }) },
          }),
        );
      } catch (error) {
        console.error("[ws] Error sending error message:", error);
      }
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

    return {
      ws,
      type,
      meta: contextMeta,
      receivedAt,
      send,
      error: errorSend,
      reply: send as any, // Semantic alias (may not be RPC in all contexts)
      assignData,
      subscribe,
      unsubscribe,
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

    const { intervalMs, timeoutMs } = this.heartbeatConfig;

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
      return this.platform.getBufferedBytes(ws);
    }
    // Fallback: check ws.bufferedAmount if available (Bun, browsers)
    return (ws as any).bufferedAmount ?? 0;
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
}
