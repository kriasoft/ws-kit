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

  // Heartbeat state
  private readonly heartbeatConfig?: { intervalMs: number; timeoutMs: number };
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
   * const authRouter = new WebSocketRouter();
   * authRouter.onMessage(LoginSchema, handleLogin);
   *
   * const chatRouter = new WebSocketRouter();
   * chatRouter.onMessage(MessageSchema, handleMessage);
   *
   * const mainRouter = new WebSocketRouter()
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

      // Step 6: Inject server-controlled metadata
      if (typeof normalized === "object" && normalized !== null) {
        const msg = normalized as Record<string, unknown>;
        if (!msg.meta || typeof msg.meta !== "object") {
          msg.meta = {};
        }
        const meta = msg.meta as Record<string, unknown>;
        meta.clientId = clientId;
        meta.receivedAt = receivedAt;
      }

      // Step 7: Schema validation
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

      // Step 8: Handler dispatch
      const validatedData = validationResult.data;
      const context: MessageContext<MessageSchemaType, TData> = {
        ws,
        type: messageType,
        meta: validatedData.meta,
        send,
        ...(validatedData.payload !== undefined && {
          payload: validatedData.payload,
        }),
      };

      const result = handlerEntry.handler(context);

      // Handle async handlers
      if (result instanceof Promise) {
        result.catch((error) => {
          this.callErrorHandlers(
            error instanceof Error ? error : new Error(String(error)),
            context,
          );
        });
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
        const context: MessageContext<MessageSchemaType, TData> = {
          ws,
          type: "",
          meta: { clientId: ws.data.clientId, receivedAt },
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
      heartbeat.ws.close(4000, "HEARTBEAT_TIMEOUT");
      this.stopHeartbeat(clientId);
    }, timeoutMs) as unknown as ReturnType<typeof setTimeout>;
  }
}
