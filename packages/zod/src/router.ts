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
 * router.onMessage(LoginSchema, (ctx) => {
 *   const username = ctx.payload.username; // ← string (inferred)
 * });
 *
 * const { fetch, websocket } = createBunHandler(router);
 * ```
 */

import { WebSocketRouter } from "@ws-kit/core";
import type {
  AuthHandler,
  CloseHandler,
  ErrorHandler,
  Middleware,
  OpenHandler,
  WebSocketData,
  WebSocketRouterOptions,
} from "@ws-kit/core";

import zodValidator from "./validator";
import type { MessageHandler, MessageSchemaType } from "./types";

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
   * const UserInfoSchema = messageSchema("USER:INFO", {
   *   id: z.string().uuid(),
   *   name: z.string(),
   * });
   *
   * router.onMessage(UserInfoSchema, (ctx) => {
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
  onMessage<Schema extends MessageSchemaType>(
    schema: Schema,
    handler: MessageHandler<Schema, TData>,
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
   * Useful for composing routers from different modules/features.
   * Last-write-wins for duplicate message types.
   *
   * Note: The source router should have the same validator type.
   *
   * @param router - Another router to merge
   * @returns This router for method chaining
   */
  addRoutes(
    router: TypedZodRouter<TData> | { _core?: WebSocketRouter<TData> },
  ): this;

  /**
   * Publish a message to all subscribers on a channel.
   *
   * Scope depends on the platform adapter (Bun: process-wide, Cloudflare DO: instance-wide).
   *
   * @param channel - Channel name to publish to
   * @param message - Message object with type, meta, and payload
   * @returns Promise that resolves when broadcast is sent
   *
   * @example
   * ```typescript
   * await router.publish("notifications", {
   *   type: "NOTIFICATION",
   *   meta: {},
   *   payload: { message: "Hello all!" },
   * });
   * ```
   */
  publish(channel: string, message: unknown): Promise<void>;

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
  readonly [key: symbol]: any;

  /**
   * @deprecated Use `router[Symbol.for("ws-kit.core")]` instead.
   *
   * The `_core` property is deprecated and will be removed in v2.0.
   * Platform handlers now accept the router directly—no need to access `_core`.
   *
   * @example
   * ```typescript
   * // ❌ Old (deprecated)
   * const { fetch, websocket } = createBunHandler(router._core);
   *
   * // ✅ New (recommended)
   * const { fetch, websocket } = createBunHandler(router);
   * ```
   */
  readonly _core?: WebSocketRouter<TData>;
}

/**
 * Create a type-safe WebSocket router using Zod validation.
 *
 * @deprecated Use `createRouter()` instead (shorter name, same functionality).
 *
 * This function is fully backwards compatible. The new `createRouter()` name
 * aligns with the export-with-helpers pattern and is the recommended API.
 *
 * ```typescript
 * // ❌ Old name
 * import { createZodRouter } from "@ws-kit/zod";
 * const router = createZodRouter<AppData>();
 *
 * // ✅ New name (recommended)
 * import { createRouter } from "@ws-kit/zod";
 * const router = createRouter<AppData>();
 * ```
 *
 * @typeParam TData - Application-specific data stored on connections
 * @param options - Router options (platform adapter, hooks, etc.)
 * @returns A type-safe router with proper payload inference
 *
 * @see createRouter - New recommended function name
 */
export function createZodRouter<TData extends WebSocketData = WebSocketData>(
  options?: Omit<WebSocketRouterOptions<TData>, "validator">,
): TypedZodRouter<TData> {
  // Create core router with Zod validator
  const coreRouter = new WebSocketRouter<TData>({
    ...options,
    validator: zodValidator(),
  });

  // Create type-safe wrapper
  const router: TypedZodRouter<TData> = {
    // Type-safe onMessage with proper payload inference
    onMessage(schema, handler) {
      coreRouter.onMessage(schema, handler as any);
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
    use(middleware) {
      coreRouter.use(middleware);
      return router;
    },

    // Router composition
    addRoutes(sourceRouter) {
      const coreToAdd =
        (sourceRouter as any)[Symbol.for("ws-kit.core")] ?? sourceRouter._core;
      coreRouter.addRoutes(coreToAdd);
      return router;
    },

    // Publishing
    publish(channel, message) {
      return coreRouter.publish(channel, message);
    },

    // Stable escape hatch for advanced introspection (following React convention)
    [Symbol.for("ws-kit.core")]: coreRouter,
  };

  // Deprecation getter for backwards compatibility (v1.x only)
  Object.defineProperty(router, "_core", {
    get() {
      console.warn(
        "router._core is deprecated and will be removed in v2.0. " +
          "Platform handlers now accept the router directly. " +
          'For advanced introspection, use router[Symbol.for("ws-kit.core")] instead.',
      );
      return coreRouter;
    },
    configurable: true,
  });

  return router;
}
