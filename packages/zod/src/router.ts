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
 * import { createZodRouter } from "@ws-kit/zod";
 * import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
 * import { z } from "zod";
 *
 * const { messageSchema } = createMessageSchema(z);
 * const LoginSchema = messageSchema("LOGIN", { username: z.string() });
 *
 * const router = createZodRouter({
 *   platform: createBunAdapter(),
 * });
 *
 * // Full type inference - no need for (ctx.payload as any)!
 * router.onMessage(LoginSchema, (ctx) => {
 *   const username = ctx.payload.username; // ← string (inferred)
 * });
 *
 * const { fetch, websocket } = createBunHandler(router._core);
 * ```
 */

import { WebSocketRouter } from "@ws-kit/core";
import type {
  AuthHandler,
  CloseHandler,
  CloseHandlerContext,
  ErrorHandler,
  OpenHandler,
  OpenHandlerContext,
  WebSocketData,
  WebSocketRouterOptions,
  ServerWebSocket,
} from "@ws-kit/core";

import zodValidator from "./validator";
import type {
  MessageContext,
  MessageHandler,
  MessageSchemaType,
} from "./types";

/**
 * Type-safe WebSocket router interface with Zod validation.
 *
 * Provides the same API as WebSocketRouter but with proper TypeScript
 * type inference for message handlers. Message payloads are automatically
 * typed based on the schema, eliminating the need for type assertions.
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
  addRoutes(router: { _core: WebSocketRouter<TData> }): this;

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
   * Access the underlying core router.
   *
   * Use this when you need to integrate with non-typed code or access
   * core router functionality not exposed by the typed wrapper.
   *
   * @example
   * ```typescript
   * const { fetch, websocket } = createBunHandler(router._core);
   * ```
   */
  readonly _core: WebSocketRouter<TData>;
}

/**
 * Create a type-safe WebSocket router using Zod validation.
 *
 * This is the recommended way to create a WebSocket router when using Zod.
 * It provides full TypeScript inference for message schemas without any
 * runtime overhead - all type checking happens at compile time.
 *
 * @typeParam TData - Application-specific data stored on connections
 * @param options - Router options (platform adapter, hooks, etc.)
 * @returns A type-safe router with proper payload inference
 *
 * @example
 * ```typescript
 * import { createZodRouter, createMessageSchema } from "@ws-kit/zod";
 * import { createBunAdapter, createBunHandler } from "@ws-kit/bun";
 * import { z } from "zod";
 *
 * const { messageSchema } = createMessageSchema(z);
 * const LoginSchema = messageSchema("LOGIN", { username: z.string() });
 *
 * type AppData = { userId?: string };
 * const router = createZodRouter<AppData>({
 *   platform: createBunAdapter(),
 * });
 *
 * router.onMessage(LoginSchema, (ctx) => {
 *   // No type assertion needed - fully typed!
 *   ctx.payload.username; // ← string (inferred)
 * });
 *
 * const { fetch, websocket } = createBunHandler(router._core);
 * ```
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

    // Router composition
    addRoutes(sourceRouter) {
      coreRouter.addRoutes(sourceRouter._core);
      return router;
    },

    // Publishing
    publish(channel, message) {
      return coreRouter.publish(channel, message);
    },

    // Access to core router for advanced usage
    get _core() {
      return coreRouter;
    },
  };

  return router;
}
