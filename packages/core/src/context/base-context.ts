// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Client data constraint: always available (no plugin dependency).
 * Minimal surface: clientId, ws, type, data, assignData.
 *
 * clientId is a stable identifier assigned at connection accept time.
 * Used for pub/sub membership tracking, middleware policy, and logging.
 *
 * ValidationAPI adds: payload (inferred from schema)
 * Event handlers add: send(schema, payload)
 * RPC handlers add: reply(payload), progress(payload)
 */

import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { ServerWebSocket } from "../ws/platform-adapter";
import type { ExtErrorCode } from "../error";
import type { ErrorOptions } from "./error-handling";

/**
 * Per-connection data structure.
 *
 * Augment this interface via declaration merging to add typed connection fields:
 * ```ts
 * declare module "@ws-kit/core" {
 *   interface ConnectionData {
 *     userId?: string;
 *     email?: string;
 *     roles?: string[];
 *   }
 * }
 * ```
 *
 * Users can also override generics for feature-specific data:
 * ```ts
 * type ChatData = ConnectionData & { roomId?: string };
 * const router = createRouter<ChatData>();
 * ```
 */
export type ConnectionData = Record<string, unknown>;

/**
 * Utility type for defining custom per-connection data.
 *
 * Merges custom properties with the base `ConnectionData` structure.
 * Use when defining custom data for specific routers or features.
 *
 * @example
 * ```ts
 * // For a feature module with custom data
 * type ChatData = WebSocketData<{ roomId?: string }>;
 * const chatRouter = createRouter<ChatData>();
 * ```
 *
 * Equivalent to:
 * ```ts
 * type ChatData = ConnectionData & { roomId?: string };
 * ```
 */
export type WebSocketData<
  T extends Record<string, unknown> = Record<string, unknown>,
> = ConnectionData & T;

export interface MinimalContext<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Stable client identifier (assigned at accept-time, unique per connection).
   * Used for pub/sub membership, middleware authorization, and logging.
   */
  readonly clientId: string;

  /**
   * Underlying WebSocket (platform-agnostic wrapper).
   */
  readonly ws: ServerWebSocket;

  /**
   * Message type (literal from schema.type).
   */
  readonly type: string;

  /**
   * Per-connection data (passed to createRouter<TContext>).
   * TContext represents the data structure available on ctx.data.
   * Keep separate from clientId (app state vs. router identity).
   */
  readonly data: TContext;

  /**
   * Update connection data (partial merge).
   */
  assignData(partial: Partial<TContext>): void;

  /**
   * Send an error to the client (available in all contexts).
   *
   * For non-RPC handlers: sends an ERROR message (fire-and-forget, can call multiple times).
   * For RPC handlers: sends RPC_ERROR with correlation and one-shot semantics (symmetric with reply()).
   *
   * Fire-and-forget: enqueued asynchronously, returns immediately.
   *
   * @param code - Standard or custom error code (inferred for retry semantics if standard)
   * @param message - Optional human-readable error message
   * @param details - Optional structured debug information (safe for client transmission)
   * @param options - Optional retry and cause configuration
   */
  error(
    code: ExtErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ): void;

  /**
   * Plugin extensions registry. Each plugin stores its context enhancements here.
   * Use this to avoid collisions and enable plugin composition.
   *
   * @example
   * ```ts
   * // In plugin enhancer
   * ctx.extensions.set('zod', { reply, send, progress });
   *
   * // In another plugin or handler
   * const zodExt = ctx.extensions.get('zod');
   * ```
   */
  readonly extensions: Map<string, unknown>;
}

/**
 * Assertion helper: is context a valid MinimalContext?
 */
export function isMinimalContext(ctx: unknown): ctx is MinimalContext {
  return (
    ctx !== null &&
    typeof ctx === "object" &&
    typeof (ctx as any).clientId === "string" &&
    "ws" in ctx &&
    "type" in ctx &&
    "data" in ctx &&
    typeof (ctx as any).assignData === "function"
  );
}

/**
 * Type-safe helper to retrieve a plugin extension from context.
 *
 * @typeParam T - The type of the extension to retrieve
 * @param ctx - The context object
 * @param name - The plugin namespace (e.g., 'zod', 'pubsub')
 * @returns The extension value, or undefined if not found
 *
 * @example
 * ```ts
 * const zodExt = getContextExtension<ZodContextExt>(ctx, 'zod');
 * if (zodExt) {
 *   await zodExt.reply({ result: 'ok' });
 * }
 * ```
 */
export function getContextExtension<T>(
  ctx: MinimalContext,
  name: string,
): T | undefined {
  return ctx.extensions.get(name) as T | undefined;
}

export interface EventContext<
  TContext extends ConnectionData = ConnectionData,
  TPayload = unknown,
> extends MinimalContext<TContext> {
  payload: TPayload;
}
