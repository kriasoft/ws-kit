// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * withRpc(): Request-response (RPC) messaging with streaming and one-shot semantics.
 *
 * Adds ctx.reply() (terminal) and ctx.progress() (non-terminal).
 * Note: ctx.error() provided by core, available in all contexts.
 *
 * Terminal methods (reply/progress/error) share one-shot guard.
 * After first terminal call, subsequent calls are no-ops.
 * Progress can be called multiple times before terminal.
 * Throttling via {throttleMs} on progress().
 * Auto-correlation: preserves correlationId in response meta.
 *
 * Wire envelopes:
 * - reply: { type: (response type), meta: {...}, payload: {...} }
 * - progress: { type: "$ws:rpc-progress", meta, payload }
 * - error: { type: "RPC_ERROR", meta, payload: {code, message, ...} }
 */

import type { ConnectionData, MinimalContext } from "@ws-kit/core";
import type { WsKitInternalState } from "@ws-kit/core/internal";
import { getRouterPluginAPI } from "@ws-kit/core/internal";
import { definePlugin } from "@ws-kit/core/plugin";
import type { ProgressOptions, ReplyOptions } from "./types.js";

/**
 * Internal context shape used during RPC execution.
 * @internal
 */
interface EnhancedContext extends MinimalContext<any> {
  payload?: unknown;
  meta?: Record<string, unknown>;
  __wskit?: WsKitInternalState & {
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
interface WithRpcAPI {
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
 * - ctx.progress(update, opts?) - Non-terminal streaming update
 *
 * Note: ctx.error() is provided by core and available in all handler types.
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
 *     // ctx.error() is provided by core, not by withRpc
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
  return definePlugin<TContext, WithRpcAPI>((router) => {
    // Get plugin API for registering context enhancers
    const api = getRouterPluginAPI(router);

    api?.addContextEnhancer(
      (ctx: MinimalContext<any>) => {
        const enhCtx = ctx as EnhancedContext;

        // Track throttle state for progress updates
        let lastProgressTime = 0;

        // RPC context guard: throw if reply/progress called outside RPC
        // Returns internal state with rpc guaranteed initialized
        function guardRpc(): WsKitInternalState & {
          rpc: NonNullable<WsKitInternalState["rpc"]>;
          response: unknown;
        } {
          if (!enhCtx.__wskit?.response || !enhCtx.__wskit.rpc) {
            throw new Error(
              "ctx.reply() and ctx.progress() only in RPC handlers",
            );
          }
          return enhCtx.__wskit as WsKitInternalState & {
            rpc: NonNullable<WsKitInternalState["rpc"]>;
            response: unknown;
          };
        }

        // Set up RPC state: replied flag, correlationId (shared with core error method)
        function initializeRpcState() {
          if (!enhCtx.__wskit) {
            enhCtx.__wskit = {} as WsKitInternalState;
          }
          if (!enhCtx.__wskit.rpc) {
            const correlationId = enhCtx.meta?.correlationId;
            enhCtx.__wskit.rpc = {
              replied: false,
              correlationId:
                typeof correlationId === "string" ? correlationId : undefined,
            };
          }
        }

        // Extract server meta: auto-preserve correlationId in response
        function baseMeta(context: EnhancedContext): Record<string, unknown> {
          return { correlationId: context.meta?.correlationId };
        }

        // Store meta() function on __wskit for core error method
        function attachBaseMeta() {
          if (!enhCtx.__wskit) {
            enhCtx.__wskit = {} as WsKitInternalState;
          }
          enhCtx.__wskit.meta = () => baseMeta(enhCtx);
        }

        // Strip reserved keys (type, correlationId) from user meta
        function sanitizeMeta(
          userMeta: Record<string, unknown> | undefined,
        ): Record<string, unknown> {
          if (!userMeta) return {};
          const sanitized = { ...userMeta };
          delete sanitized.type;
          delete sanitized.correlationId;
          return sanitized;
        }

        // Rate-limit progress updates if {throttleMs} set
        function shouldThrottle(throttleMs: number | undefined): boolean {
          if (!throttleMs) return false;
          const elapsed = Date.now() - lastProgressTime;
          if (elapsed >= throttleMs) {
            lastProgressTime = Date.now();
            return false;
          }
          return true;
        }

        // Send RPC message: { type, meta, payload? }
        function sendMessage(
          type: string,
          payload: any,
          meta: Record<string, unknown>,
        ): void {
          try {
            ctx.ws.send(
              JSON.stringify({
                type,
                meta,
                ...(payload !== undefined ? { payload } : {}),
              }),
            );
          } catch {
            // Connection closed; no-op (fire-and-forget)
          }
        }

        // Extract response type from schema
        function getResponseType(schema: any): string {
          return (
            schema.__descriptor?.messageType ||
            schema.responseType ||
            schema.messageType ||
            "RESPONSE"
          );
        }

        // Initialize RPC state and meta function
        initializeRpcState();
        attachBaseMeta();

        // reply(payload, opts?): Terminal response (one-shot, shared guard with error).
        // Returns void (async enqueue) by default, Promise<void> with {waitFor}.
        const reply = (
          payload: any,
          opts?: ReplyOptions,
        ): void | Promise<void> => {
          const wskit = guardRpc();

          // Skip if already replied (one-shot)
          if (wskit.rpc.replied) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // Skip if signal aborted
          if (opts?.signal?.aborted) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // Mark as replied
          wskit.rpc.replied = true;

          // Fire-and-forget if no waitFor
          if (!opts?.waitFor) {
            setImmediate(() => {
              const responseType = getResponseType(wskit.response);

              // Build response: auto-preserve correlation
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

        // progress(update, opts?): Non-terminal update (streaming).
        // Multiple calls allowed; becomes no-op after reply/error.
        // Supports {throttleMs} rate-limiting. Returns void (async) or Promise<void> with {waitFor}.
        const progress = (
          update: any,
          opts?: ProgressOptions,
        ): void | Promise<void> => {
          const wskit = guardRpc();

          // Skip if terminal response already sent
          if (wskit.rpc.replied) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // Skip if aborted
          if (opts?.signal?.aborted) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // Skip if throttled
          if (shouldThrottle(opts?.throttleMs)) {
            return opts?.waitFor ? Promise.resolve() : undefined;
          }

          // Fire-and-forget if no waitFor
          if (!opts?.waitFor) {
            setImmediate(() => {
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
        const rpcExt = { reply, progress };
        ctx.extensions.set("rpc", rpcExt);

        // Also expose directly on context for backwards compatibility
        (enhCtx as any).reply = reply;
        (enhCtx as any).progress = progress;
      },
      { priority: 0 },
    );

    // Return capability marker for capability gating (non-enumerable to avoid collisions).
    return Object.create(null, {
      __caps: { value: { rpc: true as const }, enumerable: true },
    }) as WithRpcAPI;
  });
}

export type {
  ProgressOptions,
  ReplyOptions,
  WithRpcCapability,
} from "./types.js";
