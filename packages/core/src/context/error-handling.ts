// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core error handling: `ctx.error()` as a unified primitive.
 *
 * Single error-sending method for all contexts (events, RPC, middleware).
 * Sends ERROR or RPC_ERROR based on context, with auto-correlation and one-shot semantics for RPC.
 * Infers retry hints from ERROR_CODE_META; routes all errors through router.onError() asynchronously.
 */

import type { LifecycleManager } from "../engine/lifecycle";
import {
  ERROR_CODE_META,
  isStandardErrorCode,
  WsKitError,
  type ErrorCode,
  type ExtErrorCode,
} from "../error";
import type { WsKitInternalState } from "../internal";
import type { ConnectionData, MinimalContext } from "./base-context";

/**
 * Options for ctx.error() calls.
 */
export interface ErrorOptions {
  /**
   * Override inferred retryability. If omitted, inferred from ERROR_CODE_META.
   */
  retryable?: boolean;

  /**
   * Client backoff hint (ms). null = don't retry. Defaults to ERROR_CODE_META.suggestBackoffMs.
   */
  retryAfterMs?: number | null;

  /**
   * Original error for error chain preservation (WHATWG Error.cause).
   */
  cause?: unknown;

  /**
   * Custom metadata (merged with server meta). Reserved keys (type, correlationId) are stripped.
   */
  meta?: Record<string, unknown>;
}

/**
 * Build WsKitError: infer retry hints from ERROR_CODE_META, apply user overrides.
 * @internal
 */
function createErrorFromArgs(
  code: ExtErrorCode,
  message?: string,
  details?: Record<string, unknown>,
  opts?: ErrorOptions,
  correlationId?: string,
): { error: WsKitError; retryableOverride: boolean | undefined } {
  let retryAfterMs = opts?.retryAfterMs;
  let finalMessage = message;

  // Infer from standard code metadata
  if (isStandardErrorCode(code)) {
    const meta = ERROR_CODE_META[code];

    // Use standard description if user didn't provide a message
    if (!finalMessage) {
      finalMessage = meta.description;
    }

    // Infer retryAfterMs from metadata if not explicitly provided
    if (retryAfterMs === undefined && meta.suggestBackoffMs) {
      retryAfterMs = meta.suggestBackoffMs;
    }
  }

  // Default message to code if still empty
  if (!finalMessage) {
    finalMessage = code;
  }

  // Use constructor directly to support cause (from() doesn't expose it)
  const error = new WsKitError(
    code as ErrorCode,
    finalMessage,
    details,
    opts?.cause,
    retryAfterMs,
    correlationId,
  );

  // Return explicit retryable override if user provided it, otherwise undefined
  return {
    error,
    retryableOverride: opts?.retryable,
  };
}

// Cross-platform: setImmediate (Node.js) or setTimeout (browsers)
const scheduleAsync =
  typeof setImmediate === "function"
    ? setImmediate
    : (fn: () => void) => setTimeout(fn, 0);

/**
 * Build ctx.error(): fire-and-forget (void), async enqueue.
 * RPC: one-shot guard shared with reply(). Event: multiple calls allowed.
 * All errors route through lifecycle.handleError() asynchronously (non-blocking).
 * @internal
 */
export function createErrorMethod<TContext extends ConnectionData>(
  ctx: MinimalContext<TContext> & {
    /**
     * Internal state: RPC state (replied flag, correlationId), meta() function.
     * Set by core/plugins for error handling coordination.
     */
    __wskit?: WsKitInternalState;
  },
  lifecycle: LifecycleManager<TContext>,
): (
  code: ExtErrorCode,
  message?: string,
  details?: Record<string, unknown>,
  opts?: ErrorOptions,
) => void {
  return (code, message, details, opts) => {
    // Synchronously mark as replied to prevent duplicate responses/warnings
    const isRpc = !!ctx.__wskit?.rpc;
    const rpcState = ctx.__wskit?.rpc;
    if (isRpc && rpcState) {
      if (rpcState.replied) {
        return undefined; // Already replied
      }
      rpcState.replied = true;
    }

    // Fire-and-forget: async enqueue, return void immediately
    scheduleAsync(async () => {
      try {
        const correlationId = rpcState?.correlationId;

        // Build error: infer retry hints, apply user overrides
        const { error: err, retryableOverride } = createErrorFromArgs(
          code,
          message,
          details,
          opts,
          correlationId,
        );

        // Route through lifecycle asynchronously (non-blocking)
        lifecycle.handleError(err, ctx).catch((e) => {
          console.error("[ws-kit] onError handler threw:", e);
        });

        // Convert to client-safe payload
        const payload = err.toPayload();
        if (retryableOverride !== undefined) {
          payload.retryable = retryableOverride;
        }

        // Build meta: server + correlation + user (reserved keys stripped)
        const meta = {
          ...(ctx.__wskit?.meta?.() ?? {}),
          ...(correlationId ? { correlationId } : {}),
          ...(opts?.meta ? sanitizeUserMeta(opts.meta) : {}),
        };

        // Auto-select wire type: ERROR for events, RPC_ERROR for RPC
        const envelope = {
          type: isRpc ? "RPC_ERROR" : "ERROR",
          meta,
          ...(payload ? { payload } : {}),
        };

        try {
          ctx.ws.send(JSON.stringify(envelope));
        } catch (serializationErr) {
          // Serialization failed (circular refs, BigInts). Fallback: minimal payload.
          try {
            ctx.ws.send(
              JSON.stringify({
                type: envelope.type,
                meta: meta,
                payload: { code: err.code, message: err.message || "Error" },
              }),
            );
          } catch (fallbackErr) {
            // Both attempts failed; log only
            if (
              typeof process !== "undefined" &&
              process.env?.NODE_ENV !== "test"
            ) {
              console.error("[ws-kit] Failed to send error:", err.toJSON());
            }
          }
        }
      } catch (err) {
        console.error("[ws-kit] Failed to process error:", err);
      }
    });
    return undefined;
  };
}

// Strip reserved keys (type, correlationId) from user meta
function sanitizeUserMeta(
  userMeta: Record<string, unknown>,
): Record<string, unknown> {
  if (!userMeta) return {};
  const sanitized = { ...userMeta };
  delete sanitized.type;
  delete sanitized.correlationId;
  return sanitized;
}

/**
 * Core error enhancer: attach ctx.error() to all contexts.
 * Runs early (priority -1000) to ensure availability before plugins.
 * @internal
 */
export function createCoreErrorEnhancer<TContext extends ConnectionData>(
  lifecycle: LifecycleManager<TContext>,
): (ctx: MinimalContext<TContext> & any) => void {
  return (ctx: MinimalContext<TContext> & any) => {
    ctx.error = createErrorMethod(ctx, lifecycle);
  };
}
