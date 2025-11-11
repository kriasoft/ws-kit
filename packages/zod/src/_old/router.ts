// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-safe WebSocket router using Zod for validation.
 *
 * This module provides a factory function that creates a WebSocket router
 * with full TypeScript type inference for message schemas. Unlike the core
 * WebSocketRouter, this provides compile-time type safety for payloads,
 * metadata, and message types.
 *
 * @see packages/core - Core WebSocketRouter for non-typed usage
 * @example
 * ```typescript
 * import { z, message, createRouter } from "@ws-kit/zod";
 * import { createBunHandler } from "@ws-kit/bun";
 *
 * const LoginSchema = message("LOGIN", { username: z.string() });
 * const router = createRouter();
 *
 * // Full type inference - no need for (ctx.payload as any)!
 * router.on(LoginSchema, (ctx) => {
 *   const username = ctx.payload.username; // ← string (inferred)
 * });
 *
 * const { fetch, websocket } = createBunHandler(router);
 * ```
 */

import type {
  AuthHandler,
  CloseHandler,
  ErrorHandler,
  IWebSocketRouter,
  MessageContext,
  Middleware,
  OpenHandler,
  PublishOptions,
  PublishResult,
  ServerWebSocket,
  WebSocketData,
  WebSocketRouterOptions,
} from "@ws-kit/core";
import { WebSocketRouter } from "@ws-kit/core";

import type { MessageHandler, MessageSchemaType } from "./types.js";
import zodValidator from "./validator.js";

/**
 * Type-safe WebSocket router interface with Zod validation.
 *
 * Provides the same API as WebSocketRouter but with proper TypeScript
 * type inference for message handlers. Message payloads are automatically
 * typed based on the schema, eliminating the need for type assertions.
 *
 * The router is implemented as a plain object facade that forwards to the
 * underlying core router. The `Symbol.for("ws-kit.core")` escape hatch provides
 * access to the core for advanced introspection (rarely needed).
 *
 * @typeParam TData - Application-specific data attached to connections
 */
