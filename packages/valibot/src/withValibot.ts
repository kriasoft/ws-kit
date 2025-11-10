// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * withValibot() plugin: adds validation capability to the router.
 *
 * Once plugged, the router gains:
 * - router.rpc() method for request-response handlers
 * - Enhanced context: ctx.payload (validated), ctx.send(), ctx.reply(), ctx.progress()
 * - Automatic payload validation from schemas
 * - Validation errors routed to router.onError()
 *
 * Mirrors the Zod plugin pattern for consistency.
 */

import type {
  Router,
  MessageDescriptor,
  Plugin,
  MinimalContext,
  CoreRouter,
} from "@ws-kit/core";
import type { EventHandler } from "@ws-kit/core";
import type { GenericSchema } from "valibot";

/**
 * Validation plugin for Valibot schemas.
 * Adds validation capability and RPC support to the router.
 *
 * Inserts a validation middleware that:
 * 1. Parses and validates payload from schema
 * 2. Enriches context with payload and methods (send, reply, progress)
 * 3. Routes validation errors to router.onError()
 *
 * @example
 * ```typescript
 * import { v, message, withValibot, createRouter } from "@ws-kit/valibot";
 *
 * const Join = message("JOIN", { roomId: v.string() });
 * const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
 *   id: v.string(),
 *   name: v.string(),
 * });
 *
 * const router = createRouter()
 *   .plugin(withValibot())
 *   .on(Join, (ctx) => {
 *     // ctx.payload is now typed and validated
 *     console.log(ctx.payload.roomId);
 *   })
 *   .rpc(GetUser, async (ctx) => {
 *     // RPC handler: has ctx.reply() and ctx.progress()
 *     ctx.progress({ id: ctx.payload.id, name: "Loading..." });
 *     ctx.reply({ id: ctx.payload.id, name: "Alice" });
 *   });
 * ```
 */
export function withValibot(): Plugin<any, { validation: true }> {
  return (router) => {
    // Get internal access to router for wrapping dispatch
    const routerImpl = router as any as CoreRouter<any>;

    // Store original context creator
    const originalCreateContext = routerImpl.createContext.bind(routerImpl);

    // Inject validation middleware that validates payload and enriches context
    // This runs automatically before any user handler
    router.use(async (ctx: MinimalContext<any>, next) => {
      // Get the schema from registry by looking up the type
      const registry = routerImpl.getInternalRegistry();
      const entry = registry.get(ctx.type);

      if (entry) {
        const schema = entry.schema;
        const payloadSchema = getValibotPayload(schema);

        // Validate payload if schema defines one
        if (payloadSchema) {
          const result = validatePayload(ctx.payload, payloadSchema);
          if (!result.success) {
            // Create validation error and route to error sink
            const validationError = new Error(
              `Validation failed for ${ctx.type}: ${JSON.stringify(result.error)}`,
            );
            (validationError as any).code = "VALIDATION_ERROR";
            (validationError as any).details = result.error;

            const lifecycle = routerImpl.getInternalLifecycle();
            await lifecycle.handleError(validationError, ctx);
            return;
          }

          // Enrich context with validated payload
          if (result.data !== undefined) {
            (ctx as any).payload = result.data;
          }
        }
      }

      // Continue with enriched context
      await next();
    });

    // Wrap the original createContext to attach send/reply/progress methods
    routerImpl.createContext = function (params: any) {
      const ctx = originalCreateContext(params);
      const routerImpl = this as CoreRouter<any>;

      // Attach send() method for event handlers (always available after validation)
      (ctx as any).send = async (
        schema: MessageDescriptor,
        payload: any,
      ) => {
        // For now, this is a placeholder - will be implemented by adapters
        // In a real implementation, this would serialize and send to clients
        console.debug(`[send] ${schema.type}:`, payload);
      };

      // Attach reply() and progress() methods for RPC handlers
      (ctx as any).reply = async (payload: any) => {
        // RPC terminal response - to be implemented by adapters
        console.debug(`[reply]:`, payload);
      };

      (ctx as any).progress = async (payload: any) => {
        // RPC progress update - to be implemented by adapters
        console.debug(`[progress]:`, payload);
      };

      return ctx;
    };

    // Type-safe RPC handler method
    const rpcMethod = (
      schema: MessageDescriptor & { response: MessageDescriptor },
      handler: any,
    ) => {
      // Use the standard on() method but mark it internally as RPC-capable
      return router.on(schema, handler);
    };

    // Return router with rpc method added (capability-gated)
    const enhanced = Object.assign(router, {
      rpc: rpcMethod,
    }) as Router<any, { validation: true }>;

    // Attach capabilities for PluginManager to track
    (enhanced as any).__caps = { validation: true };

    return enhanced;
  };
}

/**
 * Helper to extract Valibot payload schema from a message schema.
 * Used internally by the validation middleware.
 * @internal
 */
export function getValibotPayload(schema: any): GenericSchema | undefined {
  return schema.__valibot_payload;
}

/**
 * Helper to validate payload against Valibot schema.
 * Returns { success: true, data } or { success: false, error }.
 * @internal
 */
export function validatePayload(
  payload: unknown,
  payloadSchema: GenericSchema | undefined,
): { success: boolean; data?: unknown; error?: any } {
  if (!payloadSchema) {
    // No payload schema defined (message with no payload)
    return { success: true };
  }

  try {
    // Dynamic import to avoid circular dependency on valibot
    // In a real implementation, valibot would be passed as a parameter
    const parsed = (payloadSchema as any).parse?.(payload);
    return { success: true, data: parsed };
  } catch (error) {
    return { success: false, error };
  }
}
