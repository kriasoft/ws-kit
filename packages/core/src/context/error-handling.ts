// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Core error handling: `ctx.error()` as a unified primitive.
 *
 * Provides a single, consistent error-sending method available on all message contexts
 * (event handlers, RPC handlers, middleware). Handles both non-RPC ERROR messages and
 * RPC_ERROR with correlation and one-shot semantics.
 *
 * Powered by WsKitError and ERROR_CODE_META for retry inference.
 */

import {
  WsKitError,
  ERROR_CODE_META,
  isStandardErrorCode,
  type ExtErrorCode,
  type ErrorCode,
} from "../error";
import type { MinimalContext } from "./base-context";
import type { LifecycleManager } from "../engine/lifecycle";
import type { ConnectionData } from "./base-context";
import type { WsKitInternalState } from "../internal";

/**
 * Error options for ctx.error() calls.
 *
 * Allows override of inferred retry semantics, explicit backoff hints,
 * and custom metadata for the error response.
 */
export interface ErrorOptions {
  /**
   * Explicitly override inferred retryability.
   * If not provided, inferred from ERROR_CODE_META for standard codes.
   * For custom codes, defaults to false.
   */
  retryable?: boolean;

  /**
   * Explicit backoff hint for client retry (milliseconds).
   * null signals operation impossible under policy (don't retry).
   * If not provided, inferred from ERROR_CODE_META.suggestBackoffMs.
   */
  retryAfterMs?: number | null;

  /**
   * Original error for logging/observability (WHATWG standard).
   * Set as WsKitError.cause for structured logging.
   */
  cause?: unknown;

  /**
   * Custom metadata to merge into error response envelope.
   * User-provided metadata is merged with server metadata (correlation, etc.).
   * Reserved keys (type, correlationId) cannot be overridden.
   */
  meta?: Record<string, unknown>;
}

/**
 * Create a WsKitError from ctx.error() arguments.
 *
 * Infers retryable and retryAfterMs from ERROR_CODE_META when code is standard,
 * then applies explicit options overrides.
 *
 * Returns both the error and a flag indicating if retryable was explicitly set
 * (so it can be included in the error payload).
 *
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

/**
 * Cross-platform async task scheduler.
 * Uses setImmediate in Node.js, setTimeout elsewhere.
 *
 * @internal
 */
const scheduleAsync =
  typeof setImmediate === "function"
    ? setImmediate
    : (fn: () => void) => setTimeout(fn, 0);

/**
 * Create the ctx.error() method for a context.
 *
 * Attached to all message contexts (event, RPC, middleware).
 * Returns void (fire-and-forget, enqueued asynchronously).
 *
 * For RPC contexts, uses shared one-shot flag with reply().
 * For event contexts, allows multiple calls (multiple ERROR messages).
 *
 * @internal
 */
export function createErrorMethod<TContext extends ConnectionData>(
  ctx: MinimalContext<TContext> & {
    /**
     * Internal state storage (see WsKitInternalState contract in internal.ts).
     * Set by core enhancers and plugins to coordinate error handling,
     * RPC correlation, and metadata propagation.
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
    // Fire-and-forget: enqueue and return immediately
    scheduleAsync(async () => {
      try {
        const isRpc = !!ctx.__wskit?.rpc;
        const rpcState = ctx.__wskit?.rpc;
        const correlationId = rpcState?.correlationId;

        // One-shot guard for RPC
        if (isRpc && rpcState!.replied) {
          return;
        }
        if (isRpc) {
          rpcState!.replied = true;
        }

        // Create WsKitError (infers retry semantics from metadata)
        const { error: err, retryableOverride } = createErrorFromArgs(
          code,
          message,
          details,
          opts,
          correlationId,
        );

        // Notify lifecycle (all errors flow through here for observability)
        // Fire non-blocking (don't await; let it run in background)
        lifecycle.handleError(err, ctx).catch((e) => {
          // Log lifecycle errors but don't let them break error sending
          console.error("[ws-kit] onError handler threw:", e);
        });

        // Convert to payload (safe for client transmission)
        let payload = err.toPayload();

        // Apply retryable override if explicitly set by user
        if (retryableOverride !== undefined) {
          payload.retryable = retryableOverride;
        }

        // Construct meta: start with server meta, then user overrides
        const baseMeta = ctx.__wskit?.meta?.() ?? {};
        const meta = {
          ...baseMeta,
          ...(correlationId ? { correlationId } : {}),
          // User-provided meta (sanitize reserved keys)
          ...(opts?.meta ? sanitizeUserMeta(opts.meta) : {}),
        };

        // Determine message type based on context
        const type = isRpc ? "RPC_ERROR" : "ERROR";

        // Send the error message through transport
        const envelope = {
          type,
          meta,
          ...(payload ? { payload } : {}),
        };

        try {
          const serialized = JSON.stringify(envelope);
          ctx.ws.send(serialized);
        } catch (serializationErr) {
          // JSON serialization may fail (circular refs, BigInts) or connection closed.
          // Fall back to a minimal error message to ensure client gets some response.
          try {
            const fallbackEnvelope = {
              type,
              meta,
              payload: {
                code: err.code,
                message: err.message || "An error occurred",
                // Omit details if serialization failed; focus on essentials
              },
            };
            ctx.ws.send(JSON.stringify(fallbackEnvelope));
          } catch (fallbackErr) {
            // Last-resort logging if both attempts fail
            if (
              typeof process !== "undefined" &&
              process.env?.NODE_ENV !== "test"
            ) {
              console.error(
                "[ws-kit] Failed to send error envelope:",
                err.toJSON(),
              );
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

/**
 * Sanitize user-provided metadata: strip reserved keys that cannot be overridden.
 * Reserved keys: type, correlationId (those are set by the server/RPC layer).
 *
 * @internal
 */
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
 * Context enhancer that attaches the core error method.
 *
 * This is a built-in enhancer that runs early to ensure ctx.error is always available,
 * even before plugins like RPC add their enhancements.
 *
 * Requires the lifecycle manager to route errors through observability hooks.
 *
 * @internal
 */
export function createCoreErrorEnhancer<TContext extends ConnectionData>(
  lifecycle: LifecycleManager<TContext>,
): (ctx: MinimalContext<TContext> & any) => void {
  return (ctx: MinimalContext<TContext> & any) => {
    // Attach error method with lifecycle
    ctx.error = createErrorMethod(ctx, lifecycle);
  };
}
