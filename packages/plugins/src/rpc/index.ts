// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * withRpc() plugin: adds request-response (RPC) messaging with streaming support.
 *
 * Once plugged, handlers gain:
 * - ctx.reply(payload, opts?) - Terminal response (one-shot)
 * - ctx.error(code, message, details?, opts?) - Terminal error response (one-shot)
 * - ctx.progress(update, opts?) - Non-terminal streaming update
 *
 * This plugin is validator-agnostic: validation (if needed) is handled by validator
 * plugins like withZod() or withValibot(). This plugin just handles RPC message
 * envelope construction, one-shot guard enforcement, and throttling.
 *
 * Key semantics:
 * - reply() and error() are "one-shot": subsequent calls are idempotent no-ops
 * - progress() can be called multiple times before terminal (reply/error)
 * - Throttling supported via {throttleMs} on progress()
 * - Auto-correlation via preserving correlationId from inbound meta
 *
 * Message envelopes:
 * - Terminal: { type: (response type), meta: {...}, payload: {...} }
 * - Error: { type: "$ws:rpc-error", meta: {...}, payload: {code, message, details?} }
 * - Progress: { type: "$ws:rpc-progress", meta: {...}, payload: {...} }
 *
 * See ADR-030 for design rationale and ADR-031 for plugin-adapter architecture.
 */

import type { ConnectionData, MinimalContext } from "@ws-kit/core";
import { getRouterPluginAPI } from "@ws-kit/core/internal";
import { definePlugin } from "@ws-kit/core/plugin";
import type { ProgressOptions, ReplyOptions } from "./types";

/**
 * Internal context shape used during RPC execution.
 * @internal
 */
interface EnhancedContext extends MinimalContext<any> {
  payload?: unknown;
  meta?: Record<string, unknown>;
  __wskit?: {
    kind?: string; // "event" | "rpc"
    request?: any; // root request schema
    response?: any; // root response schema
  };
}

/**
 * RPC plugin API interface.
 *
 * Provides context methods for request-response (RPC) messaging with streaming.
 * These methods are only available in RPC handlers and require validation plugin.
 */
interface WithRpcAPI<TContext extends ConnectionData = ConnectionData> {
  /**
   * Marker for capability-gating in Router type system.
   * @internal
   */
  readonly __caps: { rpc: true };
}

/**
 * withRpc() plugin: Enable request-response (RPC) messaging with streaming.
 *
 * Adds context methods (RPC handlers only):
 * - ctx.reply(payload, opts?) - Terminal response (one-shot)
 * - ctx.error(code, message, details?, opts?) - Terminal error (one-shot)
 * - ctx.progress(update, opts?) - Non-terminal streaming update
 *
 * Terminal responses enforce one-shot semantics via a "replied" flag:
 * - First call to reply() or error() marks RPC complete and sends response
 * - Subsequent calls are idempotent no-ops (logged in dev mode)
 * - Ordering enforced by type system (can't call progress() after terminal)
 *
 * Supports backpressure control via {waitFor}:
 * - Sync (default): Returns void, response enqueued immediately
 * - {waitFor: 'drain'}: Wait for WebSocket send buffer to drain
 * - {waitFor: 'ack'}: Wait for server-side acknowledgment
 *
 * Throttling: progress() supports {throttleMs} to batch rapid updates.
 *
 * Validator-agnostic: Does NOT validate payloads. Validation is handled by
 * validator plugins (withZod, withValibot) which run before this plugin.
 *
 * @example
 * ```typescript
 * import { createRouter, withZod } from "@ws-kit/zod";
 * import { withRpc } from "@ws-kit/plugins";
 *
 * const GetUserMsg = rpc(
 *   "GET_USER",
 *   { id: z.string() },
 *   "USER",
 *   { id: z.string(), name: z.string() }
 * );
 *
 * const router = createRouter()
 *   .plugin(withZod())
 *   .plugin(withRpc());
 *
 * router.rpc(GetUserMsg, (ctx) => {
 *   const user = db.get(ctx.payload.id);
 *   if (!user) {
 *     return ctx.error("NOT_FOUND", "User not found");
 *   }
 *   ctx.reply({ id: user.id, name: user.name });
 * });
 * ```
 *
 * @example With streaming (progress before reply):
 * ```typescript
 * const ProcessFileMsg = rpc(
 *   "PROCESS_FILE",
 *   { path: z.string() },
 *   "FILE_PROCESSED",
 *   { processed: z.number() }
 * );
 *
 * router.rpc(ProcessFileMsg, async (ctx) => {
 *   const file = await readFile(ctx.payload.path);
 *
 *   for (const chunk of file.chunks) {
 *     ctx.progress({ processed: chunk.bytes });
 *   }
 *
 *   ctx.reply({ processed: file.totalSize });
 * });
 * ```
 */
