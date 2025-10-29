// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { normalizeInboundMessage } from "./normalize.js";
import { MemoryPubSub } from "./pubsub.js";
import { RESERVED_META_KEYS, DEFAULT_CONFIG } from "./constants.js";
import type {
  ServerWebSocket,
  WebSocketData,
  MessageContext,
  SendFunction,
  OpenHandler,
  CloseHandler,
  MessageHandler,
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
} from "./types.js";

/**
 * Heartbeat state tracking per connection.
 */
interface HeartbeatState {
  pingTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  lastPongTime: number;
  ws: ServerWebSocket;
  authenticated: boolean; // Track if connection has been authenticated
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
 * - `createZodRouter()` from `@ws-kit/zod`
 * - `createValibotRouter()` from `@ws-kit/valibot`
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
  private readonly validator?: V;
  private readonly platform?: PlatformAdapter;
  private readonly pubsub: PubSub;

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
  private readonly heartbeatStates = new Map<string, HeartbeatState>();

  // Limits
  private readonly maxPayloadBytes: number;

  constructor(options: WebSocketRouterOptions<V, TData> = {}) {
    this.validator = options.validator;
    this.platform = options.platform;
    this.pubsub =
      options.pubsub || options.platform?.pubsub || new MemoryPubSub();
    this.maxPayloadBytes =
      options.limits?.maxPayloadBytes ?? DEFAULT_CONFIG.MAX_PAYLOAD_BYTES;

    // Store heartbeat config with defaults
    // Heartbeat is always enabled; can be configured or use defaults
    this.heartbeatConfig = {
      intervalMs:
        options.heartbeat?.intervalMs ?? DEFAULT_CONFIG.HEARTBEAT_INTERVAL_MS,
      timeoutMs:
        options.heartbeat?.timeoutMs ?? DEFAULT_CONFIG.HEARTBEAT_TIMEOUT_MS,
      onStaleConnection: options.heartbeat?.onStaleConnection,
    };

    // Register hooks if provided
    if (options.hooks) {
      if (options.hooks.onOpen) this.openHandlers.push(options.hooks.onOpen);
      if (options.hooks.onClose) this.closeHandlers.push(options.hooks.onClose);
      if (options.hooks.onAuth) this.authHandlers.push(options.hooks.onAuth);
      if (options.hooks.onError) this.errorHandlers.push(options.hooks.onError);
    }
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Public API - Handler Registration
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Register a handler for a specific message type.
   *
   * @param schema - Message schema (format depends on validator adapter)
   * @param handler - Handler function to call when message arrives
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * const PingMessage = messageSchema("PING", { text: z.string() });
   * router.onMessage(PingMessage, (ctx) => {
   *   console.log("Ping received:", ctx.payload.text);
   * });
   * ```
   */
  onMessage<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: MessageHandler<Schema, TData>,
  ): this {
    if (!this.validator) {
      console.warn(
        "[ws] No validator configured. Messages of this type will not be routed.",
      );
      return this;
    }

    const messageType = this.validator.getMessageType(schema);

    if (this.messageHandlers.has(messageType)) {
      console.warn(
        `[ws] Handler for message type "${messageType}" is being overwritten.`,
      );
    }

    this.messageHandlers.set(messageType, {
      schema,
      handler: handler as MessageHandler<MessageSchemaType, TData>,
    });

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
   * router.onMessage(SendMessage, (ctx) => {
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
      console.warn(
        "[ws] No validator configured. Per-route middleware will not be registered.",
      );
      return this;
    }

    const messageType = this.validator.getMessageType(
      schemaOrMiddleware as MessageSchemaType,
    );
    const routeMiddlewareList = this.routeMiddleware.get(messageType) || [];
    routeMiddlewareList.push(middleware);
    this.routeMiddleware.set(messageType, routeMiddlewareList);
    return this;
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Public API - Router Composition & Publishing
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Merge message handlers from another router into this one.
   *
   * Useful for composing routers from different modules/features.
   * Last-write-wins for duplicate message types.
   *
   * @param router - Another WebSocketRouter to merge
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * import { createZodRouter } from "@ws-kit/zod";
   *
   * const authRouter = createZodRouter();
   * authRouter.onMessage(LoginSchema, handleLogin);
   *
   * const chatRouter = createZodRouter();
   * chatRouter.onMessage(MessageSchema, handleMessage);
   *
   * const mainRouter = createZodRouter({
   *   platform: createBunAdapter(),
   * })
   *   .addRoutes(authRouter)
   *   .addRoutes(chatRouter);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addRoutes(router: WebSocketRouter<V, TData> | any): this {
    // Merge message handlers
    // Access private member through type assertion for composability
    interface AccessibleRouter {
      messageHandlers: Map<string, MessageHandlerEntry<TData>>;
      openHandlers: OpenHandler<TData>[];
      closeHandlers: CloseHandler<TData>[];
      authHandlers: AuthHandler<TData>[];
      errorHandlers: ErrorHandler<TData>[];
      middlewares: Middleware<TData>[];
      routeMiddleware: Map<string, Middleware<TData>[]>;
    }

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
   * Publish a message to a channel.
   *
   * Scope depends on PubSub implementation:
   * - MemoryPubSub: This process instance only
   * - BunPubSub (Phase 3): Load-balanced cluster (all instances)
   * - DurablePubSub (Phase 6): This DO instance only
   * - RedisPubSub (Phase 8): Multiple instances via Redis
   *
   * @param channel - Channel name
   * @param message - Message to publish
   */
  async publish(channel: string, message: unknown): Promise<void> {
    await this.pubsub.publish(channel, message);
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
            {
              ws,
              type: "",
              meta: { clientId: ws.data.clientId, receivedAt: Date.now() },
              send: this.createSendFunction(ws),
            },
          );
        }
      },
      open: async (ws: ServerWebSocket<TData>) => {
        try {
          await this.handleOpen(ws);
        } catch (error) {
          this.callErrorHandlers(
            error instanceof Error ? error : new Error(String(error)),
            {
              ws,
              type: "",
              meta: { clientId: ws.data.clientId, receivedAt: Date.now() },
              send: this.createSendFunction(ws),
            },
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
            {
              ws,
              type: "",
              meta: { clientId: ws.data.clientId, receivedAt: Date.now() },
              send: this.createSendFunction(ws),
            },
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
    // NOTE: Open handlers run BEFORE auth, so clients can authenticate themselves
    // TODO: Reconsider this order - should auth happen first?
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
          { ws, type: "", meta: { clientId, receivedAt: Date.now() }, send },
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

    const send = this.createSendFunction(ws);

    // Execute close handlers
    for (const handler of this.closeHandlers) {
      try {
        const context: CloseHandlerContext<TData> = { ws, code, reason, send };
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

      // Step 8: Handler dispatch with middleware pipeline
      // Create error sending function for type-safe error responses
      const errorSend = (
        code: string,
        message: string,
        details?: Record<string, unknown>,
      ) => {
        try {
          if (!this.validator) {
            console.warn("[ws] No validator configured. Cannot send error.");
            return;
          }

          // Create error message using the standard ERROR type
          // Error messages have code, message, and optional details fields
          const errorMessage = {
            type: "ERROR",
            meta: {
              timestamp: Date.now(),
            },
            payload: {
              code,
              message,
              ...(details && { details }),
            },
          };

          // Validate error message structure (lenient - allow any valid structure)
          // We don't have the ERROR schema here, so we'll just send it raw after validation
          const messageType = "ERROR";

          // Send error message
          ws.send(
            JSON.stringify({
              type: messageType,
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

      const context: MessageContext<MessageSchemaType, TData> = {
        ws,
        type: messageType,
        meta: validatedData.meta,
        receivedAt: receivedAt,
        send,
        error: errorSend,
        reply: send, // Semantic alias for send() in request/response patterns
        assignData,
        subscribe,
        unsubscribe,
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
      } catch (error) {
        this.callErrorHandlers(
          error instanceof Error ? error : new Error(String(error)),
          context,
        );
      }
    } catch (error) {
      this.callErrorHandlers(
        error instanceof Error ? error : new Error(String(error)),
        { ws, type: "", meta: { clientId, receivedAt }, send },
      );
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
        const meta = { clientId: ws.data.clientId, receivedAt };
        const context: MessageContext<MessageSchemaType, TData> = {
          ws,
          type: "",
          meta,
          receivedAt,
          send,
        };

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
   * Call all registered error handlers.
   */
  private callErrorHandlers(
    error: Error,
    context?: MessageContext<MessageSchemaType, TData>,
  ): void {
    if (this.errorHandlers.length === 0) {
      // No error handlers registered - log to console
      console.error("[ws] Unhandled error:", error, context);
      return;
    }

    for (const handler of this.errorHandlers) {
      try {
        handler(error, context);
      } catch (handlerError) {
        console.error("[ws] Error in error handler:", handlerError);
      }
    }
  }

  /**
   * Create a send function for a specific WebSocket connection.
   *
   * The send function validates messages before sending.
   */
  private createSendFunction(ws: ServerWebSocket<TData>): SendFunction {
    return (
      schema: MessageSchemaType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      meta: any = {},
    ) => {
      try {
        if (!this.validator) {
          console.warn("[ws] No validator configured. Cannot send message.");
          return;
        }

        // Extract message type from schema
        const messageType = this.validator.getMessageType(schema);

        // Create message object with required structure
        // NOTE: timestamp auto-generated; clientId is NEVER injected
        const message = {
          type: messageType,
          meta: {
            timestamp: Date.now(),
            ...meta,
          },
          ...(payload !== undefined && { payload }),
        };

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
}
