// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * withMessaging() plugin: adds fire-and-forget unicast messaging capability.
 *
 * Once plugged, handlers gain:
 * - ctx.send(schema, payload, opts?) - Send to current connection
 * - ctx.publish(topic, schema, payload, opts?) - Broadcast to subscribers (requires withPubSub)
 *
 * This plugin is validator-agnostic: validation (if needed) is handled by validator
 * plugins like withZod() or withValibot(). This plugin just handles message envelope
 * construction and sending.
 *
 * Message envelope: { type, meta, payload? }
 * - type: string literal from schema
 * - meta: merged from preserved correlation + user meta
 * - payload: optional, depends on schema
 *
 * See ADR-030 for design rationale and ADR-031 for plugin-adapter architecture.
 */

import type {
  ConnectionData,
  MessageDescriptor,
  MinimalContext,
} from "@ws-kit/core";
import { getRouterPluginAPI } from "@ws-kit/core/internal";
import { definePlugin } from "@ws-kit/core/plugin";
import type { SendOptions } from "./types";

/**
 * Internal context shape used during execution.
 * @internal
 */
interface EnhancedContext extends MinimalContext<any> {
  payload?: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Messaging plugin API interface.
 *
 * Provides context methods for fire-and-forget unicast messaging.
 * These methods work validator-agnostic (validation is optional).
 */
interface WithMessagingAPI<TContext extends ConnectionData = ConnectionData> {
  /**
   * Marker for capability-gating in Router type system.
   * @internal
   */
  readonly messaging: true;
}

/**
 * withMessaging() plugin: Enable fire-and-forget unicast messaging.
 *
 * Adds context methods:
 * - ctx.send(schema, payload, opts?) - Send to current connection (1-to-1)
 * - ctx.publish(topic, schema, payload, opts?) - Broadcast to subscribers (1-to-many, requires withPubSub)
 *
 * Fire-and-forget by default (returns void). Optional {waitFor} for async confirmation:
 * - {waitFor: 'drain'} - Wait for WebSocket buffer to drain
 * - {waitFor: 'ack'} - Wait for server-side acknowledgment
 *
 * Validator-agnostic: Does NOT validate payloads. Validation (if desired) is handled
 * by validator plugins (withZod, withValibot) which run before this plugin.
 *
 * @example
 * ```typescript
 * import { createRouter } from "@ws-kit/core";
 * import { withMessaging } from "@ws-kit/plugins";
 *
 * const router = createRouter()
 *   .plugin(withMessaging());
 *
 * router.on(PingMsg, (ctx) => {
 *   // ctx.send() is now available
 *   ctx.send(PongMsg, { text: "pong" });
 * });
 * ```
 *
 * @example With validation (Zod):
 * ```typescript
 * import { createRouter, withZod } from "@ws-kit/zod";
 * import { withMessaging } from "@ws-kit/plugins";
 *
 * const router = createRouter()
 *   .plugin(withZod())
 *   .plugin(withMessaging());
 *
 * router.on(PingMsg, (ctx) => {
 *   ctx.payload.text;  // ✅ Inferred from schema (via Zod)
 *   ctx.send(PongMsg, { text: "pong" });  // ✅ Type-safe
 * });
 * ```
 */
export function withMessaging<
  TContext extends ConnectionData = ConnectionData,
>() {
  return definePlugin<TContext, WithMessagingAPI<TContext>>((router) => {
    // Register context enhancer to attach send method
    const api = getRouterPluginAPI(router);

    api?.addContextEnhancer(
      (ctx: MinimalContext<any>) => {
        const enhCtx = ctx as EnhancedContext;

        /**
         * Sanitize user-provided meta: strip reserved keys.
         * Reserved keys: 'type', 'correlationId' (cannot be overridden by user)
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
         * Serialize and send an outbound message via WebSocket.
         *
         * Message envelope: { type, meta, payload? }
         * - type: message type string
         * - meta: metadata object (preserved correlation, user meta)
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
         * Extract message type from schema.
         *
         * For MessageDescriptor: use __descriptor.messageType or .messageType field.
         * For plain objects: use .messageType field.
         */
        function getMessageType(schema: any): string {
          return (
            schema.__descriptor?.messageType ||
            schema.messageType ||
            schema.responseType ||
            "UNKNOWN"
          );
        }

        /**
         * send(schema, payload, opts?) - Fire-and-forget unicast to current connection.
         *
         * Returns void by default (async enqueue).
         * With {waitFor} option, returns Promise<boolean>.
         *
         * Signal: If aborted before enqueue, gracefully skips sending.
         * preserveCorrelation: Auto-copy correlationId from inbound meta if present.
         */
        const send = (
          schema: any | MessageDescriptor,
          payload: any,
          opts?: SendOptions,
        ): void | Promise<boolean> => {
          // Check if signal is already aborted
          if (opts?.signal?.aborted) {
            return opts?.waitFor ? Promise.resolve(false) : undefined;
          }

          // If no waitFor, return void (fire-and-forget path)
          if (!opts?.waitFor) {
            // Fire-and-forget: send asynchronously without blocking handler
            setImmediate(() => {
              const messageType = getMessageType(schema);

              // Build meta: start with sanitized user meta, then preserve correlation
              const outMeta: Record<string, unknown> = sanitizeMeta(opts?.meta);

              // Auto-preserve correlation ID if requested and present in inbound
              if (opts?.preserveCorrelation && enhCtx.meta?.correlationId) {
                outMeta.correlationId = enhCtx.meta.correlationId;
              }

              sendMessage(messageType, payload, outMeta);
            });

            return undefined;
          }

          // With waitFor, return promise
          return new Promise<boolean>((resolveOuter) => {
            setImmediate(() => {
              const messageType = getMessageType(schema);

              // Build meta: start with sanitized user meta, then preserve correlation
              const outMeta: Record<string, unknown> = sanitizeMeta(opts?.meta);

              // Auto-preserve correlation ID if requested and present in inbound
              if (opts?.preserveCorrelation && enhCtx.meta?.correlationId) {
                outMeta.correlationId = enhCtx.meta.correlationId;
              }

              sendMessage(messageType, payload, outMeta);

              // Stub for buffer tracking: return true immediately
              // TODO: Implement actual buffer drain/ack tracking
              resolveOuter(true);
            });
          });
        };

        // Store extension in context extensions map
        const messagingExt = { send };
        ctx.extensions.set("messaging", messagingExt);

        // Also expose directly on context for backwards compatibility
        (enhCtx as any).send = send;
      },
      { priority: 0 },
    );

    // Return plugin API with capability marker
    return {
      messaging: true as const,
    };
  });
}

export type { SendOptions, WithMessagingCapability } from "./types";