export function withRpc<TContext extends ConnectionData = ConnectionData>() {
  return definePlugin<TContext, WithRpcAPI<TContext>>((router) => {
    // Get plugin API for registering context enhancers
    const api = getRouterPluginAPI(router);

    api?.addContextEnhancer(
      (ctx: MinimalContext<any>) => {
        const enhCtx = ctx as EnhancedContext;

        // Track reply idempotency: one-shot guard for terminal responses
        let replied = false;

        // Track throttle state for progress updates
        let lastProgressTime = 0;

        /**
         * Guard: ensure we're in an RPC context.
         * Throws if called outside RPC handlers (type system helps prevent this).
         */
        function guardRpc() {
          const wskit = enhCtx.__wskit;
          if (!wskit?.response) {
            throw new Error(
              "ctx.reply(), ctx.error(), and ctx.progress() are only available in RPC handlers",
            );
          }
          return wskit;
        }

        /**
         * Extract base metadata from request (preserves correlationId).
         * Ensures RPC correlation ID is always maintained in responses.
         */
        function baseMeta(context: EnhancedContext): Record<string, unknown> {
          return {
            correlationId: context.meta?.correlationId,
          };
        }

        /**
         * Sanitize user-provided meta: strip reserved keys.
         * Reserved keys: 'type', 'correlationId' (cannot be overridden by user).
         */
        function sanitizeMeta(
          userMeta: Record<string, unknown> | undefined,
        ): Record<string, unknown> {
          if (!userMeta) return {};
          const sanitized = { ...userMeta };
          delete sanitized.type;
          delete sanitized.correlationId;
          return sanitized;
        }

        /**
         * Check if this progress update should be throttled.
         * Returns true if throttled (skip send), false if should send.
         */
        function shouldThrottle(throttleMs: number | undefined): boolean {
          if (!throttleMs) return false;
          const now = Date.now();
          const timeSinceLastProgress = now - lastProgressTime;
          if (timeSinceLastProgress >= throttleMs) {
            lastProgressTime = now;
            return false; // Don't throttle, send immediately
          }
          return true; // Throttle, skip this send
        }

        /**
         * Serialize and send an outbound RPC message via WebSocket.
         *
         * Message envelope: { type, meta, payload? }
         * - type: message type string (response or "$ws:rpc-error" or "$ws:rpc-progress")
         * - meta: metadata object (auto-preserved correlation, user meta)
         * - payload: optional message data
         */
        function sendMessage(
          type: string,
          payload: any,
          meta: Record<string, unknown>,
        ): void {
          const message = {
            type,
            meta,
            ...(payload !== undefined ? { payload } : {}),
          };
          try {
            ctx.ws.send(JSON.stringify(message));
          } catch (err) {
            // Connection may have closed; error is caught by adapter wrapper
            // No-op here (fire-and-forget)
          }
        }

        /**
         * Extract message/response type from schema.
         *
         * For MessageDescriptor: use __descriptor.type, .responseType, or .type field.
         * For plain objects: use .responseType or .type field.
         */
        function getResponseType(schema: any): string {
          return (
            schema.__descriptor?.type ||
            schema.responseType ||
            schema.type ||
            "RESPONSE"
          );
        }

        /**
         * reply(payload, opts?) - Terminal RPC response (one-shot).
         *
         * Marks the RPC as complete and sends response payload to client.
         * Subsequent calls are idempotent (no-ops, optional dev-mode log).
         *
         * Returns void by default (async enqueue).
         * With {waitFor} option, returns Promise<void>.
         */
        const reply = (
          payload: any,
          opts?: ReplyOptions,
        ): void | Promise<void> => {
          guardRpc();

          // One-shot guard: return immediately if already replied
          if (replied) {
            if (opts?.waitFor) {
              return Promise.resolve();
            }
            return undefined;
          }

          // Check if signal is already aborted
          if (opts?.signal?.aborted) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // Mark as replied (idempotent guard)
          replied = true;

          // If no waitFor, return void (fire-and-forget)
          if (!opts?.waitFor) {
            setImmediate(() => {
              const wskit = enhCtx.__wskit!;
              const responseSchema = wskit.response as any;
              const responseType = getResponseType(responseSchema);

              // Construct response message with auto-preserved correlation
              const responseMessage = {
                type: responseType,
                meta: {
                  ...baseMeta(enhCtx),
                  ...sanitizeMeta(opts?.meta),
                },
                ...(payload !== undefined ? { payload } : {}),
              };

              sendMessage(
                responseMessage.type,
                responseMessage.payload,
                responseMessage.meta,
              );
            });

            return undefined;
          }

          // With waitFor, return promise
          return new Promise<void>((resolve) => {
            setImmediate(() => {
              const wskit = enhCtx.__wskit!;
              const responseSchema = wskit.response as any;
              const responseType = getResponseType(responseSchema);

              // Construct response message with auto-preserved correlation
              const responseMessage = {
                type: responseType,
                meta: {
                  ...baseMeta(enhCtx),
                  ...sanitizeMeta(opts?.meta),
                },
                ...(payload !== undefined ? { payload } : {}),
              };

              sendMessage(
                responseMessage.type,
                responseMessage.payload,
                responseMessage.meta,
              );

              // Stub for buffer tracking: resolve immediately
              // TODO: Implement actual buffer drain/ack tracking
              resolve();
            });
          });
        };

        /**
         * error(code, message, details?, opts?) - Terminal error response (one-shot).
         *
         * Sends application-level error to RPC caller.
         * Symmetric with reply(): first call to either reply() or error() marks RPC complete.
         * Subsequent calls are idempotent no-ops (logged in dev mode).
         *
         * Error message envelope: { type: "$ws:rpc-error", meta, payload: {code, message, details?} }
         *
         * Returns void by default (async enqueue).
         * With {waitFor} option, returns Promise<void>.
         */
        const error = (
          code: string,
          message: string,
          details?: any,
          opts?: ReplyOptions,
        ): void | Promise<void> => {
          guardRpc();

          // Check if signal is already aborted
          if (opts?.signal?.aborted) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // One-shot guard: return immediately if already replied
          if (replied) {
            if (opts?.waitFor) {
              return Promise.resolve();
            }
            return undefined;
          }

          // Mark as replied (idempotent guard, applies to both reply and error)
          replied = true;

          // If no waitFor, return void (fire-and-forget)
          if (!opts?.waitFor) {
            setImmediate(() => {
              // Construct error response message
              const errorMessage = {
                type: "$ws:rpc-error",
                meta: {
                  ...baseMeta(enhCtx),
                  ...sanitizeMeta(opts?.meta),
                },
                payload: {
                  code,
                  message,
                  ...(details !== undefined ? { details } : {}),
                },
              };

              sendMessage(
                errorMessage.type,
                errorMessage.payload,
                errorMessage.meta,
              );
            });

            return undefined;
          }

          // With waitFor, return promise
          return new Promise<void>((resolve) => {
            setImmediate(() => {
              // Construct error response message
              const errorMessage = {
                type: "$ws:rpc-error",
                meta: {
                  ...baseMeta(enhCtx),
                  ...sanitizeMeta(opts?.meta),
                },
                payload: {
                  code,
                  message,
                  ...(details !== undefined ? { details } : {}),
                },
              };

              sendMessage(
                errorMessage.type,
                errorMessage.payload,
                errorMessage.meta,
              );

              // Stub for buffer tracking: resolve immediately
              // TODO: Implement actual buffer drain/ack tracking
              resolve();
            });
          });
        };

        /**
         * progress(update, opts?) - Non-terminal RPC progress update (streaming).
         *
         * Sends progress update without terminating the RPC.
         * Can be called multiple times before reply() or error().
         * Supports throttling via {throttleMs}.
         *
         * Progress message envelope: { type: "$ws:rpc-progress", meta, payload: {...} }
         *
         * Returns void by default (async enqueue).
         * With {waitFor} option, returns Promise<void>.
         */
        const progress = (
          update: any,
          opts?: ProgressOptions,
        ): void | Promise<void> => {
          guardRpc();

          // Check if signal is already aborted
          if (opts?.signal?.aborted) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // Check if this update should be throttled
          if (shouldThrottle(opts?.throttleMs)) {
            // Throttled: return immediately without sending
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // If no waitFor, return void (fire-and-forget)
          if (!opts?.waitFor) {
            setImmediate(() => {
              // Build control message with auto-preserved correlation
              const progressMessage = {
                type: "$ws:rpc-progress",
                meta: {
                  ...baseMeta(enhCtx),
                  ...sanitizeMeta(opts?.meta),
                },
                ...(update !== undefined ? { payload: update } : {}),
              };

              sendMessage(
                progressMessage.type,
                progressMessage.payload,
                progressMessage.meta,
              );
            });

            return undefined;
          }

          // With waitFor, return promise
          return new Promise<void>((resolve) => {
            setImmediate(() => {
              // Build control message with auto-preserved correlation
              const progressMessage = {
                type: "$ws:rpc-progress",
                meta: {
                  ...baseMeta(enhCtx),
                  ...sanitizeMeta(opts?.meta),
                },
                ...(update !== undefined ? { payload: update } : {}),
              };

              sendMessage(
                progressMessage.type,
                progressMessage.payload,
                progressMessage.meta,
              );

              // Stub for buffer tracking: resolve immediately
              // TODO: Implement actual buffer drain/ack tracking
              resolve();
            });
          });
        };

        // Store extension in context extensions map
        const rpcExt = { reply, error, progress };
        ctx.extensions.set("rpc", rpcExt);

        // Also expose directly on context for backwards compatibility
        (enhCtx as any).reply = reply;
        (enhCtx as any).error = error;
        (enhCtx as any).progress = progress;
      },
      { priority: 0 },
    );

    // Return capability marker for capability gating (non-enumerable to avoid collisions).
    return Object.create(null, {
      __caps: { value: { rpc: true as const }, enumerable: true },
    }) as WithRpcAPI<TContext>;
  });
}

export type { ProgressOptions, ReplyOptions, WithRpcCapability } from "./types";