export interface TypedZodRouter<TData extends WebSocketData = WebSocketData> {
  /**
   * Register a handler for incoming WebSocket messages.
   *
   * The handler context is automatically typed based on the schema:
   * - `ctx.payload` has the inferred type from the schema
   * - `ctx.type` is a literal type matching the schema
   * - `ctx.meta` includes schema-defined metadata
   *
   * @typeParam Schema - Message schema (inferred from parameter)
   * @param schema - Message schema defining type, payload, and metadata
   * @param handler - Type-safe handler function
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * const UserInfoSchema = message("USER:INFO", {
   *   id: z.string().uuid(),
   *   name: z.string(),
   * });
   *
   * router.on(UserInfoSchema, (ctx) => {
   *   // All of these are properly typed:
   *   ctx.type;              // "USER:INFO" (literal)
   *   ctx.payload.id;        // string
   *   ctx.payload.name;      // string
   *
   *   // This would be a TypeScript error:
   *   // ctx.payload.missing;  // ❌ Property does not exist
   * });
   * ```
   */
  on<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: MessageHandler<Schema, TData>,
  ): this;

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
   * const UserInfoSchema = message("USER:INFO", {
   *   id: z.string().uuid(),
   *   name: z.string(),
   * });
   * router.off(UserInfoSchema);
   * ```
   */
  off<Schema extends MessageSchemaType>(schema: Schema): this;

  /**
   * Register a type-safe RPC (request/response) handler.
   *
   * Sugar method that enforces the schema has a response field.
   * Handlers receive typed context with `ctx.reply()` and `ctx.progress()` for RPC patterns.
   *
   * @typeParam Schema - RPC message schema with response field
   * @param schema - RPC schema (must have `.response` field)
   * @param handler - Type-safe handler function
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * const GetUserRpc = rpc(
   *   "GET_USER",
   *   { id: z.string() },
   *   "USER_RESPONSE",
   *   { name: z.string(), email: z.string() }
   * );
   *
   * router.rpc(GetUserRpc, (ctx) => {
   *   const user = await db.findUser(ctx.payload.id);
   *   ctx.reply!(GetUserRpc.response, user);
   * });
   * ```
   */
  rpc<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: MessageHandler<Schema, TData>,
  ): this;

  /**
   * Register a handler for a topic (pub/sub) message.
   *
   * Sugar method for messages typically published to topics.
   * Optional handler executes when messages are published, but isn't required.
   *
   * @typeParam Schema - Message schema
   * @param schema - Message schema
   * @param options - Optional configuration (onPublish handler)
   * @returns This router for method chaining
   *
   * @example
   * ```typescript
   * const RoomUpdated = message("ROOM_UPDATED", {
   *   roomId: z.string(),
   *   message: z.string(),
   * });
   *
   * router.topic(RoomUpdated, {
   *   onPublish: (ctx) => {
   *     console.log(`Room ${ctx.payload.roomId} updated`);
   *   },
   * });
   * ```
   */
  topic<Schema extends MessageSchemaType>(
    schema: Schema,
    options?: { onPublish?: MessageHandler<Schema, TData> },
  ): this;

  /**
   * Register a handler for WebSocket open events.
   *
   * Called after successful authentication when a client connects.
   * Multiple handlers can be registered and execute in order.
   *
   * @param handler - Handler function
   * @returns This router for method chaining
   */
  onOpen(handler: OpenHandler<TData>): this;

  /**
   * Register a handler for WebSocket close events.
   *
   * Called when a client disconnects. Multiple handlers can be registered
   * and execute in order. This is the primary place for cleanup logic.
   *
   * @param handler - Handler function
   * @returns This router for method chaining
   */
  onClose(handler: CloseHandler<TData>): this;

  /**
   * Register a handler for authentication.
   *
   * Called on connection open before any other handlers.
   * If any auth handler returns false, the connection is rejected.
   *
   * @param handler - Handler that returns true to allow connection
   * @returns This router for method chaining
   */
  onAuth(handler: AuthHandler<TData>): this;

  /**
   * Register a handler for error events.
   *
   * Called when an error occurs during message processing.
   * Errors don't close the connection automatically.
   *
   * @param handler - Handler function
   * @returns This router for method chaining
   */
  onError(handler: ErrorHandler<TData>): this;

  /**
   * Register global middleware for all messages.
   *
   * Middleware executes before message handlers in registration order.
   * Each middleware receives a `next()` function to proceed to the next
   * middleware or handler. Middleware can return early to skip the handler.
   *
   * @param middleware - Middleware function
   * @returns This router for method chaining
   */
  use(middleware: Middleware<TData>): this;

  /**
   * Register per-route middleware for a specific message type.
   *
   * Per-route middleware runs only for the specified message schema and has
   * full type inference on the context, including payload typing.
   *
   * @param schema - Message schema this middleware applies to
   * @param middleware - Middleware function with typed context
   * @returns This router for method chaining
   */
  use<TSchema extends MessageSchemaType>(
    schema: TSchema,
    middleware: (
      ctx: MessageContext<TSchema, TData>,
      next: () => void | Promise<void>,
    ) => void | Promise<void>,
  ): this;

  /**
   * Merge message handlers from another router into this one.
   *
   * Merges all handlers, lifecycle hooks, and middleware from the source router.
   * Last-write-wins for duplicate message types.
   *
   * Only supports @ws-kit routers (TypedZodRouter, TypedValibotRouter, or WebSocketRouter).
   *
   * @param router - A @ws-kit router instance
   * @returns This router for method chaining
   */
  merge(router: IWebSocketRouter<TData>): this;

  /**
   * Publish a type-safe message to all subscribers on a topic.
   *
   * Validates the payload against the schema before broadcasting.
   * Scope depends on the platform adapter (Bun: process-wide, Cloudflare DO: instance-wide).
   *
   * @typeParam Schema - Message schema (inferred from parameter)
   * @param topic - Topic name to publish to
   * @param schema - Message schema defining type and payload structure
   * @param payload - Message payload to validate and broadcast
   * @param options - Optional metadata and publishing options
   * @returns Promise that resolves with PublishResult containing delivery information
   *
   * @example
   * ```typescript
   * const Announcement = message("ANNOUNCEMENT", { text: z.string() });
   * const result = await router.publish("notifications", Announcement, {
   *   text: "Server maintenance at 02:00 UTC",
   * });
   * if (result.ok) {
   *   console.log(`Notified ${result.matchedLocal} local subscribers (${result.capability})`);
   * }
   * ```
   */
  publish<Schema extends MessageSchemaType>(
    topic: string,
    schema: Schema,
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

  /**
   * Access the underlying core router for advanced introspection.
   *
   * This is a stable escape hatch following the React convention
   * (Symbol.for("react.element")). Use this only when router.debug()
   * or other public APIs are insufficient.
   *
   * @example
   * ```typescript
   * const core = (router as any)[Symbol.for("ws-kit.core")];
   * // For advanced introspection only
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: symbol]: any;
}

/**
 * Create a type-safe WebSocket router using Zod validation.
 *
 * @typeParam TData - Application-specific data stored on connections
 * @param options - Router options (platform adapter, hooks, etc.)
 * @returns A type-safe router with proper payload inference
 *
 * @example
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 *
 * type AppData = { userId?: string };
 * const router = createRouter<AppData>();
 *
 * router.on(PingMessage, (ctx) => {
 *   ctx.send(PongMessage, { text: ctx.payload.text });
 * });
 * ```
 */
export function createZodRouter<TData extends WebSocketData = WebSocketData>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: Omit<WebSocketRouterOptions<any, TData>, "validator">,
): TypedZodRouter<TData> & IWebSocketRouter<TData> {
  // Create core router with Zod validator
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreRouter = new WebSocketRouter<any, TData>({
    ...options,
    validator: zodValidator(),
  });

  // Create type-safe wrapper
  const router: TypedZodRouter<TData> = {
    // Type-safe on with proper payload inference
    on(schema, handler) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coreRouter.on(schema, handler as any);
      return router;
    },

    // Unregister handler
    off(schema) {
      coreRouter.off(schema);
      return router;
    },

    // RPC handler registration (type-safe)
    rpc(schema, handler) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coreRouter.rpc(schema, handler as any);
      return router;
    },

    // Topic handler registration (pub/sub)
    topic(schema, options) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coreRouter.topic(schema, options as any);
      return router;
    },

    // Proxy lifecycle hooks
    onOpen(handler) {
      coreRouter.onOpen(handler);
      return router;
    },

    onClose(handler) {
      coreRouter.onClose(handler);
      return router;
    },

    onAuth(handler) {
      coreRouter.onAuth(handler);
      return router;
    },

    onError(handler) {
      coreRouter.onError(handler);
      return router;
    },

    // Middleware
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    use(middleware: any) {
      coreRouter.use(middleware);
      return router;
    },

    // Router composition
    merge(sourceRouter: IWebSocketRouter<TData>) {
      const coreToAdd =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sourceRouter as any)[Symbol.for("ws-kit.core")] ?? sourceRouter;

      // Validate that the router is compatible by checking for ws-kit router marker
      const isValidRouter =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (coreToAdd as any)?.[Symbol.for("ws-kit.router")] === true;

      if (!isValidRouter) {
        throw new TypeError(
          "Cannot merge router: expected a router from @ws-kit/zod, " +
            "@ws-kit/valibot, or a WebSocketRouter instance",
        );
      }

      coreRouter.merge(coreToAdd);
      return router;
    },

    // Publishing
    publish<Schema extends MessageSchemaType>(
      topic: string,
      schema: Schema,
      payload: unknown,
      options?: PublishOptions,
    ) {
      return coreRouter.publish(topic, schema, payload, options);
    },

    // Platform adapter handlers (delegating to core router)
    get websocket() {
      return coreRouter.websocket;
    },

    // Stable escape hatch for advanced introspection (following React convention)
    [Symbol.for("ws-kit.core")]: coreRouter,
  };

  // Add _core property for backwards compatibility with tests
  Object.defineProperty(router, "_core", {
    get: () => coreRouter,
    enumerable: false,
    configurable: true,
  });

  return router as typeof router & IWebSocketRouter<TData>;
}
